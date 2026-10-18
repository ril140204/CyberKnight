/**
 * Test Suite tự động cho Luồng Đơn hàng & Webhook SePay (Phase 3)
 *
 * Chạy: node backend/scripts/test-payment-flow.js
 *
 * Kịch bản kiểm thử:
 * 1. Đăng ký & Đăng nhập người dùng test.
 * 2. Tạo đơn hàng mới POST /api/payments/orders.
 * 3. Kiểm tra mã đơn dạng CK[A-HJ-NP-Z2-9]{8} & thông tin VietQR động.
 * 4. Webhook với API Key sai → 403 Forbidden.
 * 5. Webhook giao dịch tiền ra (transferType: 'out') → 200 Bỏ qua (ignored).
 * 6. Webhook chuyển thiếu tiền (underpaid) → Trạng thái đơn underpaid.
 * 7. Webhook thanh toán đủ (xử lý đơn late payment) → Trạng thái đơn paid.
 * 8. Kiểm tra quyền user_entitlements đã được cấp vĩnh viễn (expires_at = null).
 * 9. Webhook gửi trùng lặp (Idempotency) → 200 Thành công không ném lỗi.
 * 10. Tạo đơn mới và Hủy đơn POST /api/payments/orders/:code/cancel → Trạng thái cancelled.
 */

'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');

const envPath = fs.existsSync(path.join(__dirname, '../.env'))
  ? path.join(__dirname, '../.env')
  : path.join(__dirname, '../../.env');
require('dotenv').config({ path: envPath });

