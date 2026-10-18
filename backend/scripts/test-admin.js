/**
 * PHASE 6 — Automated Integration Test Suite for Admin Portal & Operations
 *
 * Chạy: node backend/scripts/test-admin.js
 *
 * Các kịch bản kiểm thử:
 * 1. Chặn truy cập không xác thực (Unauthenticated) → 401 Unauthorized trên toàn bộ Admin API.
 * 2. Chặn token có chữ ký giả mạo / không hợp lệ (Tampered JWT) → 401/403.
 * 3. Chặn người dùng thường (role = 'user') → 403 Forbidden.
 * 4. Chặn tài khoản bị vô hiệu hóa (is_active = 0) → 401 Account Disabled.
 * 5. Chống leo thang đặc quyền (Privilege Escalation): Token tự phong role='admin' nhưng DB là 'user' → 403 Forbidden.
 * 6. Admin hợp lệ lấy thống kê tổng quan (GET /api/admin/stats) với đầy đủ 6 chỉ số.
 * 7. Admin quản lý người dùng: danh sách phân trang (GET /api/admin/users) và chi tiết user (GET /api/admin/users/:id).
 * 8. Admin cấp gói thủ công (POST /api/admin/grant) → Vĩnh viễn (expires_at = null) + Ghi nhật ký admin_audit_log.
 * 9. Admin cấp & thu hồi entitlement trực tiếp (POST / DELETE /api/admin/users/:id/entitlements) + Ghi audit log.
 * 10. Admin quản lý đơn hàng (GET /api/admin/orders) & giao dịch (GET /api/admin/transactions).
 * 11. Admin đối soát giao dịch (POST /api/admin/payments/reconcile) → Khớp giao dịch, cập nhật đơn paid, cấp quyền vĩnh viễn, ghi audit log.
 * 12. Admin xem nhật ký hoạt động (GET /api/admin/audit-logs) hỗ trợ phân trang và lọc theo hành động.
 * 13. Dọn dẹp dữ liệu kiểm thử (Clean-up).
 *
 * Author: Senior Full-Stack Developer
 */

'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const envPath = fs.existsSync(path.join(__dirname, '../.env'))
  ? path.join(__dirname, '../.env')
  : path.join(__dirname, '../../.env');
require('dotenv').config({ path: envPath });

const db = require('../src/config/db');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'sigmabloom_jwt_secret_key_change_in_production_2026';

let passed = 0;
let failed = 0;

function assert(condition, label, details) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    if (details) console.log(`     Chi tiết: ${details}`);
    failed++;
  }
}

