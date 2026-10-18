/**
 * Routes cho Admin
 *
 * Tất cả các route yêu cầu quyền admin (auth + requireAdmin middleware toàn bộ)
 *
 * Endpoints:
 * - GET  /api/admin/stats                           — Thống kê
 * - GET  /api/admin/users                          — Danh sách users (phân trang, tìm kiếm)
 * - GET  /api/admin/users/:id                      — Chi tiết user + entitlements
 * - POST /api/admin/users/:id/entitlements        — Cấp entitlement
 * - DELETE /api/admin/users/:id/entitlements/:packageId — Thu hồi entitlement
 * - GET  /api/admin/orders                         — Danh sách orders (phân trang, lọc, tìm kiếm)
 * - GET  /api/admin/transactions                   — Danh sách giao dịch ngân hàng
 * - POST /api/admin/grant                          — Cấp gói trực tiếp (ghi log audit)
 * - GET  /api/admin/payments/mismatches            — Giao dịch lỗi cần reconcile
 *
 * Author: Senior Full-Stack Developer
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const {
  getStats,
  listUsers,
  getUserDetail,
  grantEntitlement,
  revokeEntitlement,
  listAdminOrders,
  listAdminTransactions,
  grantPackageDirect,
  getMismatches,
  reconcileTransaction,
  listAuditLogs,
} = require('../controllers/adminController');

// Áp dụng auth VÀ requireAdmin cho TOÀN BỘ route trong router này
router.use(auth, requireAdmin);

// Stats
router.get('/stats', getStats);

// Users
router.get('/users', listUsers);
router.get('/users/:id', getUserDetail);
router.post('/users/:id/entitlements', grantEntitlement);
router.delete('/users/:id/entitlements/:packageId', revokeEntitlement);

// Orders & Transactions
router.get('/orders', listAdminOrders);
router.get('/transactions', listAdminTransactions);
router.post('/grant', grantPackageDirect);

// Payments mismatches & reconciliation
router.get('/payments/mismatches', getMismatches);
router.post('/payments/reconcile', reconcileTransaction);

// Audit logs
router.get('/audit-logs', listAuditLogs);

module.exports = router;
