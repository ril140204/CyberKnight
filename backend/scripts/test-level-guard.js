/**
 * PHASE 4 — Test script cho Level Guard & Level Launch
 *
 * Chạy: node backend/scripts/test-level-guard.js
 *
 * Test cases:
 * (a) Unauthenticated GET /level1/level1.html → 403/401
 * (b) Logged-in user without pack → POST /api/levels/1/launch → 403 LEVEL_LOCKED
 * (c) User with pack_1_4 → launch → 200 → GET /level1/level1.html (with cookie) → 200, body = level1.html
 *     GET /level1/level1.js, /level1/level1.css → 200 with correct content-types
 * (d) Same cookie → /level5/... → 403 (level 5 cần gói pack_5_10)
 * (d2) /level9/level9.html → 404 (level chưa phát hành)
 * (d3) Level 6: no pack → launch 403 LEVEL_LOCKED · pack_1_4 cookie → 403
     pack_5_10 → launch 200 · serve html/js/css · video /video/level 6/ OK
 * (d4) Level 7: no pack → launch 403 LEVEL_LOCKED · pack_1_4 cookie → 403
     pack_5_10 → launch 200 · serve html/js/css · video /video/level 7/ OK
 * (d5) Level 8: no pack → launch 403 LEVEL_LOCKED · pack_1_4 cookie → 403
     pack_5_10 → launch 200 · serve html/js/css · video /video/level 8/ OK
 * (e) Tampered cookie signature → 403
 * (f) /level0/level0.html → 200, no login required
 * (g) /level1/..%2f..%2fbackend/.env → NOT leak .env (403/404, no .env content)
 *
 * Prerequisites:
 *   - PostgreSQL schema created (npm run setup-db)
 *   - Server running: npm run dev
 *   - LEVEL_ACCESS_SECRET set in .env
 *
 * Author: Senior Full-Stack Developer
 */

'use strict';

const http = require('http');
const db = require('../src/config/db');

// ── Config ──────────────────────────────────────────────────────
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';
const LEVEL_ACCESS_SECRET = process.env.LEVEL_ACCESS_SECRET || 'sigmabloom_level_access_secret_please_change_this_2026_09';

// Test users (registered on first run if not exist)
const TEST_USERS = {
  // User WITHOUT any package
  noPack: {
    email: 'test_nopack_17062024a@sigmabloom.vn',
    username: 'test_nopack_a',
    password: 'T3stP@ssw0rd!',
    firstName: 'Test',
    lastName: 'NoPack',
  },
  // User WITH pack_1_4 entitlement
  withPack: {
    email: 'test_pack14_17062024a@sigmabloom.vn',
    username: 'test_pack14_a',
    password: 'T3stP@ssw0rd!',
    firstName: 'Test',
    lastName: 'Pack14',
  },
  // User riêng cho Level 6 (pack_5_10) — tách khỏi withPack để test (d)/(d3-b)
  // không bị ảnh hưởng khi DB đã tích luỹ entitlement từ lần chạy trước.
  withPack510: {
    email: 'test_pack510_17062024a@sigmabloom.vn',
    username: 'test_pack510_a',
    password: 'T3stP@ssw0rd!',
    firstName: 'Test',
    lastName: 'Pack510',
  },
};

// ── HTTP Helpers ─────────────────────────────────────────────────

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

function parseSetCookie(header) {
  if (!header) return {};
  const cookies = Array.isArray(header) ? header : [header];
  const result = {};
  for (const cookie of cookies) {
    const [pair] = cookie.split(';');
    const [name, value] = pair.split('=');
    if (name && value !== undefined) {
      result[name.trim()] = value.trim();
    }
  }
  return result;
}

// ── Auth Helpers ────────────────────────────────────────────────

async function registerUser(user) {
  const res = await request({
    method: 'POST',
    path: '/api/auth/register',
  }, {
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    email: user.email,
    password: user.password,
    confirmPassword: user.password,
    birthYear: 2010,
  });
  return res;
}

async function loginUser(user) {
  const res = await request({
    method: 'POST',
    path: '/api/auth/login',
  }, {
    emailOrUsername: user.email,
    password: user.password,
    rememberMe: false,
  });
  return res;
}

