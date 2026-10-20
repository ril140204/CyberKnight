'use strict';
/**
 * backend/scripts/test-static-block.js
 *
 * Kiểm tra middleware hard-deny static file và whitelist public assets.
 * Chạy: node backend/scripts/test-static-block.js
 *
 * Yêu cầu: server phải đang chạy tại PORT trong .env hoặc mặc định 5000.
 * Không cần DB — chỉ dùng HTTP requests.
 */

const http = require('http');

// ── Config ─────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '5000', 10);
const BASE = `http://localhost:${PORT}`;
const TIMEOUT_MS = 5000;

// ── Test Cases ─────────────────────────────────────────────────
const tests = [
  {
    name: 'GET /backend/.env → 403/404',
    url: `${BASE}/backend/.env`,
    expectStatus: [403, 404],
    description: 'Hard-deny .env trong backend/',
  },
  {
    name: 'GET /backend/src/server.js → 403/404',
    url: `${BASE}/backend/src/server.js`,
    expectStatus: [403, 404],
    description: 'Hard-deny source file trong backend/src/',
  },
  {
    name: 'GET /backend/database.sql → 403/404',
    url: `${BASE}/backend/database.sql`,
    expectStatus: [403, 404],
    description: 'Hard-deny .sql file tại root',
  },
  {
    name: 'GET /.claude/settings.json → 403/404',
    url: `${BASE}/.claude/settings.json`,
    expectStatus: [403, 404],
    description: 'Hard-deny hidden dot-folder',
  },
  {
    name: 'GET /.cursor/debug.log → 403/404',
    url: `${BASE}/.cursor/debug.log`,
    expectStatus: [403, 404],
    description: 'Hard-deny dot-folder log file',
  },
  {
    name: 'GET /node_modules/.package-lock.json → 403/404',
    url: `${BASE}/node_modules/.package-lock.json`,
    expectStatus: [403, 404],
    description: 'Hard-deny node_modules access',
  },
  {
    name: 'GET /assets/quests.json → 200 (WHITELISTED)',
    url: `${BASE}/assets/quests.json`,
    expectStatus: [200],
    description: 'assets/quests.json được phép (game sử dụng)',
  },
  {
    name: 'GET /assets/something.json → 403 (NOT whitelisted)',
    url: `${BASE}/assets/something.json`,
    expectStatus: [403, 404],
    description: 'JSON ngoài whitelist phải bị chặn (strict policy)',
  },
  {
    name: 'GET /index.html → 200',
    url: `${BASE}/index.html`,
    expectStatus: [200],
    description: 'index.html gốc được phục vụ',
  },
  {
    name: 'GET /level0/level0.html → 200',
    url: `${BASE}/level0/level0.html`,
    expectStatus: [200],
    description: 'level0 miễn phí (public)',
  },
  {
    name: 'GET /assets/map_bg.png → 200',
    url: `${BASE}/assets/map_bg.png`,
    expectStatus: [200],
    description: 'asset hình ảnh trong /assets',
  },
  {
    name: 'GET /api/health → 200 (API still works)',
    url: `${BASE}/api/health`,
    expectStatus: [200],
    description: 'Health check endpoint hoạt động',
  },
];

// ── HTTP Helper ────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: TIMEOUT_MS }, (res) => {
      resolve(res.statusCode);
    });
    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// ── Run Tests ───────────────────────────────────────────────────
async function run() {
  console.log('\n===================================================');
  console.log('🔒  PHASE 1 — Static File Block & Whitelist Tests');
  console.log(`📡  Testing against: http://localhost:${PORT}`);
  console.log('===================================================\n');

  const results = [];
  let passCount = 0;
  let failCount = 0;

  for (const test of tests) {
    let status;
    let passed = false;
    let errorMsg = '';

    try {
      status = await httpGet(test.url);
      passed = test.expectStatus.includes(status);
    } catch (err) {
      errorMsg = err.message;
      passed = false;
    }

    const icon = passed ? '✅' : '❌';
    const statusStr = status ? `${status}` : errorMsg;

    console.log(`${icon}  ${test.name}`);
    console.log(`    Mô tả : ${test.description}`);
    console.log(`    Kết quả: ${statusStr} (mong đợi: ${test.expectStatus.join(' hoặc ')})`);
    console.log();

    results.push({ ...test, status, passed });
    if (passed) {
      passCount++;
    } else {
      failCount++;
    }
  }

  console.log('===================================================');
  console.log(`📊  Kết quả: ${passCount} passed, ${failCount} failed`);
  console.log('===================================================\n');

  if (failCount > 0) {
    console.log('❌ Một số test thất bại. Kiểm tra lại middleware trong server.js');
    process.exit(1);
  } else {
    console.log('✅ Tất cả test đều pass! Middleware hoạt động đúng.');
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('❌ Lỗi khi chạy test script:', err.message);
  console.error('💡 Đảm bảo server đang chạy: cd backend && npm run dev');
  process.exit(1);
});
