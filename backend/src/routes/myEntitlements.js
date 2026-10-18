/**
 * Routes cho User Self-Service Entitlements
 *
 * Endpoints:
 * - GET  /api/me/entitlements           — Lấy entitlements hiện tại
 * - DELETE /api/me/entitlements/:packageId — Hủy entitlement (chỉ admin_grant)
 *
 * Author: Senior Full-Stack Developer
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  getMyEntitlements,
  cancelMyEntitlement,
} = require('../controllers/myEntitlementsController');

// Tất cả yêu cầu đăng nhập
router.get('/', auth, getMyEntitlements);
router.delete('/:packageId', auth, cancelMyEntitlement);

module.exports = router;