const db = require('../src/config/db');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';
const API_KEY = (process.env.SEPAY_API_KEY || process.env.PAYMENT_WEBHOOK_SECRET || 'sigmabloom_level_access_secret_please_change_this_2026_09').trim();

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
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timeout')); });

    if (body) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      req.write(bodyStr);
    }
    req.end();
  });
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   PHASE 3 — Test Suite Luồng Đơn Hàng & Webhook SePay       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Đảm bảo có webhook secret để test
  if (!process.env.PAYMENT_WEBHOOK_SECRET && !process.env.SEPAY_API_KEY) {
    process.env.PAYMENT_WEBHOOK_SECRET = 'sigmabloom_test_webhook_secret_key_2026';
  }

  const timestamp = Date.now();
  const testUser = {
    firstName: 'ThanhToan',
    lastName: 'Test',
    username: `user_pay_${timestamp}`,
    email: `pay_test_${timestamp}@sigmabloom.vn`,
    password: 'P@ssword123456!',
  };

  console.log('── 1. Chuẩn bị người dùng test ──');
  await request({ method: 'POST', path: '/api/auth/register' }, {
    ...testUser,
    confirmPassword: testUser.password,
    birthYear: 2012,
  });

  const loginRes = await request({ method: 'POST', path: '/api/auth/login' }, {
    emailOrUsername: testUser.email,
    password: testUser.password,
  });

  const token = loginRes.json?.accessToken;
  assert(Boolean(token), 'Đăng nhập thành công và nhận Access Token');

  // ── 2. Tạo đơn hàng mới ──
  console.log('\n── 2. Tạo đơn hàng mới POST /api/payments/orders ──');
  const createOrderRes = await request({
    method: 'POST',
    path: '/api/payments/orders',
    headers: { Authorization: `Bearer ${token}` },
  }, { packageId: 'pack_1_4' });

  assert(createOrderRes.status === 201, `Tạo đơn thành công (HTTP ${createOrderRes.status})`);
  const orderData = createOrderRes.json?.data?.order;
  const qrData = createOrderRes.json?.data?.qr;

  assert(orderData && /^CK[A-HJ-NP-Z2-9]{8}$/.test(orderData.orderCode), `Mã đơn đúng định dạng: ${orderData?.orderCode}`);
  assert(orderData?.amount === 2000, `Số tiền chính xác 2.000đ (nhận: ${orderData?.amount})`);
  assert(qrData?.qrUrl && qrData.qrUrl.includes('img.vietqr.io'), `Tạo link VietQR động chuẩn: ${qrData?.qrUrl?.slice(0, 50)}...`);

  const orderCode = orderData.orderCode;

  // ── 3. Webhook sai API key → 403 ──
  console.log('\n── 3. Webhook với API Key không hợp lệ ──');
  const invalidKeyRes = await request({
    method: 'POST',
    path: '/api/payments/webhook/sepay',
    headers: { Authorization: 'Apikey WRONG_KEY_123456' },
  }, { id: 111111, amountIn: 2000, content: orderCode });

  assert(invalidKeyRes.status === 403, `Bị chặn 403 Forbidden khi sai key (nhận: ${invalidKeyRes.status})`);

  // ── 4. Webhook giao dịch tiền ra → 200 ignored ──
  console.log('\n── 4. Webhook giao dịch tiền ra (transferType: "out") ──');
  const moneyOutRes = await request({
    method: 'POST',
    path: '/api/payments/webhook/sepay',
    headers: { Authorization: `Apikey ${API_KEY}` },
  }, {
    id: `OUT_${timestamp}`,
    transferType: 'out',
    amountIn: 0,
    amountOut: 2000,
    content: orderCode,
  });

  assert(moneyOutRes.status === 200 && moneyOutRes.json?.ignored === true, 'Bỏ qua giao dịch tiền ra an toàn');

  // ── 5. Webhook chuyển thiếu tiền (underpaid) ──
  console.log('\n── 5. Webhook chuyển thiếu tiền ──');
  const txUnderpaidId = `TX_UNDER_${timestamp}`;
  const underpaidRes = await request({
    method: 'POST',
    path: '/api/payments/webhook/sepay',
    headers: { Authorization: `Apikey ${API_KEY}` },
  }, {
    id: txUnderpaidId,
    transferType: 'in',
    amountIn: 1000, // Cần 2.000 nhưng chỉ chuyển 1.000
    content: `Chuyen tien hoc phi ${orderCode}`,
  });

  assert(underpaidRes.status === 200 && underpaidRes.json?.data?.match_status === 'underpaid', 'Nhận diện trạng thái underpaid');

  const checkUnderpaidRes = await request({
    method: 'GET',
    path: `/api/payments/orders/${orderCode}`,
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(checkUnderpaidRes.json?.data?.status === 'underpaid', 'Trạng thái đơn hàng trong DB chuyển thành underpaid');

  // ── 6. Webhook thanh toán đủ (xử lý đơn đã underpaid) ──
  console.log('\n── 6. Webhook thanh toán đủ (Late / Full Recovery) ──');
  const txPaidId = `TX_PAID_${timestamp}`;
  const paidRes = await request({
    method: 'POST',
    path: '/api/payments/webhook/sepay',
    headers: { Authorization: `Apikey ${API_KEY}` },
  }, {
    id: txPaidId,
    transferType: 'in',
    amountIn: 2000,
    content: `Nap tien bo sung CyberKnight ${orderCode}`,
  });

  assert(paidRes.status === 200 && paidRes.json?.data?.match_status === 'matched', 'Webhook khớp đơn và thanh toán thành công');

  const checkPaidRes = await request({
    method: 'GET',
    path: `/api/payments/orders/${orderCode}`,
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(checkPaidRes.json?.data?.status === 'paid', 'Trạng thái đơn hàng cập nhật thành paid');

  // ── 7. Kiểm tra quyền hạn user_entitlements trong DB ──
  console.log('\n── 7. Kiểm tra user_entitlements sau thanh toán ──');
  const [entitlements] = await db.query(
    'SELECT package_id, expires_at FROM user_entitlements WHERE user_id = ? AND package_id = ?',
    [loginRes.json.user.id, 'pack_1_4']
  );
  assert(entitlements.length > 0, 'User đã được cấp quyền package pack_1_4');
  assert(entitlements[0]?.expires_at === null, 'Thời hạn gói là vĩnh viễn (expires_at = null)');

  // ── 8. Webhook gửi trùng lặp (Idempotency) ──
  console.log('\n── 8. Webhook gửi trùng lặp với cùng transaction id ──');
  const duplicateRes = await request({
    method: 'POST',
    path: '/api/payments/webhook/sepay',
    headers: { Authorization: `Apikey ${API_KEY}` },
  }, {
    id: txPaidId,
    transferType: 'in',
    amountIn: 59000,
    content: `Nap tien bo sung CyberKnight ${orderCode}`,
  });
  assert(duplicateRes.status === 200 && duplicateRes.json?.data?.duplicate === true, 'Xử lý idempotent an toàn, không ném lỗi trùng lặp');

  // ── 9. Tạo đơn mới và Hủy đơn ──
  console.log('\n── 9. Tạo đơn mới và Hủy đơn hàng ──');
  const orderToCancelRes = await request({
    method: 'POST',
    path: '/api/payments/orders',
    headers: { Authorization: `Bearer ${token}` },
  }, { packageId: 'pack_5_10' });

  const cancelCode = orderToCancelRes.json?.data?.order?.orderCode;

  const cancelActionRes = await request({
    method: 'POST',
    path: `/api/payments/orders/${cancelCode}/cancel`,
    headers: { Authorization: `Bearer ${token}` },
  });

  assert(cancelActionRes.status === 200 && cancelActionRes.json?.success === true, 'Hủy đơn hàng thành công');

  const verifyCancelRes = await request({
    method: 'GET',
    path: `/api/payments/orders/${cancelCode}`,
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(verifyCancelRes.json?.data?.status === 'cancelled', 'Đơn hàng mang trạng thái cancelled');

  // ── Tổng kết ──
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   KẾT QUẢ KIỂM THỬ GIAI ĐOẠN 3                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n  ✅ Đạt:   ${passed}`);
  console.log(`  ❌ Hỏng:  ${failed}`);
  console.log(`  📊 Tổng:  ${passed + failed}\n`);

  if (failed === 0) {
    console.log('🎉 TẤT CẢ TEST LUỒNG THANH TOÁN & WEBHOOK ĐÃ VƯỢT QUA!\n');
    process.exit(0);
  } else {
    console.error('⚠️  CÓ TEST BỊ LỖI — CẦN KIỂM TRA LẠI.\n');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('💥 Test script gặp lỗi ngoại lệ:', err);
  process.exit(1);
});
