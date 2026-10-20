const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { createTransporter } = require('../utils/mailer');

// ── Rate limiter: tối đa 10 requests / 10 phút / IP ──────────
const feedbackLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: 'Bạn đã gửi phản hồi quá nhiều lần. Vui lòng chờ 10 phút nhé!',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

/**
 * Tìm user trong DB theo token JWT đã verify
 */
async function getUserFromToken(token, secret) {
  try {
    const decoded = jwt.verify(token, secret);
    if (!decoded?.id) return null;
    const [users] = await db.query(
      'SELECT id, username, email, first_name, last_name FROM users WHERE id = ? AND is_active = TRUE',
      [decoded.id]
    );
    return users[0] || null;
  } catch {
    return null;
  }
}

/**
 * Xác thực và tìm thông tin người dùng từ Bearer Token hoặc Refresh Token cookie
 */
async function resolveUser(req) {
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (bearerToken) {
    const user = await getUserFromToken(bearerToken, process.env.JWT_SECRET);
    if (user) return user;
  }

  const refreshToken = req.cookies?.refreshToken;
  if (refreshToken) {
    return getUserFromToken(refreshToken, process.env.JWT_REFRESH_SECRET);
  }

  return null;
}

/**
 * Lưu feedback vào database với đầy đủ metadata
 */