async function getAccessToken(user) {
  // Try login first (handles already-registered users from previous runs)
  try {
    const loginRes = await loginUser(user);
    if (loginRes.json && loginRes.json.accessToken) {
      return loginRes.json.accessToken;
    }
  } catch (_) { /* fall through to register */ }

  // Not registered yet → register then login
  await registerUser(user);
  const loginRes = await loginUser(user);
  if (!loginRes.json || !loginRes.json.accessToken) {
    throw new Error(`Login failed for ${user.email}: ${JSON.stringify(loginRes.json)}`);
  }
  return loginRes.json.accessToken;
}

async function grantPackToUser(userEmail, packageId = 'pack_1_4') {
  // Grant pack trực tiếp qua DB — bypasses admin API complexity cho tests
  try {
    const [rows] = await db.query('SELECT id FROM users WHERE email = ?', [userEmail]);
    if (rows.length === 0) {
      throw new Error(`User ${userEmail} not found`);
    }
    const userId = rows[0].id;

    await db.query(
      `INSERT INTO user_entitlements (user_id, package_id, source, granted_at)
       VALUES (?, ?, 'admin_grant', NOW())
       ON CONFLICT (user_id, package_id) DO UPDATE SET source = 'admin_grant', granted_at = NOW()`,
      [userId, packageId]
    );

    console.log(`  ✅ Granted ${packageId} to ${userEmail} (uid=${userId})`);
    return userId;
  } catch (err) {
    throw new Error(`Cannot grant ${packageId}: ` + err.message);
  }
}

async function grantPack14ToUser(userEmail) {
  try {
    const [rows] = await db.query('SELECT id FROM users WHERE email = ?', [userEmail]);
    if (rows.length > 0) {
      await db.query('DELETE FROM user_entitlements WHERE user_id = ? AND package_id != ?', [rows[0].id, 'pack_1_4']);
    }
  } catch (_) {}
  return grantPackToUser(userEmail, 'pack_1_4');
}

// ── Test Helpers ────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label, details) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    if (details) console.log(`     Details: ${details}`);
    failed++;
  }
}

async function unlockAdmin() {
  try {
    // Unlock admin + any test users that might be locked from previous runs
    const result = await db.query(
      "UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE username = 'admin' OR username LIKE 'test_%' OR email LIKE '%test_%@sigmabloom.vn'"
    );
    console.log(`  🔓 Unlocked users (affected rows: ${result[0]?.affectedRows || 0})`);
  } catch (err) {
    console.log(`  ⚠️  unlockAdmin error: ${err.message}`);
    // ignore
  }
}

// ── Main Test Runner ─────────────────────────────────────────────

