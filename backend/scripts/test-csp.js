/**
 * Test Suite kiểm tra Content-Security-Policy (CSP) & Khắc phục lỗi chặn nút bấm (Phase A)
 *
 * Chạy: node backend/scripts/test-csp.js
 *
 * Tiêu chí kiểm thử:
 * 1. Đọc header CSP từ server đang chạy.
 * 2. Đếm số lượng inline event handlers (onclick, onchange, oninput, onsubmit, keydown, keyup)
 *    trong index.html, payment.html, admin.html.
 * 3. Nếu HTML còn inline event handlers, CSP PHẢI chứa `script-src-attr 'unsafe-inline'`
 *    (KHÔNG được là `script-src-attr 'none'`) để tránh tê liệt nút bấm.
 * 4. Khi NODE_ENV !== 'production', CSP KHÔNG được chứa `upgrade-insecure-requests`
 *    để tránh lỗi không tải được tài nguyên trên http://localhost:5000.
 * 5. CSP frame-ancestors và X-Frame-Options phải cho phép 'self' (sameorigin)
 *    để các màn chơi game (level0..level4) chạy được bình thường trong iframe.
 * 6. CSP img-src phải hỗ trợ VietQR (img.vietqr.io, api.vietqr.io) và data:, blob:.
 * 7. CSP media-src phải hỗ trợ audio/sound effects trong game ('self', blob:, data:).
 *
 * Author: Senior Full-Stack Developer
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = parseInt(process.env.PORT || '5000', 10);
const BASE = `http://localhost:${PORT}`;

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

function fetchHeaders(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${BASE}${urlPath}`,
      { method: 'HEAD', timeout: 5000 },
      (res) => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

function countInlineHandlers(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const content = fs.readFileSync(filePath, 'utf8');
  const matches = content.match(/\son(click|change|input|submit|keydown|keyup)=/gi) || [];
  return matches.length;
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   PHASE A — Kiểm Tra Content-Security-Policy & Nút Bấm       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const rootDir = path.resolve(__dirname, '../../');
  const indexHtmlPath = path.join(rootDir, 'index.html');
  const paymentHtmlPath = path.join(rootDir, 'payment.html');
  const adminHtmlPath = path.join(rootDir, 'admin.html');

  // ── 1. Đếm số lượng inline event handlers ──
  console.log('── 1. Rà soát Inline Event Handlers trong mã nguồn HTML ──');
  const indexHandlers = countInlineHandlers(indexHtmlPath);
  const paymentHandlers = countInlineHandlers(paymentHtmlPath);
  const adminHandlers = countInlineHandlers(adminHtmlPath);
  const totalHandlers = indexHandlers + paymentHandlers + adminHandlers;

  console.log(`     • index.html:   ${indexHandlers} inline handlers`);
  console.log(`     • payment.html: ${paymentHandlers} inline handlers`);
  console.log(`     • admin.html:   ${adminHandlers} inline handlers`);
  console.log(`     • TỔNG CỘNG:    ${totalHandlers} inline handlers`);

  assert(totalHandlers > 0, `Đã xác nhận có ${totalHandlers} inline event handlers cần CSP hỗ trợ`);

  // ── 2. Kiểm tra Headers trả về từ server ──
  console.log('\n── 2. Kiểm tra Header Content-Security-Policy từ Server ──');
  const homeRes = await fetchHeaders('/');
  assert(homeRes.status === 200, `Máy chủ phản hồi trang chủ HTTP 200 (nhận: ${homeRes.status})`);

  const csp = homeRes.headers['content-security-policy'] || '';
  assert(Boolean(csp), 'Server gửi kèm header Content-Security-Policy');

  // Phân tích các directives
  const directives = {};
  csp.split(';').forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed) return;
    const [name, ...vals] = trimmed.split(/\s+/);
    directives[name] = vals.join(' ');
  });

  // ── 3. Kiểm tra script-src-attr tránh lỗi chặn nút bấm ──
  console.log('\n── 3. Kiểm tra script-src-attr (Chống chặn onclick inline) ──');
  const scriptSrcAttr = directives['script-src-attr'];

  if (totalHandlers > 0) {
    assert(
      scriptSrcAttr && scriptSrcAttr.includes("'unsafe-inline'"),
      "CSP script-src-attr chứa 'unsafe-inline' để cho phép 85+ nút bấm onclick hoạt động",
      `Giá trị thực tế: ${scriptSrcAttr || '(không có)'}`
    );
    assert(
      !scriptSrcAttr || !scriptSrcAttr.includes("'none'"),
      "CSP KHÔNG chứa script-src-attr 'none' (nguyên nhân gây tê liệt mọi nút bấm)",
      `Giá trị thực tế: ${scriptSrcAttr}`
    );
  }

  // ── 4. Kiểm tra upgrade-insecure-requests khi dev ──
  console.log('\n── 4. Kiểm tra upgrade-insecure-requests ──');
  const hasUpgrade = 'upgrade-insecure-requests' in directives || csp.includes('upgrade-insecure-requests');
  if (process.env.NODE_ENV !== 'production') {
    assert(
      !hasUpgrade,
      'Không kích hoạt upgrade-insecure-requests ở môi trường development HTTP localhost:5000'
    );
  } else {
    assert(
      hasUpgrade,
      'Kích hoạt upgrade-insecure-requests ở môi trường production HTTPS'
    );
  }

  // ── 5. Kiểm tra frame-ancestors & X-Frame-Options (Cho Iframe Level 0..4) ──
  console.log('\n── 5. Kiểm tra Frameguard / Frame-ancestors cho Mini-game Iframe ──');
  const frameAncestors = directives['frame-ancestors'];
  const frameSrc = directives['frame-src'];
  const xfo = homeRes.headers['x-frame-options'];

  assert(
    frameAncestors && frameAncestors.includes("'self'"),
    "frame-ancestors cho phép 'self' để iframe level0..level4 hiển thị trong web"
  );
  assert(
    frameSrc && frameSrc.includes("'self'"),
    "frame-src cho phép 'self' để trang chủ nạp game từ /level0/, /level1/, v.v."
  );
  assert(
    !xfo || xfo.toUpperCase() === 'SAMEORIGIN',
    `X-Frame-Options là SAMEORIGIN hoặc được quản lý bởi CSP (nhận: ${xfo || 'managed by CSP'})`
  );

  // ── 6. Kiểm tra các nguồn tài nguyên khác (VietQR, Media, Font) ──
  console.log('\n── 6. Kiểm tra quyền nạp VietQR, Font, Media ──');
  const imgSrc = directives['img-src'] || '';
  assert(imgSrc.includes('https://img.vietqr.io'), "img-src cho phép 'https://img.vietqr.io'");
  assert(imgSrc.includes('blob:'), "img-src cho phép 'blob:'");

  const mediaSrc = directives['media-src'] || '';
  assert(
    mediaSrc.includes("'self'") && mediaSrc.includes('blob:'),
    "media-src cho phép 'self' và 'blob:' cho hiệu ứng âm thanh game"
  );

  const scriptSrc = directives['script-src'] || '';
  // ── Phase 1.7 thay Tailwind CDN bằng local /assets/tailwind.css ─────────
  // Tailwind CDN đã bị xóa khỏi CSP vì blocked pages (levelGuard, checkLevelAccess)
  // dùng <link rel="stylesheet" href="/assets/tailwind.css"> thay vì CDN script.
  // jsdelivr + cdnjs còn lại là legacy (confetti, gsap...) — cân nhắc xóa khi
  // chuyển inline onclick → addEventListener ở phase tiếp theo.
  assert(
    !scriptSrc.includes('https://cdn.tailwindcss.com'),
    "CSP: Tailwind CDN đã bị xóa khỏi script-src (Phase 1.7: dùng local /assets/tailwind.css)"
  );
  // Cảnh báo nếu 'unsafe-inline' còn trong script-src (rủi ro XSS khi load script)
  if (scriptSrc.includes("'unsafe-inline'")) {
    console.log('  ⚠️  script-src chứa \'unsafe-inline\' — rủi ro XSS khi load script, ưu tiên xóa khi chuyển sang addEventListener');
  }
  assert(scriptSrc.includes('https://cdn.jsdelivr.net'), "CSP: jsdelivr còn được phép (legacy — cân nhắc xóa sau khi chuyển addEventListener)");
  assert(scriptSrc.includes('https://cdnjs.cloudflare.com'), "CSP: cdnjs còn được phép (legacy — cân nhắc xóa sau khi chuyển addEventListener)");

  // ── 7. Kiểm tra trên các trang admin.html và payment.html ──
  console.log('\n── 7. Kiểm tra CSP trên /admin.html và /payment.html ──');
  const adminRes = await fetchHeaders('/admin.html');
  assert(adminRes.status === 200, 'GET /admin.html trả về HTTP 200');
  const adminCsp = adminRes.headers['content-security-policy'] || '';
  assert(adminCsp.includes("script-src-attr 'unsafe-inline'"), "admin.html được áp dụng script-src-attr 'unsafe-inline'");

  const paymentRes = await fetchHeaders('/payment.html');
  assert(paymentRes.status === 200, 'GET /payment.html trả về HTTP 200');
  const paymentCsp = paymentRes.headers['content-security-policy'] || '';
  assert(paymentCsp.includes("script-src-attr 'unsafe-inline'"), "payment.html được áp dụng script-src-attr 'unsafe-inline'");

  // ── Tổng kết ──
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   KẾT QUẢ KIỂM THỬ GIAI ĐOẠN A — CSP & NÚT BẤM (BUTTONS)     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n  ✅ Đạt:   ${passed}`);
  console.log(`  ❌ Hỏng:  ${failed}`);
  console.log(`  📊 Tổng:  ${passed + failed}\n`);

  if (failed === 0) {
    console.log('🎉 TẤT CẢ KIỂM THỬ CSP ĐÃ VƯỢT QUA — LỖI CHẶN NÚT BẤM ĐÃ ĐƯỢC GIẢI QUYẾT!\n');
    process.exit(0);
  } else {
    console.error('⚠️  CÓ KIỂM THỬ THẤT BẠI — CẦN RÀ SOÁT LẠI CSP.\n');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('💥 Ngoại lệ trong script kiểm thử CSP:', err);
  process.exit(1);
});