async function recordFeedback({ userId = null, name, email, category, message, ip, userAgent, status, error = null }) {
  try {
    await db.query(
      `INSERT INTO feedbacks (user_id, name, email, category, message, ip, user_agent, status, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [userId, name, email, category, message, ip, userAgent, status, error]
    );
  } catch (dbErr) {
    console.error('⚠️ Lỗi ghi feedback vào database:', dbErr.message);
  }
}

/**
 * Kiểm tra tính hợp lệ cơ bản của dữ liệu form
 */
function validateFeedbackForm({ name, category, message }) {
  const cleanName = (name || '').trim();
  if (!cleanName || cleanName.length > 100) {
    return 'Vui lòng nhập họ và tên (tối đa 100 ký tự).';
  }
  if (/[<>]/.test(cleanName)) {
    return 'Họ và tên không được chứa ký tự < hoặc >.';
  }
  if (/[\x00-\x1F\x7F]/.test(cleanName)) {
    return 'Họ và tên không được chứa ký tự điều khiển.';
  }

  const cleanCategory = (category || '').trim();
  if (!cleanCategory || cleanCategory.length > 50) {
    return 'Vui lòng chọn loại liên hệ.';
  }
  if (/[<>]/.test(cleanCategory) || /[\x00-\x1F\x7F]/.test(cleanCategory)) {
    return 'Loại liên hệ không hợp lệ.';
  }

  const cleanMessage = (message || '').trim();
  if (!cleanMessage || cleanMessage.length < 5 || cleanMessage.length > 5000) {
    return 'Nội dung tin nhắn phải từ 5 đến 5000 ký tự.';
  }
  // Loại trừ \t, \n, \r; chặn các ký tự điều khiển ẩn khác
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(cleanMessage)) {
    return 'Nội dung tin nhắn chứa ký tự điều khiển không hợp lệ.';
  }

  return null;
}

/**
 * Xác định thông tin người gửi: từ tài khoản đăng nhập hoặc email khách nhập
 */
function determineSenderInfo(currentUser, body, rawName) {
  if (currentUser) {
    const userEmail = currentUser.email;
    const userId = currentUser.id;
    const senderDisplay = currentUser.username || `${currentUser.first_name} ${currentUser.last_name || ''}`.trim() || userEmail;
    return { userEmail, userId, senderDisplay, error: null };
  }

  const clientEmail = (body.email || '').trim();
  const atIdx = clientEmail.indexOf('@');
  const dotIdx = clientEmail.lastIndexOf('.');
  const isEmailValid = atIdx > 0 && dotIdx > atIdx + 1 && dotIdx < clientEmail.length - 1 && !/\s/.test(clientEmail);

  if (!clientEmail || !isEmailValid || clientEmail.length > 255) {
    return {
      userEmail: '',
      userId: null,
      senderDisplay: '',
      error: 'Vui lòng nhập địa chỉ email hợp lệ để chúng mình có thể phản hồi cho bạn nhé!',
    };
  }

  return {
    userEmail: clientEmail,
    userId: null,
    senderDisplay: `${rawName} <${clientEmail}> (Khách)`,
    error: null,
  };
}

/**
 * POST /api/feedback
 * Gửi feedback từ người dùng tới admin với email tài khoản làm Reply-To
 */
router.post('/', feedbackLimiter, async (req, res) => {
  try {
    const { name, category, message } = req.body;

    // 1. Kiểm tra validation nội dung
    const formError = validateFeedbackForm({ name, category, message });
    if (formError) {
      return res.status(400).json({ success: false, message: formError });
    }

    const rawName = name.trim();
    const rawCategory = category.trim();
    const rawMessage = message.trim();

    // 2. Xác thực danh tính người gửi
    const currentUser = await resolveUser(req);
    const senderInfo = determineSenderInfo(currentUser, req.body, rawName);
    if (senderInfo.error) {
      return res.status(400).json({ success: false, message: senderInfo.error });
    }

    const { userEmail, userId, senderDisplay } = senderInfo;

    // 3. Làm sạch dữ liệu chống Header Injection (loại bỏ CRLF)
    const sanitizedName = rawName.replace(/[\r\n]/g, ' ').trim();
    const sanitizedEmail = userEmail.replace(/[\r\n]/g, '').trim();
    const sanitizedCategory = rawCategory.replace(/[\r\n]/g, ' ').trim();

    const ip = req.ip || req.connection?.remoteAddress || 'Unknown';
    const userAgent = (req.headers['user-agent'] || 'Unknown').substring(0, 500);

    const adminEmail = process.env.FEEDBACK_TO || 'he182125vuduchieu@gmail.com';
    const subject = `[Feedback] ${sanitizedCategory} — từ ${senderDisplay}`;
    const text = `Từ: ${sanitizedName} <${sanitizedEmail}>${currentUser ? ' (Đã xác thực tài khoản #' + currentUser.id + ')' : ' (Khách)'}\n` +
      `Loại liên hệ: ${sanitizedCategory}\n\n` +
      `Nội dung tin nhắn:\n${rawMessage}\n\n` +
      `---\n` +
      `IP: ${ip}\n` +
      `User-Agent: ${userAgent}\n` +
      `Thời gian: ${new Date().toLocaleString('vi-VN')}`;

    let transporter = null;
    try {
      transporter = createTransporter();
    } catch (tErr) {
      console.error('❌ Lỗi khởi tạo Transporter:', tErr);
    }

    // Nếu không có SMTP cấu hình -> Lưu DB và trả 202 (dev fallback)
    if (!transporter) {
      const errMsg = 'Chưa cấu hình máy chủ SMTP (dev mode).';
      console.warn(`⚠️ [FEEDBACK DEV FALLBACK] ${errMsg} Đang lưu vào DB feedbacks...`);

      await recordFeedback({
        userId,
        name: sanitizedName,
        email: sanitizedEmail,
        category: sanitizedCategory,
        message: rawMessage,
        ip,
        userAgent,
        status: 'saved',
        error: errMsg,
      });

      const payload = {
        success: true,
        message: 'Tin nhắn đã được lưu; gửi email tạm thời thất bại — admin sẽ kiểm tra.',
      };
      if (process.env.NODE_ENV === 'development') {
        payload.devError = errMsg;
      }
      return res.status(202).json(payload);
    }

    // Cố gắng gửi qua SMTP của ứng dụng với Reply-To là email tài khoản người dùng
    try {
      await transporter.verify();

      await transporter.sendMail({
        from: process.env.SMTP_FROM || '"CyberKnight Shield" <no-reply@sigmabloom.vn>',
        to: adminEmail,
        replyTo: `${sanitizedName} <${sanitizedEmail}>`,
        headers: {
          'X-Feedback-From': sanitizedEmail,
          'X-Feedback-UserId': userId ? String(userId) : 'guest',
        },
        subject,
        text,
      });

      // Ghi log feedback gửi thành công vào DB
      await recordFeedback({
        userId,
        name: sanitizedName,
        email: sanitizedEmail,
        category: sanitizedCategory,
        message: rawMessage,
        ip,
        userAgent,
        status: 'sent',
      });

      return res.status(200).json({
        success: true,
        message: 'Gửi thành công — cảm ơn bạn.',
      });

    } catch (err) {
      console.error('❌ Lỗi gửi email feedback qua SMTP:', err);
      const briefError = err?.message || String(err);

      await recordFeedback({
        userId,
        name: sanitizedName,
        email: sanitizedEmail,
        category: sanitizedCategory,
        message: rawMessage,
        ip,
        userAgent,
        status: 'saved',
        error: briefError,
      });

      const payload = {
        success: true,
        message: 'Tin nhắn đã được lưu; gửi email tạm thời thất bại — admin sẽ kiểm tra.',
      };
      if (process.env.NODE_ENV === 'development') {
        payload.devError = briefError;
      }
      return res.status(202).json(payload);
    }

  } catch (serverErr) {
    console.error('❌ Lỗi xử lý feedback:', serverErr);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ, vui lòng thử lại sau.',
    });
  }
});

module.exports = router;
