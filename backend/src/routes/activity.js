/**
 * Routes cho Activity (thời gian online)
 *
 * Endpoints:
 * - POST /api/me/activity/heartbeat — Client báo "còn sống" (không có body)
 * - GET  /api/me/activity/me        — Xem thời gian online của chính mình
 *
 * Mount: app.use('/api/me/activity', activityRoutes)
 * Rate limit riêng: 6 lần/phút mỗi user (fallback IP) — heartbeat chạy mỗi
 * 30s nên con số này cho phép sai số mạng/refresh mà vẫn chặn spam.
 */

'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const auth = require('../middleware/auth');
const { heartbeat, getMyActivity } = require('../controllers/activityController');

// Helper: lấy IP thực (hỗ trợ X-Forwarded-For từ Nginx/Cloudflare)
function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.ip ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

// ── Rate Limit riêng cho heartbeat: 6 lần/phút, key theo user (fallback IP) ──
const heartbeatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  keyGenerator: (req) => (req.user?.id ? String(req.user.id) : getClientIp(req)),
  message: {
    success: false,
    message: 'Bạn gửi tín hiệu quá nhiều. Vui lòng thử lại sau 1 phút.',
  },
});

// Endpoint chính — yêu cầu đăng nhập, không nhận body
router.post('/heartbeat', auth, heartbeatLimiter, heartbeat);

// Tiện ích: xem thời gian online của chính mình
router.get('/me', auth, getMyActivity);

module.exports = router;