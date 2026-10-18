'use strict';
/**
 * backend/scripts/test-xss.js
 *
 * Kiểm tra toàn diện phòng vệ Stored XSS & DOM XSS (Phase 2):
 * 1. Unit test hàm escapeHtml và isAllowedQrUrl trong assets/safe.js.
 * 2. Static Analysis: Quét admin.html, payment.html, index.html để đảm bảo
 *    không có biến nhạy cảm nào được render vào innerHTML mà chưa qua escapeHtml.
 * 3. Kiểm tra thuộc tính rel="noopener noreferrer" trên toàn bộ thẻ target="_blank".
 * 4. API Validation: Gửi payload XSS vào POST /api/auth/register và POST /api/feedback
 *    để xác nhận backend từ chối với mã 400.
 *
 * Chạy: node backend/scripts/test-xss.js
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// Nạp module safe.js
const safePath = path.resolve(__dirname, '../../assets/safe.js');
let CyberSafe;
try {
  CyberSafe = require(safePath);
} catch (err) {
  console.error('❌ Không thể nạp assets/safe.js:', err.message);
  process.exit(1);
}

const { escapeHtml, isAllowedQrUrl } = CyberSafe;

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}${details ? ' — ' + details : ''}`);
    failed++;
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('🛡️  BẮT ĐẦU KIỂM TRA PHÒNG VỆ STORED XSS (PHASE 2)');
  console.log('====================================================\n');

  // ── 1. Unit Test: escapeHtml ──────────────────────────────────
  console.log('--- 1. Kiểm thử Unit Test hàm escapeHtml() ---');

  assert(escapeHtml(null) === '', 'escapeHtml(null) trả về chuỗi rỗng');
  assert(escapeHtml(undefined) === '', 'escapeHtml(undefined) trả về chuỗi rỗng');
  assert(escapeHtml(123) === '123', 'escapeHtml(123) ép kiểu chuỗi đúng');
  assert(escapeHtml(0) === '0', 'escapeHtml(0) không bị nhầm thành falsy rỗng');

  const payloadScript = '<script>alert("xss")</script>';
  const escapedScript = escapeHtml(payloadScript);
  assert(
    !escapedScript.includes('<') && !escapedScript.includes('>') && escapedScript.includes('&lt;script&gt;'),
    'Escape thẻ <script> thành công',
    escapedScript
  );

  const payloadAttr = '"><img src=x onerror=alert(1)>';
  const escapedAttr = escapeHtml(payloadAttr);
  assert(
    escapedAttr === '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;',
    'Escape payload phá vỡ thuộc tính HTML thành công',
    escapedAttr
  );

  const payloadSpecial = 'A & B "C" \'D\' `E`';
  const escapedSpecial = escapeHtml(payloadSpecial);
  assert(
    escapedSpecial === 'A &amp; B &quot;C&quot; &#39;D&#39; &#96;E&#96;',
    'Escape đầy đủ 6 ký tự nguy hiểm (&, <, >, ", \', `)',
    escapedSpecial
  );

  // ── 2. Unit Test: isAllowedQrUrl ──────────────────────────────
  console.log('\n--- 2. Kiểm thử Unit Test hàm isAllowedQrUrl() ---');

  assert(
    isAllowedQrUrl('https://img.vietqr.io/image/970436-123456-compact.png'),
    'Chấp nhận URL HTTPS từ img.vietqr.io'
  );
  assert(
    isAllowedQrUrl('https://api.vietqr.io/v2/generate'),
    'Chấp nhận URL HTTPS từ api.vietqr.io'
  );
  assert(
    !isAllowedQrUrl('http://img.vietqr.io/image/test.png'),
    'Từ chối URL HTTP không có SSL/TLS'
  );
  assert(
    !isAllowedQrUrl('https://evil-attacker.com/malicious.png'),
    'Từ chối domain ngoài whitelist VietQR'
  );
  assert(
    !isAllowedQrUrl('javascript:alert(1)'),
    'Từ chối URI scheme javascript:'
  );
  assert(
    !isAllowedQrUrl('data:image/svg+xml;utf8,<svg onload=alert(1)>'),
    'Từ chối URI scheme data:'
  );

  // ── 3. Static Audit: admin.html ───────────────────────────────
  console.log('\n--- 3. Static Code Audit: admin.html ---');
  const adminHtmlPath = path.resolve(__dirname, '../../admin.html');
  const adminHtml = fs.readFileSync(adminHtmlPath, 'utf8');

  // Kiểm tra loadOrders
  const unescapedOrders = adminHtml.match(/\$\{o\.(orderCode|username|userEmail|packageId)\}/g);
  assert(!unescapedOrders, 'Không còn biến đơn hàng thô ${o...} chưa escape trong admin.html', unescapedOrders?.join(', '));

  // Kiểm tra loadTransactions
  const unescapedTx = adminHtml.match(/\$\{t\.(providerTxId|content|orderCode|matchStatus)\}/g);
  assert(!unescapedTx, 'Không còn biến giao dịch thô ${t...} chưa escape trong admin.html', unescapedTx?.join(', '));

  // Kiểm tra loadUsers
  const unescapedUsers = adminHtml.match(/\$\{u\.(username|email|role)\}/g);
  assert(!unescapedUsers, 'Không còn biến người dùng thô ${u...} chưa escape trong admin.html', unescapedUsers?.join(', '));

  // Kiểm tra meta robots
  assert(
    adminHtml.includes('<meta name="robots" content="noindex,nofollow">'),
    'admin.html có meta tag noindex,nofollow'
  );

  // ── 4. Static Audit: payment.html & index.html ─────────────────
  console.log('\n--- 4. Static Code Audit: payment.html & index.html ---');
  const paymentHtmlPath = path.resolve(__dirname, '../../payment.html');
  const paymentHtml = fs.readFileSync(paymentHtmlPath, 'utf8');

  assert(
    paymentHtml.includes('escapeHtml(qrContent)') &&
    paymentHtml.includes('escapeHtml(data.qr.accountNumber)') &&
    paymentHtml.includes('escapeHtml(pkg.name)'),
    'payment.html đã bọc escapeHtml cho các trường động'
  );

  const indexHtmlPath = path.resolve(__dirname, '../../index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  assert(
    indexHtml.includes('escapeHtml(packageNames[p] || p)') &&
    indexHtml.includes('escapeHtml(levelName)') &&
    indexHtml.includes('safeOrderCode'),
    'index.html đã bọc escapeHtml cho các trường động'
  );

  // Kiểm tra rel="noopener noreferrer" trên target="_blank"
  const blankRegex = /<a\s+[^>]*target=["']_blank["'][^>]*>/gi;
  const adminBlanks = adminHtml.match(blankRegex) || [];
  const paymentBlanks = paymentHtml.match(blankRegex) || [];
  const indexBlanks = indexHtml.match(blankRegex) || [];

  const allBlanks = [...adminBlanks, ...paymentBlanks, ...indexBlanks];
  const missingRel = allBlanks.filter(tag => !/rel=["'][^"']*noopener[^"']*["']/i.test(tag));

  assert(
    missingRel.length === 0,
    'Tất cả liên kết target="_blank" đều có rel="noopener noreferrer"',
    missingRel.join(' | ')
  );

  // ── 5. API Backend Validation Test (HTTP) ─────────────────────
  console.log('\n--- 5. Kiểm thử Backend Validation chặn payload XSS ---');
  const PORT = parseInt(process.env.PORT || '5000', 10);

  async function checkApiOnline() {
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:${PORT}/api/health`, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1500, () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  const isOnline = await checkApiOnline();
  if (!isOnline) {
    console.log(`  ℹ️  Server trên cổng ${PORT} chưa chạy, bỏ qua kiểm thử HTTP live.`);
  } else {
    // Test 5.1: Đăng ký với username chứa XSS
    const registerPayload = JSON.stringify({
      firstName: 'Nguyen',
      lastName: 'Van A',
      username: '"><img src=x onerror=alert(1)>',
      email: 'xss_test_user@example.com',
      password: 'SecurePass123@',
      confirmPassword: 'SecurePass123@',
      birthYear: 2012,
    });

    const regResult = await new Promise((resolve) => {
      const req = http.request(
        `http://localhost:${PORT}/api/auth/register`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(registerPayload),
          },
        },
        (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve({ status: res.statusCode, body }));
        }
      );
      req.on('error', (e) => resolve({ status: 500, error: e.message }));
      req.write(registerPayload);
      req.end();
    });

    assert(
      regResult.status === 400,
      'POST /api/auth/register chặn username chứa payload XSS (HTTP 400)',
      `Status: ${regResult.status}`
    );

    // Test 5.2: Đăng ký với firstName chứa thẻ HTML <script>
    const nameXssPayload = JSON.stringify({
      firstName: '<script>alert(1)</script>',
      lastName: 'Hacker',
      username: 'normal_user_99',
      email: 'xss_name_test@example.com',
      password: 'SecurePass123@',
      confirmPassword: 'SecurePass123@',
      birthYear: 2012,
    });

    const nameResult = await new Promise((resolve) => {
      const req = http.request(
        `http://localhost:${PORT}/api/auth/register`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(nameXssPayload),
          },
        },
        (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve({ status: res.statusCode, body }));
        }
      );
      req.on('error', (e) => resolve({ status: 500, error: e.message }));
      req.write(nameXssPayload);
      req.end();
    });

    assert(
      nameResult.status === 400,
      'POST /api/auth/register chặn firstName chứa thẻ HTML <script> (HTTP 400)',
      `Status: ${nameResult.status}`
    );

    // Test 5.3: Feedback với tên chứa ký tự < >
    const fbPayload = JSON.stringify({
      name: '<img src=x onerror=1>',
      category: 'Góp ý chung',
      message: 'Tin nhắn bình thường kiểm tra feedback',
    });

    const fbResult = await new Promise((resolve) => {
      const req = http.request(
        `http://localhost:${PORT}/api/feedback`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(fbPayload),
          },
        },
        (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve({ status: res.statusCode, body }));
        }
      );
      req.on('error', (e) => resolve({ status: 500, error: e.message }));
      req.write(fbPayload);
      req.end();
    });

    assert(
      fbResult.status === 400,
      'POST /api/feedback chặn họ tên chứa ký tự < > (HTTP 400)',
      `Status: ${fbResult.status}`
    );
  }

  // ── Tổng kết ──────────────────────────────────────────────────
  console.log('\n====================================================');
  console.log(`KẾT QUẢ: ${passed} PASS, ${failed} FAIL`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Lỗi thực thi kiểm thử:', err);
  process.exit(1);
});
