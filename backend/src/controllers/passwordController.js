const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const db = require('../config/db');
const { hashToken, generateRandomToken } = require('../utils/tokens');
const { sendResetPasswordEmail, sendPasswordChangedEmail } = require('../utils/mailer');

/**
 * POST /api/auth/forgot-password
 * Quên mật khẩu - bước 1: Gửi email reset link
 */
async function forgotPassword(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: errors.array()[0].msg,
    });
  }

  const { email } = req.body;
  const cleanEmail = email.trim().toLowerCase();

  const successResponseMsg = 'Nếu email này đã đăng ký, chúng mình đã gửi hướng dẫn đặt lại mật khẩu. Hãy kiểm tra hộp thư nhé!';

  try {
    // 1. Kiểm tra user có tồn tại không
    const [users] = await db.query(
      'SELECT id, username, email FROM users WHERE email = ? AND is_active = 1',
      [cleanEmail]
    );

    if (users.length === 0) {
      // Bảo mật: Luôn trả về 200 thông báo chung để không lộ email đã đăng ký
      return res.json({
        success: true,
        message: successResponseMsg,
      });
    }

    const user = users[0];

    // 2. Rate limit theo email: tối đa 3 lần / 1 giờ / mỗi email (ở môi trường Prod)
    const [recentResets] = await db.query(
      `SELECT COUNT(*) as count FROM password_resets
       WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
      [user.id]
    );

    const maxAllowedResets = process.env.NODE_ENV === 'development' ? 100 : 3;
    if (recentResets[0].count >= maxAllowedResets) {
      return res.status(429).json({
        success: false,
        message: 'Bạn đã yêu cầu gửi email quá nhiều lần. Vui lòng thử lại sau 1 giờ.',
      });
    }

    // 3. Vô hiệu hóa các token cũ chưa dùng của user này
    await db.query(
      'UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
      [user.id]
    );

    // 4. Sinh token mới & hash SHA-256
    const rawToken = generateRandomToken();
    const tokenHash = hashToken(rawToken);
    const ttlMinutes = parseInt(process.env.RESET_TOKEN_TTL_MINUTES || '15', 10);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const ipAddress = req.ip || req.connection.remoteAddress;

    // 5. Lưu hash token vào DB
    await db.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at, ip_address)
       VALUES (?, ?, ?, ?)`,
      [user.id, tokenHash, expiresAt, ipAddress]
    );

    // 6. Gửi email chứa token gốc
    const emailResult = await sendResetPasswordEmail(user.email, user.username, rawToken);

    const responsePayload = {
      success: true,
      message: successResponseMsg,
    };

    // Trong môi trường dev, nếu không có SMTP thì trả link ra response để tiện test
    if (process.env.NODE_ENV === 'development') {
      if (emailResult.devLink) responsePayload.devLink = emailResult.devLink;
      if (emailResult.error) responsePayload.devError = emailResult.error;
    }

    return res.json(responsePayload);

  } catch (err) {
    console.error('❌ Lỗi forgotPassword:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ, vui lòng thử lại sau.',
    });
  }
}

/**
 * GET /api/auth/verify-reset-token?token=...
 * Kiểm tra tính hợp lệ của token trước khi hiển thị form
 */
async function verifyResetToken(req, res) {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ valid: false, message: 'Thiếu token.' });
  }

  try {
    const tokenHash = hashToken(String(token));

    const [rows] = await db.query(
      `SELECT id, expires_at, used_at FROM password_resets
       WHERE token_hash = ? AND expires_at > NOW() AND used_at IS NULL`,
      [tokenHash]
    );

    if (rows.length === 0) {
      return res.json({
        valid: false,
        message: 'Link đặt lại mật khẩu đã hết hạn hoặc đã được sử dụng. Vui lòng yêu cầu link mới.',
      });
    }

    return res.json({ valid: true });

  } catch (err) {
    console.error('❌ Lỗi verifyResetToken:', err);
    return res.json({ valid: false, message: 'Lỗi hệ thống.' });
  }
}

/**
 * POST /api/auth/reset-password
 * Đặt lại mật khẩu - bước 2: Đổi mật khẩu mới
 */
async function resetPassword(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(err => ({
      field: err.path || err.param,
      message: err.msg,
    }));
    return res.status(400).json({
      success: false,
      message: formattedErrors[0].message,
      errors: formattedErrors,
    });
  }

  const { token, password } = req.body;
  const tokenHash = hashToken(String(token));

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    // 1. Kiểm tra token trong DB
    const [resets] = await conn.query(
      `SELECT pr.id, pr.user_id, u.password as current_password_hash, u.email, u.username
       FROM password_resets pr
       JOIN users u ON pr.user_id = u.id
       WHERE pr.token_hash = ? AND pr.expires_at > NOW() AND pr.used_at IS NULL`,
      [tokenHash]
    );

    if (resets.length === 0) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: 'Link đặt lại mật khẩu đã hết hạn hoặc đã được sử dụng. Vui lòng yêu cầu link mới.',
      });
    }

    const resetRecord = resets[0];

    // 2. Chặn đặt lại mật khẩu trùng với mật khẩu cũ
    const isSamePassword = await bcrypt.compare(password, resetRecord.current_password_hash);
    if (isSamePassword) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: 'Mật khẩu mới không được trùng với mật khẩu hiện tại của bạn.',
        errors: [{ field: 'password', message: 'Mật khẩu mới trùng mật khẩu cũ' }],
      });
    }

    // 3. Hash mật khẩu mới cost 12
    const newHashedPassword = await bcrypt.hash(password, 12);

    // 4. Update password user & reset bộ đếm sai
    await conn.query(
      `UPDATE users
       SET password = ?, failed_login_attempts = 0, locked_until = NULL, updated_at = NOW()
       WHERE id = ?`,
      [newHashedPassword, resetRecord.user_id]
    );

    // 5. Đánh dấu token đã được sử dụng
    await conn.query(
      'UPDATE password_resets SET used_at = NOW() WHERE id = ?',
      [resetRecord.id]
    );

    // 6. Xóa toàn bộ refresh tokens của user này (đăng xuất khỏi tất cả thiết bị)
    await conn.query(
      'DELETE FROM refresh_tokens WHERE user_id = ?',
      [resetRecord.user_id]
    );

    await conn.commit();

    // Clear cookie nếu có
    res.clearCookie('refreshToken', { path: '/api/auth' });

    // 7. Gửi email thông báo đổi mật khẩu thành công
    sendPasswordChangedEmail(resetRecord.email, resetRecord.username).catch(() => {});

    return res.json({
      success: true,
      message: '🎉 Mật khẩu đã được thay đổi thành công! Vui lòng đăng nhập lại.',
    });

  } catch (err) {
    if (conn) await conn.rollback();
    console.error('❌ Lỗi resetPassword:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ, vui lòng thử lại sau.',
    });
  } finally {
    if (conn) conn.release();
  }
}

module.exports = {
  forgotPassword,
  verifyResetToken,
  resetPassword,
};
