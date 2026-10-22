/**
 * Test Suite: Kiểm thử gia cố xác thực (Auth Hardening) — Phase D
 *
 * Chạy: node backend/scripts/test-auth-hardening.js
 * Yêu cầu: server đang chạy trên PORT (mặc định 5000), PostgreSQL (Supabase) sẵn sàng
 *
 * Kịch bản kiểm thử:
 *  1. Đăng nhập sai không lộ user tồn tại (cùng message cho user có/không có)
 *  2. Đăng nhập sai 5 lần → tài khoản bị khóa tạm thời (429)
 *  3. Quên mật khẩu (forgot-password) không lộ email tồn tại
 *  4. Reset mật khẩu → tất cả refresh token cũ bị xóa (đăng xuất mọi thiết bị)
 *  5. Rate limit login hoạt động (dev mode giới hạn cao, nhưng cấu trúc đúng)
 */

'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const envPath = fs.existsSync(path.join(__dirname, '../.env'))
  ? path.join(__dirname, '../.env')
  : path.join(__dirname, '../../.env');
require('dotenv').config({ path: envPath });

const db = require('../src/config/db');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';

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
      timeout: 10000,
    };

    const req = http.request(opt, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          json,
          cookies: res.headers['set-cookie'] || [],
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });

    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ── Trợ giúp ──────────────────────────────────────────────────
const suffix = `_authtest_${Date.now()}`;
const testUser = {
  firstName: 'Auth',
  lastName: 'Test',
  username: `authuser${suffix}`,
  email: `authuser${suffix}@test.local`,
  password: 'StrongP@ss123!',
  confirmPassword: 'StrongP@ss123!',
  birthYear: 2010,
};

async function registerUser(user) {
  const res = await request({ method: 'POST', path: '/api/auth/register' }, user);
  return res;
}

async function loginUser(emailOrUsername, password) {
  return request({ method: 'POST', path: '/api/auth/login' }, { emailOrUsername, password });
}

