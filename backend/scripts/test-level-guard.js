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
 * (e) Tampered cookie signature → 403
 * (f) /level0/level0.html → 200, no login required
 * (g) /level1/..%2f..%2fbackend/.env → NOT leak .env (403/404, no .env content)
 *
 * Prerequisites:
 *   - MySQL running with sigmabloom DB created (npm run setup-db)
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

async function grantPack14ToUser(userEmail) {
  // Grant pack_1_4 directly via DB — bypasses admin API complexity for tests
  try {
    const [rows] = await db.query('SELECT id FROM users WHERE email = ?', [userEmail]);
    if (rows.length === 0) {
      throw new Error(`User ${userEmail} not found`);
    }
    const userId = rows[0].id;

    await db.query(
      `INSERT INTO user_entitlements (user_id, package_id, source, granted_at)
       VALUES (?, 'pack_1_4', 'admin_grant', NOW())
       ON DUPLICATE KEY UPDATE source = 'admin_grant', granted_at = NOW()`,
      [userId]
    );

    console.log(`  ✅ Granted pack_1_4 to ${userEmail} (uid=${userId})`);
    return userId;
  } catch (err) {
    throw new Error('Cannot grant pack_1_4: ' + err.message);
  }
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
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE username IN (?, ?, ?, ?) OR email LIKE ?',
      ['admin', 'test_nopack', 'test_pack14', 'test_nopack_a', '%test_%@sigmabloom.vn']
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
    assert(
      level1Html.headers['cache-control'] && level1Html.headers['cache-control'].includes('no-store'),
      `(c) Cache-Control: private, no-store on level file (got: ${level1Html.headers['cache-control']})`
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

  // ── Test (d2): Level chưa phát hành (6) → 404 ────────────────
  console.log('\n── TEST (d2): GET /level6/level6.html (chưa phát hành) ──');
  {
    const res = await request({
      method: 'GET',
      path: '/level6/level6.html',
    });

    assert(
      res.status === 404,
      `(d2) GET /level6/level6.html status = ${res.status} (expect 404 — level6 not in catalog)`
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
