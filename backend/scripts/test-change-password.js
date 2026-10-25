/**
 * Test Suite: POST /api/auth/change-password
 *
 * Chạy: node backend/scripts/test-change-password.js
 * Yêu cầu: server đang chạy trên PORT (mặc định 5000), PostgreSQL (Supabase) sẵn sàng
 *
 * Kịch bản kiểm thử:
 *  1. Unauthenticated → 401
 *  2. Wrong current password → 401, no DB change
 *  3. Weak new password (short) → 400
 *  4. Weak new password (no uppercase) → 400
 *  5. Same as current password → 400
 *  6. Valid → 200, password actually changed, old refresh token rejected
 */

'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const envPath = fs.existsSync(path.join(__dirname, '../.env'))
  ? path.join(__dirname, '../.env')
  : path.join(__dirname, '../../.env');
require('dotenv').config({ path: envPath });

const db = require('../src/config/db');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';

let passed = 0;
let failed = 0;
let testUserId = null;
let testUsername = null;
let originalPassword = 'TestPass123!';
let accessToken = null;
let refreshToken = null;

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

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path || '/', BASE_URL);
    const opt = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      timeout: 10000,
    };

    const req = http.request(opt, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(data); } catch { json = { raw: data }; }
        resolve({ statusCode: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function setup() {
  console.log('\n=== Setup: tạo user test ===');

  // Cleanup old test user
  try {
    await db.query('DELETE FROM users WHERE username LIKE ?', ['test_chgpwd_%']);
  } catch {}

  testUsername = 'test_chgpwd_' + crypto.randomInt(10000, 99999);
  const hash = await bcrypt.hash(originalPassword, 12);

  const [result] = await db.query(
      `INSERT INTO users (first_name, last_name, username, email, password, level, role, is_active)
     VALUES (?, ?, ?, ?, ?, 'Rookie', 'user', TRUE)`,
    ['Test', 'ChangePwd', testUsername, `${testUsername}@test.local`, hash]
  );
  testUserId = result.insertId;
  console.log(`  → Đã tạo user test: id=${testUserId}, username=${testUsername}`);

  // Login to get token
  const loginRes = await httpRequest(
    { path: '/api/auth/login', method: 'POST' },
    { emailOrUsername: testUsername, password: originalPassword }
  );
  if (loginRes.statusCode === 200) {
    accessToken = loginRes.body.accessToken;
    // Get refresh token from cookie
    refreshToken = loginRes.headers['set-cookie']
      ?.find(c => c.includes('refreshToken'))
      ?.match(/refreshToken=([^;]+)/)?.[1] || null;
    console.log(`  → Login OK, accessToken=${accessToken ? 'OK' : 'MISSING'}`);
  } else {
    console.log(`  ❌ Login failed: ${JSON.stringify(loginRes)}`);
  }
}

async function teardown() {
  console.log('\n=== Teardown: xóa user test ===');
  if (testUserId) {
    try {
      await db.query('DELETE FROM refresh_tokens WHERE user_id = ?', [testUserId]);
      await db.query('DELETE FROM users WHERE id = ?', [testUserId]);
      console.log(`  → Đã xóa user test id=${testUserId}`);
    } catch (err) {
      console.log(`  ❌ Teardown error: ${err.message}`);
    }
  }
}

async function runTests() {
  await setup();

  console.log('\n=== Test Suite: change-password ===\n');

  // ── Test 1: Unauthenticated → 401 ──────────────────────────
  {
    const res = await httpRequest(
      { path: '/api/auth/change-password', method: 'POST' },
      { currentPassword: 'OldPass1!', newPassword: 'NewPass123!@' }
    );
    assert(res.statusCode === 401,
      'Test 1: Unauthenticated → 401',
      `Got: ${res.statusCode} ${JSON.stringify(res.body)}`);
  }

  // ── Test 2: Wrong current password → 401 ────────────────────
  {
    const res = await httpRequest(
      { path: '/api/auth/change-password', method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
      { currentPassword: 'WrongPass1!', newPassword: 'NewPass123!@' }
    );
    assert(res.statusCode === 401,
      'Test 2: Wrong current password → 401');
    assert(res.body.message?.includes('hiện tại'),
      'Test 2b: Message chứa thông báo mật khẩu hiện tại sai');

    // Verify DB not changed
    const [rows] = await db.query('SELECT password FROM users WHERE id = ?', [testUserId]);
    const stillMatches = await bcrypt.compare(originalPassword, rows[0].password);
    assert(stillMatches,
      'Test 2c: DB password không thay đổi khi sai mật khẩu hiện tại');
  }

  // ── Test 3: Weak new password (short) → 400 ────────────────
  {
    const res = await httpRequest(
      { path: '/api/auth/change-password', method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
      { currentPassword: originalPassword, newPassword: 'Short1!' }
    );
    assert(res.statusCode === 400,
      'Test 3: Weak new password (too short) → 400');
    assert(res.body.message?.toLowerCase().includes('12'),
      'Test 3b: Message chỉ mật khẩu phải ≥12 ký tự');
  }

  // ── Test 4: Weak new password (no uppercase) → 400 ──────────
  {
    const res = await httpRequest(
      { path: '/api/auth/change-password', method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
      { currentPassword: originalPassword, newPassword: 'newpassword123!@' }
    );
    assert(res.statusCode === 400,
      'Test 4: Weak new password (no uppercase) → 400');
  }

  // ── Test 5: Same as current password → 400 ──────────────────
  {
    const res = await httpRequest(
      { path: '/api/auth/change-password', method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
      { currentPassword: originalPassword, newPassword: originalPassword }
    );
    assert(res.statusCode === 400,
      'Test 5: Same as current password → 400',
      `Got: ${res.statusCode} ${JSON.stringify(res.body)}`);
  }

  // ── Test 6: Valid change → 200 ─────────────────────────────
  const newPassword = 'NewSecurePass1@';
  {
    const res = await httpRequest(
      { path: '/api/auth/change-password', method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
      { currentPassword: originalPassword, newPassword }
    );
    assert(res.statusCode === 200,
      'Test 6: Valid change → 200',
      `Got: ${res.statusCode} ${JSON.stringify(res.body)}`);
    assert(res.body.success === true,
      'Test 6b: response.success === true');
  }

  // ── Test 7: Password actually changed in DB ─────────────────
  {
    const [rows] = await db.query('SELECT password FROM users WHERE id = ?', [testUserId]);
    const matchesNew = await bcrypt.compare(newPassword, rows[0].password);
    const matchesOld = await bcrypt.compare(originalPassword, rows[0].password);
    assert(matchesNew && !matchesOld,
      'Test 7: Password hash đã được cập nhật với newPassword, không còn old');
  }

  // ── Test 8: Old refresh token rejected ──────────────────────
  if (refreshToken) {
    const res = await httpRequest(
      { path: '/api/auth/refresh', method: 'POST', headers: { Cookie: `refreshToken=${refreshToken}` } },
      {}
    );
    assert(res.statusCode === 403,
      'Test 8: Old refresh token → 403 REJECTED after password change');
  }

  // ── Test 9: Login with new password works ────────────────────
  {
    const res = await httpRequest(
      { path: '/api/auth/login', method: 'POST' },
      { emailOrUsername: testUsername, password: newPassword }
    );
    assert(res.statusCode === 200,
      'Test 9: Login với newPassword thành công');
    assert(res.body.accessToken,
      'Test 9b: Login trả về accessToken mới');
  }

  // ── Test 10: Login with old password fails ───────────────────
  {
    const res = await httpRequest(
      { path: '/api/auth/login', method: 'POST' },
      { emailOrUsername: testUsername, password: originalPassword }
    );
    assert(res.statusCode === 401,
      'Test 10: Login với oldPassword thất bại (401)');
  }

  await teardown();

  console.log(`\n=== Kết quả: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('❌ Lỗi khi chạy test:', err);
    process.exit(1);
  });
}
