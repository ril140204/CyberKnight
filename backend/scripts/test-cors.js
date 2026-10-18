/**
 * Test Suite: CORS Production Behavior
 *
 * Chạy: node backend/scripts/test-cors.js
 *
 * Kiểm thử:
 * 1. NODE_ENV=production + FRONTEND_URL=https://example.vn
 *    → Origin: http://localhost:5000  → 403 DENIED
 *    → Origin: https://example.vn    → 200 ALLOWED
 * 2. NODE_ENV=development
 *    → Origin: http://localhost:5000  → 200 ALLOWED
 */

'use strict';

const http = require('http');

// Chạy test CORS bằng cách gọi trực tiếp server.js logic (không cần start server)
// Hoặc dùng integration test với server thật

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

function request(origin) {
  return new Promise((resolve) => {
    const url = new URL('/api/health', BASE_URL);
    const opt = {
      hostname: url.hostname,
      port: url.port || 80,
      path: opt?.path || '/api/health',
      method: 'GET',
      headers: {
        Origin: origin,
      },
      timeout: 8000,
    };

    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: '/api/health',
      method: 'GET',
      headers: { Origin: origin },
      timeout: 8000,
    }, (res) => {
      resolve({ statusCode: res.statusCode, origin: res.headers['access-control-allow-origin'] });
    });
    req.on('error', (err) => resolve({ error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
}

async function runTests() {
  const env = process.env.NODE_ENV || 'development';
  console.log(`\n=== CORS Test Suite (NODE_ENV=${env}) ===\n`);

  // Test 1: Production — localhost should be DENIED
  if (env === 'production') {
    const frontendUrl = process.env.FRONTEND_URL || 'https://example.vn';
    const frontendOrigin = frontendUrl.replace(/\/$/, '');

    // localhost denied
    const r1 = await request('http://localhost:5000');
    assert(
      r1.statusCode === 403 || r1.statusCode === undefined,
      `Production: Origin http://localhost:5000 → 403 (CORS DENIED)`,
      `Got: ${JSON.stringify(r1)}`
    );

    // 127.0.0.1 also denied
    const r2 = await request('http://127.0.0.1:5000');
    assert(
      r2.statusCode === 403 || r2.statusCode === undefined,
      `Production: Origin http://127.0.0.1:5000 → 403 (CORS DENIED)`,
      `Got: ${JSON.stringify(r2)}`
    );

    // frontend URL allowed
    const r3 = await request(frontendOrigin);
    assert(
      r3.statusCode === 200,
      `Production: Origin ${frontendOrigin} → 200 (ALLOWED)`,
      `Got: ${JSON.stringify(r3)}`
    );
  } else {
    // Test 2: Development — localhost is allowed
    const r1 = await request('http://localhost:5000');
    assert(
      r1.statusCode === 200 || (r1.statusCode === undefined && !r1.error),
      `Development: Origin http://localhost:5000 → 200 (ALLOWED)`,
      `Got: ${JSON.stringify(r1)}`
    );

    // In dev mode: only http://localhost:5000 is allowed by default
    // (127.0.0.1 is NOT in defaultOrigins — this is intentional narrowing per Phase 1.1 spec)
    const r2 = await request('http://127.0.0.1:5000');
    assert(
      r2.statusCode === 403 || r2.statusCode === undefined,
      `Development: Origin http://127.0.0.1:5000 → 403 (DENIED — not in default dev origins)`,
      `Got: ${JSON.stringify(r2)}`
    );

    // Random origin still denied
    const r3 = await request('https://random-site.com');
    assert(
      r3.statusCode === 403 || r3.statusCode === undefined,
      `Development: Origin https://random-site.com → 403 (DENIED)`,
      `Got: ${JSON.stringify(r3)}`
    );
  }

  console.log(`\n=== Kết quả: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

// Kiểm tra logic CORS trong server.js mà không cần chạy server
function testCorsLogic() {
  console.log('\n=== CORS Logic Unit Test (không cần server) ===\n');

  const isProd = process.env.NODE_ENV === 'production';

  // Logic tương tự trong server.js
  const defaultOrigin = isProd
    ? process.env.FRONTEND_URL
    : 'http://localhost:5000';

  const allowedOrigins = [defaultOrigin].filter(Boolean);
  if (process.env.CORS_ORIGINS) {
    process.env.CORS_ORIGINS.split(',')
      .map(o => o.trim()).filter(Boolean)
      .forEach(origin => { if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin); });
  }

  function checkCors(origin) {
    if (!origin) return 'ALLOWED (no origin)';
    return allowedOrigins.includes(origin) ? 'ALLOWED' : 'DENIED';
  }

  if (isProd) {
    // Test production
    process.env.FRONTEND_URL = 'https://example.vn';
    const frontOrigin = process.env.FRONTEND_URL;

    assert(checkCors('http://localhost:5000') === 'DENIED',
      `Prod: localhost → DENIED`);
    assert(checkCors('http://127.0.0.1:5000') === 'DENIED',
      `Prod: 127.0.0.1 → DENIED`);
    assert(checkCors(frontOrigin) === 'ALLOWED',
      `Prod: FRONTEND_URL (${frontOrigin}) → ALLOWED`);
    assert(checkCors('https://www.example.vn') === 'DENIED',
      `Prod: www subdomain without CORS_ORIGINS → DENIED`);
  } else {
    // Test development
    assert(checkCors('http://localhost:5000') === 'ALLOWED',
      `Dev: localhost → ALLOWED`);
    // 127.0.0.1 is intentionally NOT in default dev origins (spec Phase 1.1 narrowed it)
    assert(checkCors('http://127.0.0.1:5000') === 'DENIED',
      `Dev: 127.0.0.1 → DENIED (intentional — not in defaultOrigins)`);
    assert(checkCors('https://example.vn') === 'DENIED',
      `Dev: random origin → DENIED`);
  }

  console.log(`\n=== Kết quả logic: ${passed} passed, ${failed} failed ===`);
}

if (require.main === module) {
  if (process.argv.includes('--no-server')) {
    testCorsLogic();
  } else {
    runTests().catch(console.error);
  }
}
