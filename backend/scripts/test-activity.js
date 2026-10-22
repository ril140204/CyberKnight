/**
 * PHASE 7 — Test suite cho Theo dõi Thời gian Online (Activity Tracking)
 *
 * Chạy: node backend/scripts/test-activity.js
 *
 * Test cases (gần như toàn bộ đều gọi HTTP endpoint thật trên server đang chạy,
 * giống test-level-guard.js; các ca "dòng thời gian" sửa trực tiếp trong DB rồi
 * gọi endpoint thật):
 *
 * (1)  Heartbeat không có token            → 401
 * (2)  Heartbeat lần đầu tạo dòng dữ liệu, total_seconds hợp lý
 * (3)  2 heartbeat cách nhau < 20s        → KHÔNG cộng thêm
 * (4)  Heartbeat sau khoảng hở > 90s      → KHÔNG cộng khoảng hở
 * (5)  2 heartbeat đồng thời (Promise.all) → không cộng đôi / không deadlock
 * (6)  Rate limit heartbeat                → 429 khi vượt 6 lần/phút
 * (7)  GET /api/admin/users (admin)        → có onlineSeconds
 * (8)  GET /api/admin/users (user thường)  → 403
 * (9)  Ràng buộc định dạng formatDuration: 0, 59, 60, 3599, 3600, 86400
 * (10) Bảng user_activity_daily cộng khớp với tổng
 *
 * Prerequisites:
 *   - MySQL đang chạy, đã chạy `npm run setup-db` (migration 008)
 *   - Server đang chạy: npm run dev  (mặc định http://localhost:5000)
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

// ── HTTP Helpers ────────────────────────────────────────────────────────────

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
        ...options.headers,
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
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timeout')); });

    if (body) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      req.write(bodyStr);
    }
    req.end();
  });
}

const heartbeat = (token) => request({
  method: 'POST',
  path: '/api/me/activity/heartbeat',
  headers: token ? { Authorization: 'Bearer ' + token } : {},
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Helpers tạo dữ liệu test ───────────────────────────────────────────────

const TEST_USER = {
  firstName: 'HoatDong',
  lastName: 'Test',
  prefix: `activity_t_${Date.now()}`,
  password: 'P@ssword123456!',
};

// Mỗi nhóm test dùng MỘT user riêng để không vượt rate limit 6 lần/phút
const USERS = {
  main: {
    username: `${TEST_USER.prefix}_a`,
    email: `${TEST_USER.prefix}_a@sigmabloom.vn`,
  },
  race: {
    username: `${TEST_USER.prefix}_b`,
    email: `${TEST_USER.prefix}_b@sigmabloom.vn`,
  },
  rate: {
    username: `${TEST_USER.prefix}_c`,
    email: `${TEST_USER.prefix}_c@sigmabloom.vn`,
  },
};

async function createAndLoginTestUser(spec) {
  await request({ method: 'POST', path: '/api/auth/register' }, {
    firstName: TEST_USER.firstName,
    lastName: TEST_USER.lastName,
    username: spec.username,
    email: spec.email,
    password: TEST_USER.password,
    confirmPassword: TEST_USER.password,
    birthYear: 2011,
  });

  const res = await request({ method: 'POST', path: '/api/auth/login' }, {
    emailOrUsername: spec.email,
    password: TEST_USER.password,
    rememberMe: false,
  });

  if (!res.json || !res.json.accessToken) {
    throw new Error(`Đăng nhập test user thất bại (${spec.email}): ${res.body}`);
  }

  const [rows] = await db.query('SELECT id FROM users WHERE email = ?', [spec.email]);
  return { token: res.json.accessToken, userId: rows[0].id };
}

async function getRow(userId) {
  const [rows] = await db.query(
    'SELECT total_seconds, last_heartbeat_at, first_seen_at FROM user_activity WHERE user_id = ?',
    [userId]
  );
  return rows[0] || null;
}

async function getDailySeconds(userId) {
  const [rows] = await db.query(
    'SELECT COALESCE(SUM(seconds), 0) AS total FROM user_activity_daily WHERE user_id = ?',
    [userId]
  );
  return Number(rows[0].total) || 0;
}

/** Tạo token admin giả (đủ để requireAdmin tra DB, không cần login thật) */
function makeAdminToken(userId, username = 'admin') {
  return jwt.sign(
    { id: userId, username, level: 'Admin', role: 'admin' },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
}

async function getAdminToken() {
  const [rows] = await db.query(
    "SELECT id, username FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1"
  );
  if (rows.length === 0) throw new Error('Không tìm thấy tài khoản admin trong DB');
  return makeAdminToken(rows[0].id, rows[0].username);
}

// ── Định dạng thời gian (SAME LOGIC với admin.html) ─────────────────────────
// Dùng để kiểm tra ranh giới hiển thị trên giao diện quản trị.
// NOTE: không import từ HTML; giữ nguyên văn để test bắt được lệch logic.
function formatDuration(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return 'Chưa có';

  const rounded = Math.floor(total);
  if (rounded < 60) return '< 1 phút';
  if (rounded < 3600) return Math.floor(rounded / 60) + ' phút';

  const days = Math.floor(rounded / 86400);
  const hours = Math.floor((rounded % 86400) / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);

  if (days > 0) return days + ' ngày ' + hours + ' giờ';
  return hours + ' giờ ' + minutes + ' phút';
}

// ── Assertions ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label, details) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    if (details !== undefined) console.log(`     Chi tiết: ${details}`);
    failed++;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   PHASE 7 — Test Theo Dõi Thời Gian Online (Activity)         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  console.log(`🔗 Base URL: ${BASE_URL}\n`);

  // Bảo đảm server đang chạy
  try {
    const health = await request({ method: 'GET', path: '/api/health' });
    if (health.status !== 200) {
      console.error('❌ Server không phản hồi /api/health. Hãy chạy `npm run dev` trước.');
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Không kết nối được server:', err.message);
    process.exit(1);
  }

  // Bảng phải tồn tại (migration 008)
  const [tables] = await db.query(
    "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_activity'"
  );
  if (Number(tables[0].cnt) === 0) {
    console.error("❌ Bảng user_activity chưa tồn tại. Hãy chạy `npm run setup-db` trước.");
    process.exit(1);
  }

  const { token, userId } = await createAndLoginTestUser(USERS.main);
  const race = await createAndLoginTestUser(USERS.race);
  const rateUser = await createAndLoginTestUser(USERS.rate);
  console.log(`👤 Test users: ${USERS.main.email} (uid=${userId}), ${USERS.race.email} (uid=${race.userId}), ${USERS.rate.email} (uid=${rateUser.userId})\n`);

  // ── (1) Heartbeat không có token → 401 ─────────────────────────────
  console.log('── (1) Heartbeat KHÔNG có token ──');
  {
    const res = await heartbeat(null);
    assert(res.status === 401, `(1) Status = ${res.status} (mong đợi 401)`);
    assert(res.json && res.json.success === false, '(1) success = false');
    assert(typeof res.json?.message === 'string' && res.json.message.length > 0,
      `(1) Có message tiếng Việt: ${res.json?.message}`);
  }

  // ── (2) Heartbeat lần đầu tạo dòng, total hợp lý ────────────────────
  console.log('\n── (2) Heartbeat LẦN ĐẦU tạo dòng user_activity ──');
  {
    const res = await heartbeat(token);
    assert(res.status === 200, `(2) Status = ${res.status} (mong đợi 200)`);
    assert(res.json?.success === true, '(2) success = true');

    const row = await getRow(userId);
    assert(row !== null, '(2) Đã tạo dòng user_activity trong DB');
    assert(Number(row.total_seconds) === 0,
      `(2) Nhịp đầu tiên KHÔNG cộng thời gian (total_seconds=${row?.total_seconds})`);
    assert(row.last_heartbeat_at !== null, '(2) last_heartbeat_at đã được set');
    assert(row.first_seen_at !== null, '(2) first_seen_at đã được set');
    assert(typeof res.json?.data?.totalSeconds === 'number',
      `(2) Response có data.totalSeconds = ${res.json?.data?.totalSeconds}`);
  }

  // ── (3) 2 heartbeat cách nhau < 20s → không cộng ─────────────────────
  console.log('\n── (3) 2 heartbeat cách nhau < 20s → KHÔNG cộng thêm ──');
  {
    // Đẩy mốc heartbeat về 5 giây trước để mô phỏng "quá sớm"
    await db.query(
      'UPDATE user_activity SET last_heartbeat_at = DATE_SUB(NOW(), INTERVAL 5 SECOND) WHERE user_id = ?',
      [userId]
    );
    const before = Number((await getRow(userId)).total_seconds);

    const res = await heartbeat(token);
    const after = Number((await getRow(userId)).total_seconds);

    assert(res.status === 200, `(3) Status = ${res.status} (mong đợi 200)`);
    assert(after === before, `(3) total_seconds không đổi (${before} → ${after})`);
    assert(res.json?.data?.addedSeconds === 0,
      `(3) addedSeconds = 0 (thực tế: ${res.json?.data?.addedSeconds})`);
    assert(res.json?.data?.reason === 'too_soon',
      `(3) reason = 'too_soon' (thực tế: ${res.json?.data?.reason})`);
  }

  // ── (4) Khoảng hở > 90s → không cộng khoảng hở ──────────────────────
  console.log('\n── (4) Khoảng hở > 90s → coi là PHIÊN MỚI, không cộng gap ──');
  {
    // Đẩy mốc heartbeat về 10 PHÚT trước
    await db.query(
      'UPDATE user_activity SET last_heartbeat_at = DATE_SUB(NOW(), INTERVAL 600 SECOND) WHERE user_id = ?',
      [userId]
    );
    const before = Number((await getRow(userId)).total_seconds);

    const res = await heartbeat(token);
    const row = await getRow(userId);
    const after = Number(row.total_seconds);

    assert(res.status === 200, `(4) Status = ${res.status} (mong đợi 200)`);
    assert(res.json?.data?.reason === 'new_session',
      `(4) reason = 'new_session' (thực tế: ${res.json?.data?.reason})`);
    assert(res.json?.data?.addedSeconds === 30,
      `(4) addedSeconds = 30 cho nhịp đầu phiên mới (thực tế: ${res.json?.data?.addedSeconds})`);
    // 600s gap KHÔNG được cộng — chỉ cộng tối đa 30s
    assert(after - before === 30,
      `(4) Chỉ cộng 30s, KHÔNG cộng 600s gap (${before} → ${after})`);
    assert(after - before < 600,
      `(4) Xác nhận khoảng hở 600s không bị tính nhầm`);
  }

  // ── (5) Heartbeat bình thường 30s → cộng đúng, cap 60s ───────────────
  console.log('\n── (5) Heartbeat trong phiên liên tục (delta 30s và 300s) ──');
  {
    await db.query(
      'UPDATE user_activity SET last_heartbeat_at = DATE_SUB(NOW(), INTERVAL 30 SECOND) WHERE user_id = ?',
      [userId]
    );
    const before = Number((await getRow(userId)).total_seconds);
    const res = await heartbeat(token);
    const after = Number((await getRow(userId)).total_seconds);

    assert(res.json?.data?.reason === 'counted', `(5) reason = 'counted' (thực tế: ${res.json?.data?.reason})`);
    assert(after - before === 30,
      `(5) Cộng đúng delta 30s (${before} → ${after}, +${after - before})`);
  }
  {
    // Delta 80s nằm trong [20s, 90s] → được cộng nhưng cap cứng 60s mỗi nhịp
    await db.query(
      'UPDATE user_activity SET last_heartbeat_at = DATE_SUB(NOW(), INTERVAL 80 SECOND) WHERE user_id = ?',
      [userId]
    );
    const before = Number((await getRow(userId)).total_seconds);
    const res = await heartbeat(token);
    const after = Number((await getRow(userId)).total_seconds);

    assert(res.json?.data?.reason === 'counted',
      `(5b) reason = 'counted' cho delta 80s (thực tế: ${res.json?.data?.reason})`);
    assert(after - before === 60,
      `(5b) Delta 80s bị CAP còn 60s (${before} → ${after}, +${after - before})`);
  }

  // ── (6) 2 heartbeat ĐỒNG THỜI → không cộng đôi / không deadlock ───────
  console.log('\n── (6) 2 heartbeat ĐỒNG THỜI (Promise.all) ──');
  {
    // Nhịp đầu tiên để tạo dòng cho user race
    await heartbeat(race.token);
    await db.query(
      'UPDATE user_activity SET last_heartbeat_at = DATE_SUB(NOW(), INTERVAL 45 SECOND) WHERE user_id = ?',
      [race.userId]
    );
    const before = Number((await getRow(race.userId)).total_seconds);

    const started = Date.now();
    const [r1, r2] = await Promise.all([heartbeat(race.token), heartbeat(race.token)]);
    const elapsed = Date.now() - started;
    const after = Number((await getRow(race.userId)).total_seconds);

    assert(r1.status === 200 && r2.status === 200,
      `(6) Cả 2 request đều 200 (${r1.status}, ${r2.status})`);
    assert(elapsed < 10000, `(6) Không deadlock (${elapsed}ms)`);

    const added = (r1.json?.data?.addedSeconds || 0) + (r2.json?.data?.addedSeconds || 0);
    assert(added <= 60,
      `(6) Tổng phần cộng của 2 request song song <= 60s (thực tế: ${added})`);
    assert(after - before <= 60,
      `(6) total_seconds tăng <= 60s, không nhân đôi (${before} → ${after})`);
    assert(after - before >= 0,
      `(6) total_seconds không bị trừ (${before} → ${after})`);
  }

  // ── (7) Bảng daily cộng khớp ────────────────────────────────────────
  console.log('\n── (7) Bảng user_activity_daily cộng khớp tổng ──');
  {
    const total = Number((await getRow(userId)).total_seconds);
    const daily = await getDailySeconds(userId);
    assert(daily === total,
      `(7) Tổng daily (${daily}) === total_seconds (${total})`);
    assert(total > 0, `(7) total_seconds > 0 (${total})`);
  }

  // ── (8) Admin users có onlineSeconds ───────────────────────────────
  console.log('\n── (8) GET /api/admin/users (admin) chứa onlineSeconds ──');
  const adminToken = await getAdminToken();
  {
    const res = await request({
      method: 'GET',
      path: `/api/admin/users?limit=100&search=${encodeURIComponent(USERS.main.email)}`,
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert(res.status === 200, `(8) Status = ${res.status} (mong đợi 200)`);

    const users = res.json?.data?.users || [];
    const me = users.find(u => u.email === USERS.main.email);
    assert(Boolean(me), `(8) Tìm thấy test user trong danh sách admin`);
    assert(typeof me?.onlineSeconds === 'number',
      `(8) Có trường onlineSeconds kiểu number (thực tế: ${me?.onlineSeconds})`);
    assert(me?.onlineSeconds === Number((await getRow(userId)).total_seconds),
      `(8) onlineSeconds khớp DB (${me?.onlineSeconds})`);
    assert(typeof me?.isOnlineNow === 'boolean',
      `(8) Có trường isOnlineNow kiểu boolean (thực tế: ${me?.isOnlineNow})`);
    assert(me?.isOnlineNow === true,
      '(8) isOnlineNow = true (vừa heartbeat xong < 90s)');
    assert(me?.lastHeartbeatAt !== null, '(8) Trả về lastHeartbeatAt');
  }

  // ── (8b) Sắp xếp theo online_desc (whitelist) ───────────────────────
  console.log('\n── (8b) Sắp xếp theo thời gian online (?sort=online_desc) ──');
  {
    const res = await request({
      method: 'GET',
      path: '/api/admin/users?limit=50&sort=online_desc',
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert(res.status === 200, `(8b) Status = ${res.status} (mong đợi 200)`);
    const users = res.json?.data?.users || [];
    const desc = users.every((u, i) => i === 0 || (Number(users[i - 1].onlineSeconds) || 0) >= (Number(u.onlineSeconds) || 0));
    assert(desc, '(8b) Danh sách sắp xếp giảm dần theo onlineSeconds');

    // Giá trị sort không hợp lệ phải fallback về mặc định, KHÔNG lỗi SQL
    const bad = await request({
      method: 'GET',
      path: '/api/admin/users?limit=5&sort=' + encodeURIComponent('id;DROP TABLE users--'),
      headers: { Authorization: 'Bearer ' + adminToken },
    });
    assert(bad.status === 200,
      `(8b) Sort giá trị rác không gây lỗi (status=${bad.status}) — whitelist an toàn`);
  }

  // ── (9) User thường gọi /api/admin/users → 403 ──────────────────────
  console.log('\n── (9) GET /api/admin/users bằng tài khoản thường → 403 ──');
  {
    const res = await request({
      method: 'GET',
      path: '/api/admin/users',
      headers: { Authorization: 'Bearer ' + token },
    });
    assert(res.status === 403, `(9) Status = ${res.status} (mong đợi 403)`);
  }

  // ── (10) Rate limit heartbeat ───────────────────────────────────────
  console.log('\n── (10) Rate limit heartbeat (6 lần/phút) ──');
  {
    // Dùng user riêng để không bị "vô tình" đạt rate limit từ các test trước
    let got429 = false;
    let attempts = 0;
    for (; attempts < 10; attempts++) {
      const res = await heartbeat(rateUser.token);
      if (res.status === 429) {
        got429 = true;
        assert(res.json?.success === false, `(10) 429 trả về success=false`);
        assert(typeof res.json?.message === 'string' && res.json.message.length > 0,
          `(10) 429 có message tiếng Việt: ${res.json?.message}`);
        break;
      }
    }
    assert(got429, `(10) Endpoint heartbeat trả 429 khi vượt giới hạn (sau ${attempts} lần gọi)`);
  }

  // ── (11) Ràng buộc định dạng formatDuration ──────────────────────────
  console.log('\n── (11) Ràng buộc định dạng formatDuration ──');
  {
    const cases = [
      [0, 'Chưa có'],
      [null, 'Chưa có'],
      [undefined, 'Chưa có'],
      [1, '< 1 phút'],
      [59, '< 1 phút'],
      [60, '1 phút'],
      [3599, '59 phút'],
      [3600, '1 giờ 0 phút'],
      [3660, '1 giờ 1 phút'],
      [86400, '1 ngày 0 giờ'],
      [90000, '1 ngày 1 giờ'],
    ];
    for (const [input, expected] of cases) {
      const actual = formatDuration(input);
      assert(actual === expected,
        `(11) formatDuration(${input}) = "${actual}" (mong đợi "${expected}")`);
    }
  }

  // ── (12) Dọn dẹp ────────────────────────────────────────────────────
  console.log('\n── (12) Dọn dẹp dữ liệu kiểm thử ──');
  {
    const emails = Object.values(USERS).map(u => u.email);
    await db.query('DELETE FROM users WHERE email IN (?,?,?)', emails);
    const row = await getRow(userId);
    assert(row === null, '(12) Bản ghi activity bị xóa theo FK CASCADE khi xóa user');
  }

  // ── Tổng kết ───────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   KẾT QUẢ PHASE 7 — ACTIVITY TRACKING                         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n  ✅ Pass: ${passed}`);
  console.log(`  ❌ Fail: ${failed}`);
  console.log(`  📊 Total: ${passed + failed}\n`);

  await db.end();

  if (failed === 0) {
    console.log('🎉 TẤT CẢ TEST ACTIVITY ĐÃ VƯỢT QUA!\n');
    process.exit(0);
  }
  console.log('⚠️  CÓ TEST BỊ LỖI — vui lòng kiểm tra lại.\n');
  process.exit(1);
}

runTests().catch(async (err) => {
  console.error('\n💥 Test script crashed:', err.message);
  console.error(err.stack);
  try { await db.end(); } catch (_) { /* ignore */ }
  process.exit(1);
});