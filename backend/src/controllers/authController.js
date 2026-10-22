const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const db = require('../config/db');
const {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
} = require('../utils/tokens');
const { invalidateEntitlementCache } = require('../utils/entitlementCache');

// Dummy hash dùng để chống Timing Attack khi email/username không tồn tại
const DUMMY_HASH = '$2b$12$eIXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';

/**
 * Utility đặt cookie Refresh Token httpOnly
 */
function setRefreshTokenCookie(res, refreshToken, rememberMe = false) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth',
  };

  if (rememberMe) {
    cookieOptions.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 ngày
  }

  res.cookie('refreshToken', refreshToken, cookieOptions);
}

/**
 * POST /api/auth/register
 */
async function register(req, res) {
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

  const { firstName, lastName, username, email, password, birthYear } = req.body;
  const cleanEmail = email.trim().toLowerCase();
  const cleanUsername = username.trim();

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    // Kiểm tra trùng lặp email
    const [existingEmail] = await conn.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [cleanEmail]
    );
    if (existingEmail.length > 0) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        message: 'Email này đã được đăng ký, vui lòng dùng email khác!',
        errors: [{ field: 'email', message: 'Email này đã được đăng ký' }]
      });
    }

    // Kiểm tra trùng lặp username
    const [existingUser] = await conn.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [cleanUsername]
    );
    if (existingUser.length > 0) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        message: 'Tên đăng nhập đã tồn tại, hãy chọn tên khác!',
        errors: [{ field: 'username', message: 'Tên đăng nhập đã tồn tại' }]
      });
    }

    // Hash password bcrypt cost 12
    const hashedPassword = await bcrypt.hash(password, 12);

    // Thêm user mới
    const [result] = await conn.query(
      `INSERT INTO users (first_name, last_name, username, email, password, birth_year, level, points)
       VALUES (?, ?, ?, ?, ?, ?, 'Rookie', 0)`,
      [firstName.trim(), lastName.trim(), cleanUsername, cleanEmail, hashedPassword, birthYear || null]
    );

    const userId = result.insertId;
    const userPayload = { id: userId, username: cleanUsername, level: 'Rookie', role: 'user' };

    // Sinh token
    const accessToken = generateAccessToken(userPayload);
    const refreshToken = generateRefreshToken(userPayload, null, true);
    const refreshTokenHash = hashToken(refreshToken);

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const ipAddress = req.ip || req.connection.remoteAddress;

    // Lưu hash refresh token vào DB (không lưu plaintext)
    await conn.query(
      `INSERT INTO refresh_tokens (user_id, token, token_hash, expires_at, user_agent, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, refreshTokenHash, refreshTokenHash, expiresAt, userAgent.substring(0, 255), ipAddress]
    );

    await conn.commit();

    // Set Refresh Token HTTP-only cookie
    setRefreshTokenCookie(res, refreshToken, true);

    return res.status(201).json({
      success: true,
      message: '🎉 Tạo tài khoản thành công! Chào mừng gia nhập CyberKnight!',
      user: {
        id: userId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: cleanUsername,
        email: cleanEmail,
        level: 'Rookie',
        role: 'user',
        points: 0,
        birthYear,
        joinDate: new Date().toLocaleDateString('vi-VN'),
      },
      accessToken,
    });

  } catch (err) {
    if (conn) await conn.rollback();
    console.error('❌ Lỗi register:', err);

    if (db.isDuplicateError(err)) {
      return res.status(409).json({
        success: false,
        message: 'Tên đăng nhập hoặc email đã tồn tại!',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ, vui lòng thử lại sau.',
    });
  } finally {
    if (conn) conn.release();
  }
}

/**
 * POST /api/auth/login
 */
async function login(req, res) {
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

  const { emailOrUsername, password, rememberMe } = req.body;
  const identifier = emailOrUsername.trim().toLowerCase();

  try {
    // Tìm user theo email hoặc username
    const [rows] = await db.query(
      `SELECT * FROM users WHERE (LOWER(email) = ? OR LOWER(username) = ?) AND is_active = TRUE`,
      [identifier, identifier]
    );

    // Chống Timing Attack: Nếu user không tồn tại, vẫn chạy bcrypt.compare giả
    if (rows.length === 0) {
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({
        success: false,
        message: 'Email/tên đăng nhập hoặc mật khẩu không đúng!',
      });
    }

    const user = rows[0];

    // Kiểm tra khóa tài khoản tạm thời do sai mật khẩu quá 5 lần
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const remainingMinutes = Math.ceil((new Date(user.locked_until) - new Date()) / (60 * 1000));
      return res.status(429).json({
        success: false,
        message: `Tài khoản của bạn tạm thời bị khóa do nhập sai mật khẩu quá 5 lần. Vui lòng thử lại sau ${remainingMinutes} phút.`,
        locked: true,
        remainingMinutes,
      });
    }

    // So sánh mật khẩu
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      // Tăng số lần đăng nhập sai
      const newFailedAttempts = (user.failed_login_attempts || 0) + 1;
      let lockSql = 'UPDATE users SET failed_login_attempts = ? WHERE id = ?';
      let lockParams = [newFailedAttempts, user.id];

      if (newFailedAttempts >= 5) {
        // Sai 5 lần -> Khóa 15 phút
        const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
        lockSql = 'UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?';
        lockParams = [newFailedAttempts, lockUntil, user.id];
      }

      await db.query(lockSql, lockParams);

      return res.status(401).json({
        success: false,
        message: 'Email/tên đăng nhập hoặc mật khẩu không đúng!',
      });
    }

    // Đăng nhập thành công -> Reset bộ đếm sai & locked_until
    await db.query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = ?',
      [user.id]
    );

    // Sinh tokens
    const userPayload = { id: user.id, username: user.username, level: user.level, role: user.role || 'user' };
    const accessToken = generateAccessToken(userPayload);
    const isRemember = Boolean(rememberMe);
    const refreshToken = generateRefreshToken(userPayload, null, isRemember);
    const refreshTokenHash = hashToken(refreshToken);

    const ttlDays = isRemember ? 30 : 7;
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const ipAddress = req.ip || req.connection.remoteAddress;

    // Lưu hash token mới (cho phép nhiều thiết bị đăng nhập song song)
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token, token_hash, expires_at, user_agent, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user.id, refreshTokenHash, refreshTokenHash, expiresAt, userAgent.substring(0, 255), ipAddress]
    );

    // Set cookie
    setRefreshTokenCookie(res, refreshToken, isRemember);

    return res.json({
      success: true,
      message: `🎉 Chào mừng trở lại, ${user.first_name}!`,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        email: user.email,
        level: user.level,
        role: user.role || 'user',
        points: user.points,
        birthYear: user.birth_year,
      },
      accessToken,
    });

  } catch (err) {
    console.error('❌ Lỗi login:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ, vui lòng thử lại sau.',
    });
  }
}

/**
 * POST /api/auth/refresh - Cấp Access Token mới và xoay vòng Refresh Token
 */
async function refresh(req, res) {
  const tokenFromCookie = req.cookies && req.cookies.refreshToken;
  const tokenFromBody = req.body && req.body.refreshToken;
  const rawToken = tokenFromCookie || tokenFromBody;

  if (!rawToken) {
    return res.status(401).json({
      success: false,
      message: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.',
    });
  }

  try {
    const hashed = hashToken(rawToken);

    // Kiểm tra token hash trong DB
    const [rows] = await db.query(
      'SELECT * FROM refresh_tokens WHERE (token_hash = ? OR token = ?) AND expires_at > NOW()',
      [hashed, hashed]
    );

    if (rows.length === 0) {
      // KHÔNG clearCookie ở đây.
      //
      // Lý do: refresh token được XOAY VÒNG (xoá bản ghi cũ sau mỗi lần
      // refresh). Khi 2 request refresh chạy SONG SONG (nhiều tab, hoặc nhiều
      // request admin cùng gặp 401), chỉ request đến trước thắng; request sau
      // nhận 403 vì token của nó đã bị xoay đi. Nếu clearCookie() chạy ở đây,
      // trình duyệt sẽ XOÁ mất cookie HỢP LỆ mà request thắng vừa cấp -> người
      // dùng bị đăng xuất oan, phải đăng nhập lại dù phiên còn hợp lệ.
      //
      // Cookie cũ vẫn hợp lệ và sẽ được dùng lại ở lần refresh kế tiếp.
      return res.status(403).json({
        success: false,
        message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
      });
    }

    const currentTokenRecord = rows[0];

    // Verify JWT
    const decoded = jwt.verify(rawToken, process.env.JWT_REFRESH_SECRET);

    // Lấy thông tin user
    const [users] = await db.query(
      'SELECT id, username, email, level, first_name, last_name, points, birth_year, role FROM users WHERE id = ? AND is_active = TRUE',
      [decoded.id]
    );

    if (users.length === 0) {
      res.clearCookie('refreshToken', { path: '/api/auth' });
      return res.status(403).json({
        success: false,
        message: 'Tài khoản không còn tồn tại hoặc đã bị khóa.',
      });
    }

    const user = users[0];
    const userPayload = { id: user.id, username: user.username, level: user.level, role: user.role || 'user' };

    // Xoay vòng Refresh Token (Token Rotation)
    // 1. Xóa token cũ
    await db.query('DELETE FROM refresh_tokens WHERE id = ?', [currentTokenRecord.id]);

    // 2. Tạo refresh token mới
    const newRefreshToken = generateRefreshToken(userPayload, null, true);
    const newHashed = hashToken(newRefreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const ipAddress = req.ip || req.connection.remoteAddress;

    await db.query(
      `INSERT INTO refresh_tokens (user_id, token, token_hash, expires_at, user_agent, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user.id, newHashed, newHashed, expiresAt, userAgent.substring(0, 255), ipAddress]
    );

    // 3. Cấp access token mới
    const newAccessToken = generateAccessToken(userPayload);

    // 4. Set cookie mới
    setRefreshTokenCookie(res, newRefreshToken, true);

    return res.json({
      success: true,
      accessToken: newAccessToken,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        email: user.email,
        level: user.level,
        role: user.role || 'user',
        points: user.points,
        birthYear: user.birth_year,
      },
    });

  } catch (err) {
    res.clearCookie('refreshToken', { path: '/api/auth' });
    return res.status(403).json({
      success: false,
      message: 'Refresh token không hợp lệ hoặc đã hết hạn.',
    });
  }
}