function request(options, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path || '/', BASE_URL);
    const opt = {
      hostname: url.hostname,
      port: url.port || 80,
      path: options.path || '/',
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    };

    const req = http.request(opt, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      req.write(bodyStr);
    }
    req.end();
  });
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   PHASE 6 — Test Suite Tự Động Quản Trị & Đối Soát (Admin)   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const ts = Date.now();
  const studentUser = {
    firstName: 'HocSinh',
    lastName: 'Test',
    username: `student_${ts}`,
    email: `student_admin_test_${ts}@sigmabloom.vn`,
    password: 'P@ssword123456!',
  };

  const createdUserIds = [];
  const createdOrderIds = [];
  const createdTxIds = [];

  try {
    // ── 1. Kiểm tra chặn Unauthenticated ──
    console.log('── 1. Kiểm tra chặn yêu cầu không xác thực (Unauthenticated) ──');
    const unauthStats = await request({ method: 'GET', path: '/api/admin/stats' });
    assert(unauthStats.status === 401, 'GET /api/admin/stats chặn 401 khi không có token');

    const unauthUsers = await request({ method: 'GET', path: '/api/admin/users' });
    assert(unauthUsers.status === 401, 'GET /api/admin/users chặn 401 khi không có token');

    const unauthOrders = await request({ method: 'GET', path: '/api/admin/orders' });
    assert(unauthOrders.status === 401, 'GET /api/admin/orders chặn 401 khi không có token');

    const unauthTxs = await request({ method: 'GET', path: '/api/admin/transactions' });
    assert(unauthTxs.status === 401, 'GET /api/admin/transactions chặn 401 khi không có token');

    const unauthMismatches = await request({ method: 'GET', path: '/api/admin/payments/mismatches' });
    assert(unauthMismatches.status === 401, 'GET /api/admin/payments/mismatches chặn 401 khi không có token');

    const unauthGrant = await request({ method: 'POST', path: '/api/admin/grant' }, { package_id: 'pack_1_4' });
    assert(unauthGrant.status === 401, 'POST /api/admin/grant chặn 401 khi không có token');

    const unauthReconcile = await request({ method: 'POST', path: '/api/admin/payments/reconcile' }, { transaction_id: 1 });
    assert(unauthReconcile.status === 401, 'POST /api/admin/payments/reconcile chặn 401 khi không có token');

    const unauthLogs = await request({ method: 'GET', path: '/api/admin/audit-logs' });
    assert(unauthLogs.status === 401, 'GET /api/admin/audit-logs chặn 401 khi không có token');

    // ── 2. Kiểm tra token giả mạo chữ ký (Tampered JWT) ──
    console.log('\n── 2. Kiểm tra token giả mạo chữ ký (Tampered JWT) ──');
    const tamperedRes = await request({
      method: 'GET',
      path: '/api/admin/stats',
      headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.tampered.signature' },
    });
    assert(tamperedRes.status === 401 || tamperedRes.status === 403, `Chặn token giả mạo (HTTP ${tamperedRes.status})`);

    // ── 3. Chuẩn bị người dùng học sinh thường (role = 'user') ──
    console.log('\n── 3. Kiểm tra chặn người dùng thường (role = "user") ──');
    await request({ method: 'POST', path: '/api/auth/register' }, {
      ...studentUser,
      confirmPassword: studentUser.password,
      birthYear: 2013,
    });

    const studentLogin = await request({ method: 'POST', path: '/api/auth/login' }, {
      emailOrUsername: studentUser.email,
      password: studentUser.password,
    });
    const studentToken = studentLogin.json?.accessToken;
    const studentId = studentLogin.json?.user?.id;
    if (studentId) createdUserIds.push(studentId);

    assert(Boolean(studentToken), `Đăng ký & đăng nhập học sinh thường thành công (ID: ${studentId})`);

    const studentStatsRes = await request({
      method: 'GET',
      path: '/api/admin/stats',
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(studentStatsRes.status === 403, `Học sinh thường bị từ chối 403 khi vào /api/admin/stats (HTTP ${studentStatsRes.status})`);

    const studentGrantRes = await request({
      method: 'POST',
      path: '/api/admin/grant',
      headers: { Authorization: `Bearer ${studentToken}` },
    }, { package_id: 'pack_1_4' });
    assert(studentGrantRes.status === 403, `Học sinh thường bị từ chối 403 khi gọi /api/admin/grant (HTTP ${studentGrantRes.status})`);

    const studentReconcileRes = await request({
      method: 'POST',
      path: '/api/admin/payments/reconcile',
      headers: { Authorization: `Bearer ${studentToken}` },
    }, { transaction_id: 1 });
    assert(studentReconcileRes.status === 403, `Học sinh thường bị từ chối 403 khi gọi /api/admin/payments/reconcile (HTTP ${studentReconcileRes.status})`);

    // ── 4. Kiểm tra tài khoản bị vô hiệu hóa (is_active = 0) ──
    console.log('\n── 4. Kiểm tra phòng vệ tài khoản bị khóa (is_active = 0) ──');
    const [disabledUserInsert] = await db.query(
      `INSERT INTO users (first_name, last_name, username, email, password, role, is_active, birth_year)
       VALUES ('Disabled', 'Admin', ?, ?, 'hash123', 'admin', 0, 2000)`,
      [`disabled_admin_${ts}`, `disabled_admin_${ts}@sigmabloom.vn`]
    );
    const disabledAdminId = disabledUserInsert.insertId;
    createdUserIds.push(disabledAdminId);

    const disabledAdminToken = jwt.sign(
      { id: disabledAdminId, username: `disabled_admin_${ts}`, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const disabledReqRes = await request({
      method: 'GET',
      path: '/api/admin/stats',
      headers: { Authorization: `Bearer ${disabledAdminToken}` },
    });
    assert(
      disabledReqRes.status === 401 && disabledReqRes.json?.error === 'ACCOUNT_DISABLED',
      `Tài khoản admin bị khóa (is_active=0) bị chặn với mã ACCOUNT_DISABLED (HTTP ${disabledReqRes.status})`
    );

    // ── 5. Kiểm tra chống Token Forgery (Live DB Check) ──
    console.log('\n── 5. Kiểm tra chống Token Forgery qua Database Check ──');
    // Tạo token mang id của học sinh thường nhưng payload gán giả mạo role='admin'
    const forgedAdminToken = jwt.sign(
      { id: studentId, username: studentUser.username, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const forgedReqRes = await request({
      method: 'GET',
      path: '/api/admin/stats',
      headers: { Authorization: `Bearer ${forgedAdminToken}` },
    });
    assert(
      forgedReqRes.status === 403 && forgedReqRes.json?.error === 'FORBIDDEN',
      `Token giả mạo claim role="admin" bị chặn 403 vì kiểm tra thực tế trong Database là role="user"`
    );

    // ── 6. Đăng nhập Admin hợp lệ & Lấy Thống kê tổng quan ──
    console.log('\n── 6. Đăng nhập Admin hợp lệ & Lấy Thống kê tổng quan ──');
    const adminLogin = await request({ method: 'POST', path: '/api/auth/login' }, {
      emailOrUsername: 'admin@sigmabloom.vn',
      password: 'Admin@123456',
    });
    const adminToken = adminLogin.json?.accessToken;
    assert(Boolean(adminToken), 'Đăng nhập admin thành công và nhận Access Token');

    const statsRes = await request({
      method: 'GET',
      path: '/api/admin/stats',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(statsRes.status === 200 && statsRes.json?.success === true, 'GET /api/admin/stats trả về 200 thành công');
    const statsData = statsRes.json?.data;
    assert(
      statsData &&
      typeof statsData.totalUsers === 'number' &&
      typeof statsData.totalPaidOrders === 'number' &&
      typeof statsData.totalEntitlements === 'number' &&
      typeof statsData.todayNewUsers === 'number' &&
      typeof statsData.totalMismatches === 'number' &&
      typeof statsData.totalRevenue === 'number',
      `Thống kê đầy đủ 6 chỉ số: Users=${statsData?.totalUsers}, Doanh thu=${statsData?.totalRevenue.toLocaleString()}đ, Lỗi=${statsData?.totalMismatches}`
    );

    // ── 7. Quản lý người dùng: Phân trang & Xem chi tiết ──
    console.log('\n── 7. Quản lý người dùng: Phân trang & Xem chi tiết ──');
    const usersListRes = await request({
      method: 'GET',
      path: `/api/admin/users?search=${studentUser.username}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(usersListRes.status === 200 && usersListRes.json?.success === true, 'GET /api/admin/users tìm kiếm người dùng thành công');
    const foundUser = usersListRes.json?.data?.users?.find(u => u.username === studentUser.username);
    assert(Boolean(foundUser), `Tìm thấy học sinh "${studentUser.username}" trong danh sách quản trị`);

    const userDetailRes = await request({
      method: 'GET',
      path: `/api/admin/users/${studentId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(userDetailRes.status === 200 && userDetailRes.json?.success === true, `GET /api/admin/users/${studentId} trả về chi tiết user`);
    assert(userDetailRes.json?.data?.user?.email === studentUser.email, 'Thông tin chi tiết email người dùng trùng khớp');

    // ── 8. Cấp gói thủ công POST /api/admin/grant ──
    console.log('\n── 8. Cấp gói thủ công POST /api/admin/grant (Vĩnh viễn + Audit log) ──');
    const grantRes = await request({
      method: 'POST',
      path: '/api/admin/grant',
      headers: { Authorization: `Bearer ${adminToken}` },
    }, {
      user_id: studentId,
      package_id: 'pack_1_4',
      reason: 'Cấp gói kiểm thử tự động Phase 6',
    });
    assert(grantRes.status === 200 && grantRes.json?.success === true, 'Cấp gói thủ công thành công qua POST /api/admin/grant');

    // Kiểm tra DB: quyền được cấp vĩnh viễn (expires_at IS NULL)
    const [entRows] = await db.query(
      'SELECT * FROM user_entitlements WHERE user_id = ? AND package_id = ?',
      [studentId, 'pack_1_4']
    );
    assert(entRows.length > 0, 'Bản ghi user_entitlements tồn tại trong Database');
    assert(entRows[0]?.expires_at === null, 'Thời hạn quyền sở hữu là vĩnh viễn (expires_at = null)');
    assert(entRows[0]?.source === 'admin_grant', 'Nguồn cấp là "admin_grant"');

    // Kiểm tra DB: nhật ký audit log đã được ghi
    const [auditGrantRows] = await db.query(
      `SELECT * FROM admin_audit_log
       WHERE target_user_id = ? AND action = 'grant_package' AND package_id = 'pack_1_4'`,
      [studentId]
    );
    assert(auditGrantRows.length > 0, 'Nhật ký admin_audit_log ghi nhận hành động grant_package');
    assert(auditGrantRows[0]?.reason.includes('Phase 6'), 'Lý do cấp gói được lưu chính xác vào audit log');

    // ── 9. Quản lý Entitlements trực tiếp: Cấp & Thu hồi ──
    console.log('\n── 9. Quản lý Entitlements trực tiếp: Cấp & Thu hồi ──');
    const directGrantRes = await request({
      method: 'POST',
      path: `/api/admin/users/${studentId}/entitlements`,
      headers: { Authorization: `Bearer ${adminToken}` },
    }, {
      packageId: 'premium',
    });
    assert(directGrantRes.status === 200 && directGrantRes.json?.success === true, 'Cấp entitlement "premium" trực tiếp thành công');

    const [premEntRows] = await db.query(
      'SELECT * FROM user_entitlements WHERE user_id = ? AND package_id = ?',
      [studentId, 'premium']
    );
    assert(premEntRows.length > 0, 'Gói "premium" được ghi nhận trong DB cho học sinh');

    const revokeRes = await request({
      method: 'DELETE',
      path: `/api/admin/users/${studentId}/entitlements/premium`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(revokeRes.status === 200 && revokeRes.json?.success === true, 'Thu hồi entitlement "premium" thành công');

    const [afterRevokeRows] = await db.query(
      'SELECT * FROM user_entitlements WHERE user_id = ? AND package_id = ?',
      [studentId, 'premium']
    );
    assert(afterRevokeRows.length === 0, 'Entitlement "premium" đã bị xóa khỏi DB');

    const [auditRevokeRows] = await db.query(
      `SELECT * FROM admin_audit_log
       WHERE target_user_id = ? AND action = 'revoke_package' AND package_id = 'premium'`,
      [studentId]
    );
    assert(auditRevokeRows.length > 0, 'Nhật ký admin_audit_log ghi nhận hành động revoke_package');

    // ── 10. Danh sách đơn hàng & Giao dịch ngân hàng ──
    console.log('\n── 10. Danh sách đơn hàng & Giao dịch ngân hàng ──');
    const ordersRes = await request({
      method: 'GET',
      path: '/api/admin/orders?limit=10',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(ordersRes.status === 200 && ordersRes.json?.success === true, 'GET /api/admin/orders trả về danh sách đơn hàng');
    assert(Array.isArray(ordersRes.json?.data?.orders), 'Kết quả orders là mảng hợp lệ');

    const txsRes = await request({
      method: 'GET',
      path: '/api/admin/transactions?limit=10',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(txsRes.status === 200 && txsRes.json?.success === true, 'GET /api/admin/transactions trả về danh sách giao dịch');
    assert(Array.isArray(txsRes.json?.data?.transactions), 'Kết quả transactions là mảng hợp lệ');

    // ── 11. Đối soát & Khớp giao dịch (Reconciliation) ──
    console.log('\n── 11. Đối soát & Khớp giao dịch (POST /api/admin/payments/reconcile) ──');
    // Tạo 1 đơn hàng pending cho student
    const testOrderCode = `CKREC${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const [orderInsert] = await db.query(
      `INSERT INTO orders (order_code, user_id, package_id, amount, status, payment_method, expires_at)
       VALUES (?, ?, 'pack_5_10', 79000, 'pending', 'vietqr', DATE_ADD(NOW(), INTERVAL 1 DAY))`,
      [testOrderCode, studentId]
    );
    const testOrderId = orderInsert.insertId;
    createdOrderIds.push(testOrderId);

    // Tạo 1 giao dịch ngân hàng mồ côi (no_order)
    const testProviderTxId = `TX_RECON_${ts}`;
    const [txInsert] = await db.query(
      `INSERT INTO payment_transactions
       (provider, provider_tx_id, amount_in, content, account_number, match_status)
       VALUES ('sepay', ?, 79000, 'Chuyen tien hoc phi khong kem ma don', '0987654321', 'no_order')`,
      [testProviderTxId]
    );
    const testTxId = txInsert.insertId;
    createdTxIds.push(testTxId);

    // Kiểm tra danh sách mismatches trước khi khớp
    const mismatchesBefore = await request({
      method: 'GET',
      path: '/api/admin/payments/mismatches',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const foundMismatch = mismatchesBefore.json?.data?.transactions?.some(t => t.id === testTxId);
    assert(foundMismatch, `Giao dịch lỗi #${testTxId} xuất hiện trong GET /api/admin/payments/mismatches`);

    // Thực hiện đối soát POST /api/admin/payments/reconcile
    const reconcileRes = await request({
      method: 'POST',
      path: '/api/admin/payments/reconcile',
      headers: { Authorization: `Bearer ${adminToken}` },
    }, {
      transaction_id: testTxId,
      order_code: testOrderCode,
      note: 'Đối soát và duyệt thủ công qua sao kê sao chép kiểm thử',
    });
    assert(reconcileRes.status === 200 && reconcileRes.json?.success === true, 'POST /api/admin/payments/reconcile thành công');

    // Kiểm tra cập nhật DB sau khi khớp:
    const [updatedTxRows] = await db.query('SELECT * FROM payment_transactions WHERE id = ?', [testTxId]);
    assert(
      updatedTxRows[0]?.order_id === testOrderId && updatedTxRows[0]?.match_status === 'matched',
      `Giao dịch #${testTxId} đã được liên kết với đơn #${testOrderId} và chuyển sang match_status = "matched"`
    );

    const [updatedOrderRows] = await db.query('SELECT * FROM orders WHERE id = ?', [testOrderId]);
    assert(
      updatedOrderRows[0]?.status === 'paid' && updatedOrderRows[0]?.paid_at !== null,
      `Đơn hàng ${testOrderCode} đã được cập nhật status = "paid" và ghi nhận paid_at`
    );

    const [reconciledEntRows] = await db.query(
      'SELECT * FROM user_entitlements WHERE user_id = ? AND package_id = ?',
      [studentId, 'pack_5_10']
    );
    assert(reconciledEntRows.length > 0, 'Học sinh được cấp gói "pack_5_10" sau khi đối soát thành công');
    assert(reconciledEntRows[0]?.source === 'purchase', 'Nguồn cấp là "purchase" (gắn với order_id)');
    assert(reconciledEntRows[0]?.expires_at === null, 'Gói cấp có giá trị vĩnh viễn (expires_at = null)');

    const [auditReconcileRows] = await db.query(
      `SELECT * FROM admin_audit_log
       WHERE target_user_id = ? AND action = 'reconcile_transaction' AND package_id = 'pack_5_10'`,
      [studentId]
    );
    assert(auditReconcileRows.length > 0, 'Nhật ký admin_audit_log ghi nhận hành động reconcile_transaction');

    // ── 12. Xem nhật ký hoạt động GET /api/admin/audit-logs ──
    console.log('\n── 12. Xem nhật ký hoạt động GET /api/admin/audit-logs ──');
    const logsRes = await request({
      method: 'GET',
      path: '/api/admin/audit-logs?limit=20',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(logsRes.status === 200 && logsRes.json?.success === true, 'GET /api/admin/audit-logs trả về 200 thành công');
    const logsData = logsRes.json?.data?.logs;
    assert(Array.isArray(logsData) && logsData.length > 0, `Nhật ký audit logs chứa ${logsData?.length} bản ghi`);

    const filterReconcileLogsRes = await request({
      method: 'GET',
      path: '/api/admin/audit-logs?action=reconcile_transaction',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const reconcileLogs = filterReconcileLogsRes.json?.data?.logs;
    assert(
      Array.isArray(reconcileLogs) && reconcileLogs.some(l => l.action === 'reconcile_transaction'),
      'Lọc nhật ký theo action=reconcile_transaction hoạt động chính xác'
    );

  } catch (err) {
    console.error('💥 Ngoại lệ trong quá trình chạy kiểm thử:', err);
    failed++;
  } finally {
    // ── 13. Dọn dẹp dữ liệu kiểm thử (Clean-up) ──
    console.log('\n── 13. Dọn dẹp dữ liệu kiểm thử (Clean-up) ──');
    try {
      if (createdUserIds.length > 0) {
        await db.query('DELETE FROM admin_audit_log WHERE target_user_id IN (?)', [createdUserIds]);
        await db.query('DELETE FROM user_entitlements WHERE user_id IN (?)', [createdUserIds]);
      }
      if (createdTxIds.length > 0) {
        await db.query('DELETE FROM payment_transactions WHERE id IN (?)', [createdTxIds]);
      }
      if (createdOrderIds.length > 0) {
        await db.query('DELETE FROM orders WHERE id IN (?)', [createdOrderIds]);
      }
      if (createdUserIds.length > 0) {
        await db.query('DELETE FROM users WHERE id IN (?)', [createdUserIds]);
      }
      console.log('  🧹 Đã dọn dẹp sạch sẽ toàn bộ bản ghi kiểm thử.');
    } catch (cleanErr) {
      console.warn('⚠️ Lỗi khi dọn dẹp dữ liệu test:', cleanErr.message);
    }
  }

  // ── Tổng kết ──
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   KẾT QUẢ KIỂM THỬ GIAI ĐOẠN 6 — ADMIN PORTAL & OPERATIONS   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n  ✅ Đạt:   ${passed}`);
  console.log(`  ❌ Hỏng:  ${failed}`);
  console.log(`  📊 Tổng:  ${passed + failed}\n`);

  if (failed === 0) {
    console.log('🎉 TẤT CẢ TEST ADMIN PORTAL & RECONCILIATION ĐÃ VƯỢT QUA (100% PASS)!\n');
    process.exit(0);
  } else {
    console.error('⚠️ CÓ TEST BỊ LỖI — CẦN KIỂM TRA LẠI.\n');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('💥 Test script gặp lỗi ngoại lệ nghiêm trọng:', err);
  process.exit(1);
});