async function runTests() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   PHASE 4 — Level Guard & Launch Integration Tests          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log(`🔗 Base URL: ${BASE_URL}`);
  console.log(`🔑 LEVEL_ACCESS_SECRET: ${LEVEL_ACCESS_SECRET ? '(set)' : '(MISSING!)'}\n`);

  // ── Setup: Register test users & grant entitlements ──────────────
  console.log('── SETUP: Preparing test users ──');

  // Unlock admin if locked from previous runs
  await unlockAdmin();

  let noPackToken;
  let pack14Token;
  let pack510Token;
  let pack14Cookies = {};

  try {
    noPackToken = await getAccessToken(TEST_USERS.noPack);
    console.log(`  ✅ Registered/logged-in noPack user`);
  } catch (err) {
    console.error(`  ❌ Failed to get token for noPack: ${err.message}`);
    process.exit(1);
  }

  try {
    // Register the pack user first
    await registerUser(TEST_USERS.withPack);
    const loginRes = await loginUser(TEST_USERS.withPack);
    pack14Token = loginRes.json.accessToken;

    // Grant pack_1_4 via admin
    await grantPack14ToUser(TEST_USERS.withPack.email);
    console.log(`  ✅ Registered/logged-in pack14 user and granted pack_1_4`);
  } catch (err) {
    console.error(`  ❌ Failed: ${err.message}`);
    process.exit(1);
  }

  try {
    // User riêng cho Level 6 — chỉ có pack_5_10
    await registerUser(TEST_USERS.withPack510);
    const login510 = await loginUser(TEST_USERS.withPack510);
    pack510Token = login510.json.accessToken;
    await grantPackToUser(TEST_USERS.withPack510.email, 'pack_5_10');
    console.log(`  ✅ Registered/logged-in pack510 user and granted pack_5_10`);
  } catch (err) {
    console.error(`  ❌ Failed: ${err.message}`);
    process.exit(1);
  }

  // ── Test (a): Unauthenticated access to level1 ──────────────────
  console.log('\n── TEST (a): Unauthenticated GET /level1/level1.html ──');
  {
    const res = await request({ method: 'GET', path: '/level1/level1.html' });
    assert(
      res.status === 401 || res.status === 403,
      `(a) Status = ${res.status} (expect 401 or 403)`
    );
    assert(
      res.body && !res.body.includes('level1.html'),
      `(a) Body does NOT contain level1.html content (protected)`
    );
  }

  // ── Test (b): User without pack calls launch ────────────────────
  console.log('\n── TEST (b): User without pack → POST /api/levels/1/launch ──');
  {
    const res = await request({
      method: 'POST',
      path: '/api/levels/1/launch',
      headers: { Authorization: 'Bearer ' + noPackToken },
    });
    assert(
      res.status === 403,
      `(b) Status = ${res.status} (expect 403)`
    );
    assert(
      res.json && res.json.error === 'LEVEL_LOCKED',
      `(b) Error code = LEVEL_LOCKED (got: ${res.json && res.json.error})`
    );
    assert(
      res.json && res.json.data && res.json.data.requiredPackages,
      `(b) Response includes requiredPackages`
    );
  }

  // ── Test (c): User with pack_1_4 calls launch → gets cookie ────
  console.log('\n── TEST (c): User with pack_1_4 → launch → GET level files ──');
  {
    // Call launch
    const launchRes = await request({
      method: 'POST',
      path: '/api/levels/1/launch',
      headers: { Authorization: 'Bearer ' + pack14Token },
    });

    assert(
      launchRes.status === 200,
      `(c) Launch status = ${launchRes.status} (expect 200)`
    );
    assert(
      launchRes.json && launchRes.json.success === true,
      `(c) Launch success = true (got: ${JSON.stringify(launchRes.json)})`
    );
    assert(
      launchRes.json && launchRes.json.url === '/level1/level1.html',
      `(c) Launch url = /level1/level1.html`
    );
    assert(
      launchRes.headers['set-cookie'] && launchRes.headers['set-cookie'].some(c => c.startsWith('levelAccess=')),
      `(c) Response sets levelAccess cookie`
    );

    // Extract levelAccess cookie
    const cookies = parseSetCookie(launchRes.headers['set-cookie']);
    const levelAccessCookie = cookies['levelAccess'];
    assert(
      Boolean(levelAccessCookie),
      `(c) levelAccess cookie value present (length=${levelAccessCookie ? levelAccessCookie.length : 0})`
    );

    // Verify JWT inside cookie
    if (levelAccessCookie) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(levelAccessCookie, LEVEL_ACCESS_SECRET);
        assert(
          decoded.uid !== undefined,
          `(c) Cookie JWT has uid field`
        );
        assert(
          Array.isArray(decoded.levels) && decoded.levels.includes(1),
          `(c) Cookie JWT levels includes level 1 (got: ${JSON.stringify(decoded.levels)})`
        );
      } catch (err) {
        assert(false, `(c) Cookie JWT verify: ${err.message}`);
      }
    }

    // Now GET /level1/level1.html with the cookie
    const level1Html = await request({
      method: 'GET',
      path: '/level1/level1.html',
      headers: {
        Cookie: `levelAccess=${levelAccessCookie}`,
      },
    });

    assert(
      level1Html.status === 200,
      `(c) GET /level1/level1.html status = ${level1Html.status} (expect 200)`
    );
    assert(
      level1Html.body && level1Html.body.trim().startsWith('<!DOCTYPE'),
      `(c) Body starts with <!DOCTYPE (is HTML, not index.html)`
    );
    assert(
      level1Html.body && level1Html.body.includes('level1') && level1Html.body.includes('<!DOCTYPE'),
      `(c) Body contains level1 markers (<!DOCTYPE + level1) — is real level1.html`
    );

    // GET /level1/level1.js
    const level1Js = await request({
      method: 'GET',
      path: '/level1/level1.js',
      headers: { Cookie: `levelAccess=${levelAccessCookie}` },
    });
    assert(
      level1Js.status === 200,
      `(c) GET /level1/level1.js status = ${level1Js.status} (expect 200)`
    );
    assert(
      level1Js.headers['content-type'] && level1Js.headers['content-type'].includes('javascript'),
      `(c) Content-Type = application/javascript (got: ${level1Js.headers['content-type']})`
    );

    // GET /level1/level1.css
    const level1Css = await request({
      method: 'GET',
      path: '/level1/level1.css',
      headers: { Cookie: `levelAccess=${levelAccessCookie}` },
    });
    assert(
      level1Css.status === 200,
      `(c) GET /level1/level1.css status = ${level1Css.status} (expect 200)`
    );
    assert(
      level1Css.headers['content-type'] && (
        level1Css.headers['content-type'].includes('css') ||
        level1Css.headers['content-type'].includes('stylesheet')
      ),
      `(c) Content-Type = text/css (got: ${level1Css.headers['content-type']})`
    );

    // Check Cache-Control header
    // Level files dùng 'private, no-cache' (KHÔNG phải no-store): trình duyệt được
    // cache riêng nhưng phải revalidate mỗi lần → request vẫn đi qua level guard.
    assert(
      level1Html.headers['cache-control'] && level1Html.headers['cache-control'].includes('private'),
      `(c) Cache-Control: private, no-cache on level file (got: ${level1Html.headers['cache-control']})`
    );
  }

  // ── Test (d): Same cookie cannot access level5 (needs pack_5_10) ─
  console.log('\n── TEST (d): Cookie from level1 pack → GET /level5/level5.html ──');
  {
    // Get a fresh levelAccess cookie (launch level 1)
    const launchRes = await request({
      method: 'POST',
      path: '/api/levels/1/launch',
      headers: { Authorization: 'Bearer ' + pack14Token },
    });
    const cookies = parseSetCookie(launchRes.headers['set-cookie']);
    const levelAccessCookie = cookies['levelAccess'];

    // level5 đã phát hành nhưng không nằm trong gói pack_1_4 → should be 403
    const res = await request({
      method: 'GET',
      path: '/level5/level5.html',
      headers: { Cookie: `levelAccess=${levelAccessCookie}` },
    });

    assert(
      res.status === 403,
      `(d) GET /level5/level5.html status = ${res.status} (expect 403 — level5 cần gói pack_5_10)`
    );
  }

  // ── Test (d2): Level chưa phát hành (9) → 404 ────────────────
  console.log('\n── TEST (d2): GET /level9/level9.html (chưa phát hành) ──');
  {
    const res = await request({
      method: 'GET',
      path: '/level9/level9.html',
    });

    assert(
      res.status === 404,
      `(d2) GET /level9/level9.html status = ${res.status} (expect 404 — level9 not in catalog)`
    );
  }

  // ── Test (d3): Level 6 — chưa mua gói → 403 LEVEL_LOCKED ────
  console.log('\n── TEST (d3): Level 6 launch rules (pack_5_10) ──');
  {
    // (d3-a) noPack user launch level 6 → 403
    const launchRes = await request({
      method: 'POST',
      path: '/api/levels/6/launch',
      headers: { Authorization: 'Bearer ' + noPackToken },
    });
    assert(
      launchRes.status === 403,
      `(d3-a) POST /api/levels/6/launch (no pack) status = ${launchRes.status} (expect 403)`
    );
    assert(
      launchRes.json && launchRes.json.error === 'LEVEL_LOCKED',
      `(d3-a) error = LEVEL_LOCKED (got: ${launchRes.json && launchRes.json.error})`
    );

    // (d3-b) pack_1_4 cookie KHÔNG mở được level6 → 403
    const launch1 = await request({
      method: 'POST',
      path: '/api/levels/1/launch',
      headers: { Authorization: 'Bearer ' + pack14Token },
    });
    const cookie14 = parseSetCookie(launch1.headers['set-cookie']).levelAccess;
    const res6 = await request({
      method: 'GET',
      path: '/level6/level6.html',
      headers: { Cookie: `levelAccess=${cookie14}` },
    });
    assert(
      res6.status === 403,
      `(d3-b) GET /level6/level6.html with pack_1_4 cookie = ${res6.status} (expect 403)`
    );

    // (d3-c) Grant pack_5_10 → launch level 6 → 200 → serve đủ html/js/css
    await grantPackToUser(TEST_USERS.withPack.email, 'pack_5_10');
    const launch6 = await request({
      method: 'POST',
      path: '/api/levels/6/launch',
      headers: { Authorization: 'Bearer ' + pack14Token },
    });
    assert(
      launch6.status === 200,
      `(d3-c) POST /api/levels/6/launch (pack_5_10) status = ${launch6.status} (expect 200)`
    );
    assert(
      launch6.json && launch6.json.url === '/level6/level6.html',
      `(d3-c) Launch url = /level6/level6.html`
    );

    const cookie56 = parseSetCookie(launch6.headers['set-cookie']).levelAccess;
    const html6 = await request({
      method: 'GET',
      path: '/level6/level6.html',
      headers: { Cookie: `levelAccess=${cookie56}` },
    });
    assert(
      html6.status === 200,
      `(d3-c) GET /level6/level6.html status = ${html6.status} (expect 200)`
    );
    assert(
      html6.body && html6.body.includes('level6.js'),
      `(d3-c) Body references level6.js`
    );

    const js6 = await request({
      method: 'GET',
      path: '/level6/level6.js',
      headers: { Cookie: `levelAccess=${cookie56}` },
    });
    assert(
      js6.status === 200 && js6.headers['content-type'] && js6.headers['content-type'].includes('javascript'),
      `(d3-c) GET /level6/level6.js status = ${js6.status}, type = ${js6.headers && js6.headers['content-type']}`
    );

    const css6 = await request({
      method: 'GET',
      path: '/level6/level6.css',
      headers: { Cookie: `levelAccess=${cookie56}` },
    });
    assert(
      css6.status === 200 && css6.headers['content-type'] && css6.headers['content-type'].includes('css'),
      `(d3-c) GET /level6/level6.css status = ${css6.status}, type = ${css6.headers && css6.headers['content-type']}`
    );

    // (d3-d) Video của level 6 phải truy cập được qua /video/level 6/
    const vid6 = await request({ method: 'GET', path: '/video/level%206/scene1.mp4' });
    assert(
      vid6.status === 200,
      `(d3-d) GET /video/level%206/scene1.mp4 status = ${vid6.status} (expect 200)`
    );
  }

  // ── Test (d4): Level 7 — chưa mua gói → 403 LEVEL_LOCKED ────
  console.log('\n── TEST (d4): Level 7 launch rules (pack_5_10) ──');
  {
    // (d4-a) noPack user launch level 7 → 403
    const launchRes = await request({
      method: 'POST',
      path: '/api/levels/7/launch',
      headers: { Authorization: 'Bearer ' + noPackToken },
    });
    assert(
      launchRes.status === 403,
      `(d4-a) POST /api/levels/7/launch (no pack) status = ${launchRes.status} (expect 403)`
    );
    assert(
      launchRes.json && launchRes.json.error === 'LEVEL_LOCKED',
      `(d4-a) error = LEVEL_LOCKED (got: ${launchRes.json && launchRes.json.error})`
    );

    // (d4-b) pack_1_4 cookie KHÔNG mở được level7 → 403
    await grantPack14ToUser(TEST_USERS.withPack.email);
    const launch1 = await request({
      method: 'POST',
      path: '/api/levels/1/launch',
      headers: { Authorization: 'Bearer ' + pack14Token },
    });
    const cookie14 = parseSetCookie(launch1.headers['set-cookie']).levelAccess;
    const res7 = await request({
      method: 'GET',
      path: '/level7/level7.html',
      headers: { Cookie: `levelAccess=${cookie14}` },
    });
    assert(
      res7.status === 403,
      `(d4-b) GET /level7/level7.html with pack_1_4 cookie = ${res7.status} (expect 403)`
    );

    // (d4-c) Launch level 7 với pack_5_10 → 200 → serve đủ html/js/css
    const launch7 = await request({
      method: 'POST',
      path: '/api/levels/7/launch',
      headers: { Authorization: 'Bearer ' + pack510Token },
    });
    assert(
      launch7.status === 200,
      `(d4-c) POST /api/levels/7/launch (pack_5_10) status = ${launch7.status} (expect 200)`
    );
    assert(
      launch7.json && launch7.json.url === '/level7/level7.html',
      `(d4-c) Launch url = /level7/level7.html`
    );

    const cookie7 = parseSetCookie(launch7.headers['set-cookie']).levelAccess;
    const html7 = await request({
      method: 'GET',
      path: '/level7/level7.html',
      headers: { Cookie: `levelAccess=${cookie7}` },
    });
    assert(
      html7.status === 200,
      `(d4-c) GET /level7/level7.html status = ${html7.status} (expect 200)`
    );
    assert(
      html7.body && html7.body.includes('level7.js'),
      `(d4-c) Body references level7.js`
    );

    const js7 = await request({
      method: 'GET',
      path: '/level7/level7.js',
      headers: { Cookie: `levelAccess=${cookie7}` },
    });
    assert(
      js7.status === 200 && js7.headers['content-type'] && js7.headers['content-type'].includes('javascript'),
      `(d4-c) GET /level7/level7.js status = ${js7.status}, type = ${js7.headers && js7.headers['content-type']}`
    );

    const css7 = await request({
      method: 'GET',
      path: '/level7/level7.css',
      headers: { Cookie: `levelAccess=${cookie7}` },
    });
    assert(
      css7.status === 200 && css7.headers['content-type'] && css7.headers['content-type'].includes('css'),
      `(d4-c) GET /level7/level7.css status = ${css7.status}, type = ${css7.headers && css7.headers['content-type']}`
    );

    // (d4-d) Video của level 7 phải truy cập được qua /video/level 7/
    const vid7 = await request({ method: 'GET', path: '/video/level%207/intro.mp4' });
    assert(
      vid7.status === 200,
      `(d4-d) GET /video/level%207/intro.mp4 status = ${vid7.status} (expect 200)`
    );
  }

  // ── Test (d5): Level 8 launch rules (pack_5_10) ───────────────
  console.log('\n── TEST (d5): Level 8 launch rules (pack_5_10) ──');
  {
    // (d5-a) noPack user launch level 8 → 403
    const launchRes = await request({
      method: 'POST',
      path: '/api/levels/8/launch',
      headers: { Authorization: 'Bearer ' + noPackToken },
    });
    assert(
      launchRes.status === 403,
      `(d5-a) POST /api/levels/8/launch (no pack) status = ${launchRes.status} (expect 403)`
    );
    assert(
      launchRes.json && launchRes.json.error === 'LEVEL_LOCKED',
      `(d5-a) error = LEVEL_LOCKED (got: ${launchRes.json && launchRes.json.error})`
    );

    // (d5-b) pack_1_4 cookie KHÔNG mở được level8 → 403
    await grantPack14ToUser(TEST_USERS.withPack.email);
    const launch1 = await request({
      method: 'POST',
      path: '/api/levels/1/launch',
      headers: { Authorization: 'Bearer ' + pack14Token },
    });
    const cookie14 = parseSetCookie(launch1.headers['set-cookie']).levelAccess;
    const res8 = await request({
      method: 'GET',
      path: '/level8/level8.html',
      headers: { Cookie: `levelAccess=${cookie14}` },
    });
    assert(
      res8.status === 403,
      `(d5-b) GET /level8/level8.html with pack_1_4 cookie = ${res8.status} (expect 403)`
    );

    // (d5-c) Launch level 8 với pack_5_10 → 200 → serve đủ html/js/css
    const launch8 = await request({
      method: 'POST',
      path: '/api/levels/8/launch',
      headers: { Authorization: 'Bearer ' + pack510Token },
    });
    assert(
      launch8.status === 200,
      `(d5-c) POST /api/levels/8/launch (pack_5_10) status = ${launch8.status} (expect 200)`
    );
    assert(
      launch8.json && launch8.json.url === '/level8/level8.html',
      `(d5-c) Launch url = /level8/level8.html`
    );

    const cookie8 = parseSetCookie(launch8.headers['set-cookie']).levelAccess;
    const html8 = await request({
      method: 'GET',
      path: '/level8/level8.html',
      headers: { Cookie: `levelAccess=${cookie8}` },
    });
    assert(
      html8.status === 200,
      `(d5-c) GET /level8/level8.html status = ${html8.status} (expect 200)`
    );
    assert(
      html8.body && html8.body.includes('level8.js'),
      `(d5-c) Body references level8.js`
    );

    const js8 = await request({
      method: 'GET',
      path: '/level8/level8.js',
      headers: { Cookie: `levelAccess=${cookie8}` },
    });
    assert(
      js8.status === 200 && js8.headers['content-type'] && js8.headers['content-type'].includes('javascript'),
      `(d5-c) GET /level8/level8.js status = ${js8.status}, type = ${js8.headers && js8.headers['content-type']}`
    );

    const css8 = await request({
      method: 'GET',
      path: '/level8/level8.css',
      headers: { Cookie: `levelAccess=${cookie8}` },
    });
    assert(
      css8.status === 200 && css8.headers['content-type'] && css8.headers['content-type'].includes('css'),
      `(d5-c) GET /level8/level8.css status = ${css8.status}, type = ${css8.headers && css8.headers['content-type']}`
    );

    // (d5-d) Video của level 8 phải truy cập được qua /video/level 8/
    const vid8 = await request({ method: 'GET', path: '/video/level%208/intro.mp4' });
    assert(
      vid8.status === 200,
      `(d5-d) GET /video/level%208/intro.mp4 status = ${vid8.status} (expect 200)`
    );
  }

  // ── Test (e): Tampered cookie → 403 ───────────────────────────
  console.log('\n── TEST (e): Tampered levelAccess cookie → 403 ──');
  {
    const tampered = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjEwMCwibGV2ZWxzIjpbMSwyLDNdLCJpYXQiOjE3MDYyNTI2MDB9.TAMPERED_SIGNATURE_NOT_VALID';
    const res = await request({
      method: 'GET',
      path: '/level1/level1.html',
      headers: { Cookie: `levelAccess=${tampered}` },
    });
    assert(
      res.status === 403,
      `(e) Tampered cookie → status = ${res.status} (expect 403)`
    );
  }

  // ── Test (f): /level0/level0.html → 200, no login required ───
  console.log('\n── TEST (f): /level0/level0.html → 200 (FREE_LEVEL, no auth) ──');
  {
    const res = await request({ method: 'GET', path: '/level0/level0.html' });
    assert(
      res.status === 200,
      `(f) GET /level0/level0.html status = ${res.status} (expect 200)`
    );
    assert(
      res.body && res.body.trim().startsWith('<!DOCTYPE'),
      `(f) Body is HTML`
    );
  }

  // ── Test (g): Path traversal blocked ────────────────────────────
  console.log('\n── TEST (g): Path traversal /level1/..%2f..%2fbackend/.env ──');
  {
    const res = await request({ method: 'GET', path: '/level1/..%2f..%2fbackend/.env' });
    assert(
      res.status === 403 || res.status === 404,
      `(g) Status = ${res.status} (expect 403 or 404)`
    );
    assert(
      res.body && !res.body.includes('DB_PASSWORD') && !res.body.includes('JWT_SECRET'),
      `(g) Body does NOT contain .env secrets`
    );

    // Also try unencoded variant
    const res2 = await request({ method: 'GET', path: '/level1/../backend/.env' });
    assert(
      res2.status === 403 || res2.status === 404,
      `(g) Unencoded traversal /level1/../backend/.env → status = ${res2.status} (expect 403/404)`
    );
    assert(
      res2.body && !res2.body.includes('DB_PASSWORD'),
      `(g) Unencoded traversal: no .env secrets leaked`
    );
  }

  // ── Summary ───────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   RESULTS                                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  📊 Total:  ${passed + failed}\n`);

  if (failed === 0) {
    console.log('🎉 ALL TESTS PASSED! Phase 4 implementation is correct.\n');
    process.exit(0);
  } else {
    console.log('⚠️  SOME TESTS FAILED — please review and fix.\n');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('\n💥 Test script crashed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
