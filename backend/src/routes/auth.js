const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  register, login, refresh, logout, logoutAll, getMe, checkUsername, changePassword
} = require('../controllers/authController');
const {
  forgotPassword, verifyResetToken, resetPassword
} = require('../controllers/passwordController');
const {
  registerValidation, loginValidation,
  forgotPasswordValidation, resetPasswordValidation,
  changePasswordValidation
} = require('../utils/validators');

// ── Rate Limiters Riêng Biệt Cho Từng Route ─────────────────
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

const defaultLimiterConfig = {
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
};

// ── Register: 30 lần / giờ / IP ─────────────────────────────
const registerLimiter = rateLimit({
  ...defaultLimiterConfig,
  windowMs: 60 * 60 * 1000, // 1 giờ
  max: process.env.NODE_ENV === 'production' ? 30 : 100,
  keyGenerator: (req) => getClientIp(req),
  message: {
    success: false,
    message: 'Bạn đã thử đăng ký quá nhiều lần. Vui lòng quay lại sau 1 giờ nhé!',
  },
});

// ── Login: 10 lần / 15 phút / (IP + emailOrUsername), + IP cap 300/15ph ──
// IP cap được áp dụng trước (tổng quát), sau đó mới kiểm tra per-user
const loginIpLimiter = rateLimit({
  ...defaultLimiterConfig,
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator: (req) => getClientIp(req),
  message: {
    success: false,
    message: 'Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau 15 phút.',
  },
});

const loginLimiter = rateLimit({
  ...defaultLimiterConfig,
  windowMs: 15 * 60 * 1000, // 15 phút
  max: process.env.NODE_ENV === 'production' ? 10 : 200,
  keyGenerator: (req) =>
    getClientIp(req) + ':' + (req.body?.emailOrUsername || '').toLowerCase().trim(),
  message: {
    success: false,
    message: 'Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau 15 phút.',
  },
});

// ── Forgot Password: 3 lần / giờ / email + IP cap 30/giờ ─────────────
// IP cap chung (ngăn 1 IP spam nhiều email khác nhau)
const forgotPasswordIpLimiter = rateLimit({
  ...defaultLimiterConfig,
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => getClientIp(req),
  message: {
    success: false,
    message: 'Bạn đã yêu cầu đặt lại mật khẩu quá nhiều lần. Vui lòng thử lại sau 1 giờ.',
  },
});

const forgotPasswordLimiter = rateLimit({
  ...defaultLimiterConfig,
  windowMs: 60 * 60 * 1000, // 1 giờ
  max: process.env.NODE_ENV === 'development' ? 100 : 3,
  keyGenerator: (req) => (req.body?.email || '').toLowerCase().trim(),
  message: {
    success: false,
    message: 'Bạn đã yêu cầu đặt lại mật khẩu quá nhiều lần. Vui lòng thử lại sau 1 giờ.',
  },
});

const resetPasswordLimiter = rateLimit({
  ...defaultLimiterConfig,
  windowMs: 60 * 60 * 1000, // 1 giờ
  max: 5,
  message: {
    success: false,
    message: 'Quá nhiều yêu cầu đặt lại mật khẩu. Vui lòng thử lại sau.',
  },
});

const refreshLimiter = rateLimit({
  ...defaultLimiterConfig,
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 30,
  message: {
    success: false,
    message: 'Quá nhiều yêu cầu làm mới phiên.',
  },
});

const checkUsernameLimiter = rateLimit({
  ...defaultLimiterConfig,
  windowMs: 60 * 1000, // 1 phút
  max: 30,
  message: {
    success: false,
    message: 'Quá nhiều yêu cầu kiểm tra tên đăng nhập. Vui lòng thử lại sau 1 phút.',
  },
});

// ── Change Password: 5 lần / giờ / user (auth required) ──────────
const changePasswordLimiter = rateLimit({
  ...defaultLimiterConfig,
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.user?.id ? String(req.user.id) : getClientIp(req),
  message: {
    success: false,
    message: 'Bạn đã yêu cầu đổi mật khẩu quá nhiều lần. Vui lòng thử lại sau 1 giờ.',
  },
});

// ── Public Routes ──────────────────────────────────────────
router.post('/register', registerLimiter, registerValidation, register);
router.post('/login', loginIpLimiter, loginLimiter, loginValidation, login);
router.post('/refresh', refreshLimiter, refresh);
router.post('/refresh-token', refreshLimiter, refresh);
router.post('/logout', logout);
router.get('/check-username', checkUsernameLimiter, checkUsername);

// ── Password Reset Routes ──────────────────────────────────
router.post('/forgot-password', forgotPasswordIpLimiter, forgotPasswordLimiter, forgotPasswordValidation, forgotPassword);
router.get('/verify-reset-token', verifyResetToken);
router.post('/reset-password', resetPasswordLimiter, resetPasswordValidation, resetPassword);

// ── Protected Routes ───────────────────────────────────────
router.get('/me', auth, getMe);
router.post('/logout-all', auth, logoutAll);
router.post('/change-password', auth, changePasswordLimiter, changePasswordValidation, changePassword);

module.exports = router;