/**
 * POST /api/auth/logout - Xóa phiên hiện tại
 */
async function logout(req, res) {
  const tokenFromCookie = req.cookies && req.cookies.refreshToken;
  const tokenFromBody = req.body && req.body.refreshToken;
  const rawToken = tokenFromCookie || tokenFromBody;

  if (rawToken) {
    const hashed = hashToken(rawToken);
    await db.query(
      'DELETE FROM refresh_tokens WHERE token_hash = ? OR token = ?',
      [hashed, hashed]
    ).catch(() => {});
  }

  res.clearCookie('refreshToken', { path: '/api/auth' });
  return res.json({
    success: true,
    message: 'Đăng xuất thành công!',
  });
}

/**
 * POST /api/auth/logout-all - Đăng xuất khỏi mọi thiết bị
 */
async function logoutAll(req, res) {
  if (req.user && req.user.id) {
    await db.query('DELETE FROM refresh_tokens WHERE user_id = ?', [req.user.id]).catch(() => {});
  }
  res.clearCookie('refreshToken', { path: '/api/auth' });
  return res.json({
    success: true,
    message: 'Đã đăng xuất khỏi tất cả các thiết bị!',
  });
}

/**
 * GET /api/auth/me
 */
async function getMe(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT id, first_name, last_name, username, email, birth_year, level, points, avatar_url, created_at, last_login, role
       FROM users WHERE id = ? AND is_active = TRUE`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy người dùng.',
      });
    }

    const u = rows[0];
    return res.json({
      success: true,
      user: {
        id: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
        username: u.username,
        email: u.email,
        birthYear: u.birth_year,
        level: u.level,
        role: u.role || 'user',
        points: u.points,
        avatarUrl: u.avatar_url,
        joinDate: u.created_at,
        lastLogin: u.last_login,
      },
    });

  } catch (err) {
    console.error('❌ Lỗi getMe:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

/**
 * GET /api/auth/check-username?u=...
 * Kiểm tra tên đăng nhập có rảnh không (cho frontend debounce)
 */
async function checkUsername(req, res) {
  const username = req.query.u ? String(req.query.u).trim() : '';

  if (!username || username.length < 3 || username.length > 30) {
    return res.json({ available: false, message: 'Tên đăng nhập phải từ 3 đến 30 ký tự' });
  }

  if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) {
    return res.json({ available: false, message: 'Tên đăng nhập chỉ gồm chữ, số, dấu gạch dưới, gạch ngang hoặc dấu chấm' });
  }

  try {
    const [rows] = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    return res.json({
      available: rows.length === 0,
    });
  } catch (err) {
    return res.json({ available: false });
  }
}

/**
 * POST /api/auth/change-password
 * Đổi mật khẩu khi đã đăng nhập (auth required)
 * 1. Xác minh currentPassword
 * 2. Hash newPassword (bcrypt cost 12)
 * 3. UPDATE users SET password = newHash
 * 4. Xóa TẤT CẢ refresh_tokens của user (logout all devices)
 * 5. Xóa entitlement cache của user
 * Rate limit: 5 lần / giờ / user (xem auth.js)
 */
async function changePassword(req, res) {
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

  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    // 1. Lấy password hash hiện tại của user
    const [users] = await conn.query(
      'SELECT password FROM users WHERE id = ? AND is_active = TRUE',
      [userId]
    );
    if (users.length === 0) {
      await conn.rollback();
      return res.status(401).json({
        success: false,
        message: 'Không tìm thấy tài khoản.',
      });
    }

    // 2. Xác minh mật khẩu hiện tại
    const isMatch = await bcrypt.compare(currentPassword, users[0].password);
    if (!isMatch) {
      await conn.rollback();
      return res.status(401).json({
        success: false,
        message: 'Mật khẩu hiện tại không đúng.',
      });
    }

    // 3. Hash mật khẩu mới
    const newHash = await bcrypt.hash(newPassword, 12);

    // 4. UPDATE password + reset failed attempts
    await conn.query(
      'UPDATE users SET password = ?, failed_login_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = ?',
      [newHash, userId]
    );

    // 5. Revoke ALL refresh tokens của user (logout all devices)
    await conn.query(
      'DELETE FROM refresh_tokens WHERE user_id = ?',
      [userId]
    );

    await conn.commit();

    // 6. Clear entitlement cache của user (nếu có)
    invalidateEntitlementCache(userId);

    return res.json({
      success: true,
      message: 'Mật khẩu đã được thay đổi thành công. Tất cả các phiên đăng nhập khác đã bị thu hồi.',
    });

  } catch (err) {
    if (conn) await conn.rollback();
    console.error('❌ Lỗi changePassword:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ, vui lòng thử lại sau.',
    });
  } finally {
    if (conn) conn.release();
  }
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  getMe,
  checkUsername,
  changePassword,
};