function extractRefreshToken(cookies) {
  for (const c of cookies) {
    const m = c.match(/refreshToken=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}

// ── Test chính ────────────────────────────────────────────────
async function run() {
  console.log('\n🔐 === Test Auth Hardening (Phase D) ===\n');

  // ── 0. Đăng ký user test ────────────────────────────────
  const regRes = await registerUser(testUser);
  const registered = regRes.status === 201 || (regRes.status === 409);
  assert(registered, '0. Đăng ký user test thành công hoặc đã tồn tại');

  // ── 1. Đăng nhập sai không lộ user tồn tại ──────────────
  console.log('\n📋 1. Đăng nhập sai — cùng message cho user có/không có');

  const wrongPwRes = await loginUser(testUser.email, 'SaiMatKhau123!');
  assert(wrongPwRes.status === 401, '1a. Sai mật khẩu → 401');
  const wrongPwMsg = wrongPwRes.json?.message || '';

  const fakeUserRes = await loginUser('khong_ton_tai_xyz_999@nowhere.test', 'SaiMatKhau123!');
  assert(fakeUserRes.status === 401, '1b. User không tồn tại → 401');
  const fakeUserMsg = fakeUserRes.json?.message || '';

  assert(
    wrongPwMsg === fakeUserMsg,
    '1c. Cùng message lỗi cho cả hai trường hợp (chống user enumeration)',
    `"${wrongPwMsg}" vs "${fakeUserMsg}"`
  );

  // ── 2. Khóa tài khoản sau 5 lần sai ────────────────────
  console.log('\n📋 2. Khóa tài khoản sau 5 lần sai mật khẩu');

  // Reset trạng thái khóa trước
  await db.query(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE email = ?',
    [testUser.email]
  );

  // Sai 5 lần liên tiếp
  for (let i = 1; i <= 5; i++) {
    await loginUser(testUser.email, 'SaiLien_' + i);
  }

  const lockedRes = await loginUser(testUser.email, testUser.password);
  assert(lockedRes.status === 429, '2a. Sau 5 lần sai → 429 (tài khoản bị khóa tạm)');
  assert(
    (lockedRes.json?.message || '').includes('khóa') || (lockedRes.json?.message || '').includes('locked'),
    '2b. Message đề cập khóa tài khoản'
  );

  // Reset lại để tiếp tục test
  await db.query(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE email = ?',
    [testUser.email]
  );

  // ── 3. Forgot password — không lộ email tồn tại ────────
  console.log('\n📋 3. Quên mật khẩu — không lộ email tồn tại');

  const forgotRealRes = await request(
    { method: 'POST', path: '/api/auth/forgot-password' },
    { email: testUser.email }
  );
  assert(forgotRealRes.status === 200, '3a. Email có thật → 200');
  const realMsg = forgotRealRes.json?.message || '';

  const forgotFakeRes = await request(
    { method: 'POST', path: '/api/auth/forgot-password' },
    { email: 'khong_ton_tai_xyz_999@nowhere.test' }
  );
  assert(forgotFakeRes.status === 200, '3b. Email không tồn tại → vẫn 200 (không lộ)');
  const fakeMsg = forgotFakeRes.json?.message || '';

  assert(
    realMsg === fakeMsg,
    '3c. Cùng message cho email có/không có (chống enumeration)',
    `"${realMsg}" vs "${fakeMsg}"`
  );

  // ── 4. Reset mật khẩu → xóa toàn bộ refresh token ──────
  console.log('\n📋 4. Reset mật khẩu → thu hồi refresh token cũ');

  // 4a. Đăng nhập lấy refresh token
  const loginRes1 = await loginUser(testUser.email, testUser.password);
  assert(loginRes1.status === 200, '4a. Đăng nhập trước reset → 200');
  const refreshToken1 = extractRefreshToken(loginRes1.cookies);
  assert(!!refreshToken1, '4b. Có refresh token cookie');

  // 4b. Kiểm tra refresh token hoạt động
  const refreshRes1 = await request(
    { method: 'POST', path: '/api/auth/refresh', headers: { Cookie: `refreshToken=${refreshToken1}` } }
  );
  assert(refreshRes1.status === 200, '4c. Refresh token hoạt động trước reset');

  // 4c. Lấy user ID
  const [userRows] = await db.query('SELECT id FROM users WHERE email = ?', [testUser.email]);
  const userId = userRows[0]?.id;

  // 4d. Mô phỏng reset mật khẩu qua DB (tạo token reset → dùng API reset)
  const { hashToken, generateRandomToken } = require('../src/utils/tokens');
  const rawToken = generateRandomToken();
  const tokenHash = hashToken(rawToken);
  await db.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at, ip_address)
     VALUES (?, ?, NOW() + INTERVAL '15 minutes', '127.0.0.1')`,
    [userId, tokenHash]
  );

  const newPassword = 'NewStr0ng!Pass_' + Date.now();
  const resetRes = await request(
    { method: 'POST', path: '/api/auth/reset-password' },
    { token: rawToken, password: newPassword }
  );
  assert(resetRes.status === 200, '4d. Reset mật khẩu → 200');
  assert(resetRes.json?.success === true, '4e. Reset mật khẩu thành công');

  // 4e. Refresh token cũ phải bị thu hồi
  const refreshRes2 = await request(
    { method: 'POST', path: '/api/auth/refresh', headers: { Cookie: `refreshToken=${refreshToken1}` } }
  );
  assert(
    refreshRes2.status === 401 || refreshRes2.status === 403,
    '4f. Refresh token cũ bị thu hồi sau reset (401/403)',
    `status=${refreshRes2.status}`
  );

  // 4f. Đăng nhập bằng mật khẩu mới
  const loginRes2 = await loginUser(testUser.email, newPassword);
  assert(loginRes2.status === 200, '4g. Đăng nhập bằng mật khẩu mới → 200');

  // 4g. Mật khẩu cũ không còn dùng được
  const loginRes3 = await loginUser(testUser.email, testUser.password);
  assert(loginRes3.status === 401, '4h. Mật khẩu cũ → 401 (không dùng được nữa)');

  // ── 5. Rate limit cấu hình đúng (kiểm tra cấu trúc, không spam) ──
  // Phase 1.2: keyGenerator theo ip+username cho login; thêm IP cap riêng
  // Phase 1.2: forgotPassword có IP cap + email key; checkUsername vẫn giữ nguyên
  console.log('\n📋 5. Rate limit cấu hình đúng');

  const authRouteSource = fs.readFileSync(
    path.join(__dirname, '../src/routes/auth.js'), 'utf8'
  );

  // 5a-5c: Giữ nguyên các check cũ (vẫn đúng sau Phase 1.2)
  assert(
    authRouteSource.includes('loginLimiter') && authRouteSource.includes('rateLimit'),
    '5a. Login route có rate limiter'
  );
  assert(
    authRouteSource.includes('forgotPasswordLimiter'),
    '5b. Forgot-password route có rate limiter'
  );
  assert(
    authRouteSource.includes('checkUsernameLimiter'),
    '5c. Check-username route có rate limiter'
  );

  // 5d: loginLimiter dùng keyGenerator theo ip+emailOrUsername (Phase 1.2)
  assert(
    /loginLimiter[\s\S]{0,300}keyGenerator/.test(authRouteSource) &&
    authRouteSource.includes('emailOrUsername'),
    '5d. loginLimiter dùng keyGenerator theo ip+emailOrUsername (Phase 1.2)'
  );

  // 5e: Tồn tại IP cap riêng cho login (loginIpLimiter — Phase 1.2)
  assert(
    authRouteSource.includes('loginIpLimiter'),
    '5e. Có loginIpLimiter (IP cap 300/15ph — Phase 1.2)'
  );

  // 5f: forgotPassword có IP cap riêng (forgotPasswordIpLimiter — Phase 1.2)
  assert(
    authRouteSource.includes('forgotPasswordIpLimiter'),
    '5f. Có forgotPasswordIpLimiter (IP cap 30/giờ — Phase 1.2)'
  );

  // ── Dọn dẹp ──────────────────────────────────────────────
  console.log('\n🧹 Dọn dẹp dữ liệu test...');
  if (userId) {
    await db.query('DELETE FROM password_resets WHERE user_id = ?', [userId]);
    await db.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
    await db.query('DELETE FROM users WHERE id = ?', [userId]);
  }

  // ── Kết quả ──────────────────────────────────────────────
  console.log(`\n🔐 Kết quả Test Auth Hardening: ${passed} passed, ${failed} failed / ${passed + failed} tổng`);

  if (failed === 0) {
    console.log('✅ TẤT CẢ TEST PASSED!\n');
    process.exit(0);
  } else {
    console.log('❌ CÓ TEST THẤT BẠI!\n');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('💥 Lỗi không xử lý:', err);
  process.exit(1);
});
