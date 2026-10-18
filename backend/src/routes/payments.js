/**
 * Routes cho Payments
 *
 * Endpoints:
 * - POST /api/payments/orders            — Tạo đơn hàng mới (AUTH)
 * - POST /api/payments/create-order      — Alias tạo đơn hàng (AUTH)
 * - GET  /api/payments/orders/mine       — Danh sách đơn hàng của tôi (AUTH)
 * - GET  /api/payments/orders            — Alias danh sách đơn hàng (AUTH)
 * - GET  /api/payments/orders/:orderCode — Chi tiết một đơn (AUTH)
 * - POST /api/payments/orders/:orderCode/cancel — Hủy đơn hàng (AUTH)
 * - POST /api/payments/webhook/:provider — Webhook từ ngân hàng (NO AUTH, adapter verify)
 * - POST /api/payments/webhook           — Webhook mặc định SePay (NO AUTH)
 *
 * Author: Senior Full-Stack Developer
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  createOrder,
  listOrders,
  getOrder,
  cancelOrder,
  webhook,
} = require('../controllers/paymentController');

// Rate limiter cho việc tạo đơn hàng: 10 đơn/giờ/user (hoặc IP nếu chưa gắn user)
const createOrderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 giờ
  max: 10,
  keyGenerator: (req) => (req.user?.id ? `order_user_${req.user.id}` : req.ip),
  message: {
    success: false,
    message: 'Bạn đã tạo quá nhiều đơn hàng trong 1 giờ. Vui lòng thử lại sau.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// Rate limiter cho Webhook: 120 request/phút/IP (ngăn chặn DoS / spam webhook)
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 120,
  message: {
    success: false,
    message: 'Quá nhiều yêu cầu webhook từ địa chỉ IP này. Vui lòng giảm tần suất.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// Đơn hàng — yêu cầu xác thực
router.post('/orders', auth, createOrderLimiter, createOrder);
router.post('/create-order', auth, createOrderLimiter, createOrder); // Alias tương thích ngược
router.get('/orders/mine', auth, listOrders);
router.get('/orders', auth, listOrders); // Alias tương thích ngược
router.get('/orders/:orderCode', auth, getOrder);
router.post('/orders/:orderCode/cancel', auth, cancelOrder);

// Webhook — không dùng auth middleware, adapter tự xác thực token/Apikey
router.post('/webhook/:provider', webhookLimiter, webhook);
router.post('/webhook', webhookLimiter, webhook);

module.exports = router;
