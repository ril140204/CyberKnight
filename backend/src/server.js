/**
 * CyberKnight Main Server — Sigmabloom Platform
 *
 * Tiêu chuẩn bảo mật (Phase A & B):
 * - Content-Security-Policy không chặn inline handlers và hỗ trợ an toàn mọi thành phần
 * - Startup fail-fast trong production (kiểm tra toàn diện secrets, DB, banking, URLs)
 * - Level Guard Fail-Closed (503 Service Unavailable khi DB lỗi, tuyệt đối không fail-open)
 * - Canonical path & strict path traversal protection cho /levelN/
 * - Cache quyền chơi level tập trung (<= 60s) với cơ chế xóa cache tức thì
 * - X-Robots-Tag: noindex, nofollow cho /admin* và /payment*
 *
 * Author: Senior Full-Stack Developer
 */

'use strict';

// ── CyberKnight Main Server (Phase A & B Active) ─────────────
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');

// ── Cấu hình dotenv nạp .env từ đúng thư mục backend ────────────
const envPath = fs.existsSync(path.join(__dirname, '../.env'))
  ? path.join(__dirname, '../.env')
  : path.join(__dirname, '../../.env');
require('dotenv').config({ path: envPath });

// ── Fail-Fast Startup Validation ────────────────────────────────
const { validateStartupConfig } = require('./config/startupCheck');
validateStartupConfig();

// ── Unhandled Error Listeners ───────────────────────────────────
// Đếm rejection để phát hiện rejection storm (10/min → exit để PM2 restart)
const rejectionCounter = { count: 0, windowMs: 60_000 };
process.on('unhandledRejection', (reason) => {
  console.error('💥 [Server] Unhandled Rejection:', reason);
  const now = Date.now();
  if (!rejectionCounter.lastReset || now - rejectionCounter.lastReset > rejectionCounter.windowMs) {
    rejectionCounter.count = 1;
    rejectionCounter.lastReset = now;
  } else {
    rejectionCounter.count++;
  }
  if (rejectionCounter.count >= 10) {
    console.error('💥 [Server] Too many unhandled rejections in 1 minute — exiting to let PM2 restart');
    process.exit(1);
  }
});
process.on('uncaughtException', (err) => {
  console.error('💥 [Server] Uncaught Exception:', err);
  process.exit(1); // Let PM2 restart the process
});

const db = require('./config/db');
const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/game');
const feedbackRoutes = require('./routes/feedback');
const catalogRoutes = require('./routes/catalog');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const myEntitlementsRoutes = require('./routes/myEntitlements');
const activityRoutes = require('./routes/activity');
const levelRoutes = require('./routes/levels');
const privacyRoutes = require('./routes/privacy');
const errorHandler = require('./middleware/errorHandler');
const { getPlayableLevelsCached } = require('./utils/entitlementCache');
const { startOrderCleanupJob } = require('./controllers/paymentController');

// Khởi chạy job dọn đơn hết hạn (có thể tắt bằng DISABLE_ORDER_CLEANUP_JOB=true)
if (process.env.DISABLE_ORDER_CLEANUP_JOB !== 'true') {
  startOrderCleanupJob();
}

// Helpers catalog cho Level Guard
const {
  levelExists,
  getLevelById,
  getPackages,
  getRequiredPackagesForLevel,
  FREE_LEVELS,
} = require('./config/catalog');

const app = express();
const PORT = Number.parseInt(process.env.PORT || '5000', 10);

app.set('trust proxy', 1);

// ── 1. Helmet Security Headers ────────────────────────────────
const isProd = process.env.NODE_ENV === 'production';
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://cdn.jsdelivr.net',
          'https://cdnjs.cloudflare.com',
        ],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://fonts.googleapis.com',
        ],
        fontSrc: [
          "'self'",
          'https://fonts.gstatic.com',
          'data:',
        ],
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://img.vietqr.io',
          'https://api.vietqr.io',
        ],
        mediaSrc: ["'self'", 'blob:', 'data:'],
        workerSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        frameSrc: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        ...(isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    frameguard: { action: 'sameorigin' }, // Cho phép iframe cùng origin
    // HSTS: chỉ bật ở production (khi đã có HTTPS)
    strictTransportSecurity: isProd
      ? { maxAge: 15552000, includeSubDomains: true }
      : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);

// ── Permissions-Policy: tắt camera/mic/geolocation (game không cần) ──
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ── 2. Body parsers ───────────────────────────────────────────
// Cấu hình riêng 200kb cho /api/game (lưu tiến độ game lớn/ảnh), 10kb cho các route khác
app.use('/api/game', express.json({ limit: '200kb' }));
app.use('/api/game', express.urlencoded({ extended: true, limit: '200kb' }));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ── 3. Cookie parser ─────────────────────────────────────────
app.use(cookieParser());

// ── 4. CORS ──────────────────────────────────────────────────
// isProd đã được khai báo ở Helmet block phía trên
const defaultOrigin = isProd
  ? process.env.FRONTEND_URL // production: phải có FRONTEND_URL=https://...
  : 'http://localhost:5000'; // development: cho localhost mặc định

const allowedOrigins = [defaultOrigin].filter(Boolean);

if (process.env.CORS_ORIGINS) {
  process.env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .forEach((origin) => {
      if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin);
    });
}

// Chặn origin không hợp lệ với mã 403 thay vì ném lỗi Error (tránh mã 500)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || allowedOrigins.includes(origin)) {
    return next();
  }
  return res.status(403).json({
    success: false,
    error: 'CORS_DENIED',
    message: 'Nguồn truy cập (Origin) không được phép.',
  });
});

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  })
);

// ── 5. Hard-deny sensitive files & SEO Noindex ───────────────
app.use((req, res, next) => {
  // Gắn header X-Robots-Tag cho /admin* và /payment*
  if (req.path.startsWith('/admin') || req.path.startsWith('/payment')) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }

  const path_ = req.path;
  if (/^\/backend|^\/\.|^\/node_modules/.test(path_)) {
    return res.status(403).send('Not found');
  }
  const extMatch = path_.match(/\.[^.]+$/);
  if (extMatch) {
    const ext = extMatch[0];
    const blockedExt = /\.env$|\.sql$|\.log$|\.md$|\.json$/.test(ext);
    const safeJson = ext === '.json' && /^\/assets\/quests\.json$/.test(path_);
    if (blockedExt && !safeJson) return res.status(403).send('Not found');
  }
  next();
});

// ── 6. Static assets (public) ─────────────────────────────────
const rootDir = process.env.EXEWEB_ROOT
  ? path.resolve(process.env.EXEWEB_ROOT)
  : path.join(__dirname, '../../');

for (const mount of [
  { url: '/assets', dir: 'assets' },
  { url: '/image', dir: 'image' },
  { url: '/video', dir: 'video' },
]) {
  const resolved = path.join(rootDir, mount.dir);
  if (fs.existsSync(resolved)) {
    app.use(mount.url, express.static(resolved));
  }
}

// Direct HTML routes
app.get('/index.html', (req, res) => res.sendFile(path.join(rootDir, 'index.html')));
app.get('/reset-password.html', (req, res) => res.sendFile(path.join(rootDir, 'reset-password.html')));
app.get('/payment.html', (req, res) => res.sendFile(path.join(rootDir, 'payment.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(rootDir, 'admin.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(rootDir, 'admin.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(rootDir, 'privacy.html')));
app.get('/privacy.html', (req, res) => res.sendFile(path.join(rootDir, 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(rootDir, 'terms.html')));
app.get('/terms.html', (req, res) => res.sendFile(path.join(rootDir, 'terms.html')));
app.get('/refund', (req, res) => res.sendFile(path.join(rootDir, 'refund.html')));
app.get('/refund.html', (req, res) => res.sendFile(path.join(rootDir, 'refund.html')));

// ── 7. LEVEL GUARD HELPERS (PHASE 4 & PHASE B) ───────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Chuẩn hóa và làm sạch đường dẫn level, chống traversal, null bytes, double slashes
 * @param {string} p
 * @returns {string|null}
 */
function canonicalizeLevelPath(p) {
  let decoded = p;
  try {
    while (decoded.includes('%')) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return null;
  }

  // Chặn null bytes, backslash, hoặc ký tự % còn sót
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.includes('%')) {
    return null;
  }

  // Chặn đường dẫn chứa ..
  const segments = decoded.split('/');
  if (segments.includes('..') || decoded.includes('..')) {
    return null;
  }

  // Gộp multiple slashes
  decoded = decoded.replace(/\/+/g, '/');
  return decoded;
}

function sendBlockedHtml(res, status, heading, bodyText, buttonText, buttonLink, requiredPkgs) {
  let pkgList = '';
  if (requiredPkgs && requiredPkgs.length > 0) {
    const allPkgs = getPackages();
    pkgList = '<br><br>Các gói phù hợp: ' +
      requiredPkgs
        .map((pid) => {
          const p = allPkgs[pid];
          return p ? `<strong>${escapeHtml(p.name)}</strong> (${p.price.toLocaleString('vi-VN')} VNĐ)` : null;
        })
        .filter(Boolean)
        .join(', ') + '.';
  }
  const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)} — CyberKnight</title><link rel="stylesheet" href="/assets/tailwind.css"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet"><style>body{font-family:'Poppins',sans-serif}</style></head><body class="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-950 via-purple-900 to-indigo-950"><div class="bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl p-10 max-w-md w-full mx-4 text-center shadow-2xl"><div class="text-6xl mb-6">🛡️</div><h1 class="text-2xl font-extrabold text-white mb-4">${escapeHtml(heading)}</h1><p class="text-indigo-200 mb-8 leading-relaxed">${bodyText}${pkgList}</p><a href="${buttonLink}" class="inline-block bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-white font-bold px-8 py-3 rounded-full text-lg shadow-lg transition-all duration-200 transform hover:scale-105">${escapeHtml(buttonText)}</a><p class="text-indigo-400 text-sm mt-6"><a href="/" class="hover:text-indigo-200">← Quay về trang chủ</a></p></div></body></html>`;
  return res.status(status).type('text/html').send(html);
}

function sendBlockedJson(res, status, error, message, requiredPkgs) {
  const payload = { success: false, error, message };
  if (status === 403 && requiredPkgs) payload.data = { requiredPackages: requiredPkgs };
  return res.status(status).json(payload);
}

function respondLevelBlocked(req, res, opts) {
  const { status, error, heading, message, buttonText, buttonLink, requiredPkgs } = opts;
  if (req.accepts(['html', 'json']) === 'html') {
    return sendBlockedHtml(res, status, heading, message, buttonText, buttonLink, requiredPkgs);
  }
  return sendBlockedJson(res, status, error, message, requiredPkgs);
}

function serveStaticLevelFile(res, levelId, filePath, levelDir) {
  if (!fs.existsSync(filePath)) {
    const indexPath = path.join(levelDir, `level${levelId}.html`);
    if (fs.existsSync(indexPath)) {
      return res.redirect(`/level${levelId}/level${levelId}.html`);
    }
    return res.status(404).type('text/plain').send('Not found');
  }
  res.set('Cache-Control', 'private, no-store');
  return res.sendFile(filePath);
}

// Bắt mọi biến thể: /levelN/, /levelN, /LEVELN/...
const levelPattern = /^\/level(\d+)(\/.*)?$/i;

// ── LEVEL GUARD MIDDLEWARE ──────────────────────────────────
app.use((req, res, next) => {
  const reqPath = req.path;
  const canonical = canonicalizeLevelPath(reqPath);

  if (canonical === null) {
    if (/^\/level/i.test(reqPath)) {
      return res.status(403).type('text/plain').send('Not found');
    }
    return next();
  }

  const match = levelPattern.exec(canonical);
  if (!match) return next();

  const levelId = Number.parseInt(match[1], 10);
  if (!match[2]) {
    return res.redirect(301, `/level${levelId}/`);
  }

  if (!levelExists(levelId)) {
    return res.status(404).json({ success: false, error: 'LEVEL_NOT_FOUND', message: 'Level không tồn tại.' });
  }

  const levelDir = path.resolve(rootDir, `level${levelId}`);
  const segments = canonical.replace(/^\//, '').split('/').filter(Boolean);
  const filePath = path.resolve(rootDir, ...segments);

  if (!filePath.startsWith(levelDir + path.sep) && filePath !== levelDir) {
    return res.status(403).type('text/plain').send('Not found');
  }

  if (FREE_LEVELS.includes(levelId)) {
    return serveStaticLevelFile(res, levelId, filePath, levelDir);
  }

  const secret = process.env.LEVEL_ACCESS_SECRET;
  if (!secret) {
    console.error('❌ LEVEL_ACCESS_SECRET chưa được cấu hình!');
    return res.status(500).json({ success: false, error: 'SERVER_ERROR', message: 'Lỗi cấu hình máy chủ.' });
  }

  const cookieToken = req.cookies?.levelAccess;
  const level = getLevelById(levelId);
  const title = level ? level.title : `Level ${levelId}`;

  if (!cookieToken) {
    return respondLevelBlocked(req, res, {
      status: 401,
      error: 'UNAUTHORIZED',
      heading: 'Vui lòng đăng nhập',
      message: `Bạn cần đăng nhập để chơi "<strong>${escapeHtml(title)}</strong>".`,
      buttonText: 'Đăng nhập ngay',
      buttonLink: '/index.html',
      requiredPkgs: null,
    });
  }

  let cookieData;
  try {
    cookieData = jwt.verify(cookieToken, secret);
  } catch {
    return respondLevelBlocked(req, res, {
      status: 403,
      error: 'INVALID_TOKEN',
      heading: 'Mã xác thực không hợp lệ',
      message: 'Mã xác thực phiên chơi không hợp lệ. Vui lòng bấm "Chơi" lại từ trang chủ.',
      buttonText: 'Thử lại',
      buttonLink: '/index.html',
      requiredPkgs: null,
    });
  }

  const cookieLevels = Array.isArray(cookieData.levels) ? cookieData.levels : [];
  if (!cookieLevels.includes(levelId)) {
    const requiredPkgs = getRequiredPackagesForLevel(levelId);
    return respondLevelBlocked(req, res, {
      status: 403,
      error: 'LEVEL_LOCKED',
      heading: 'Cần mua gói để tiếp tục',
      message: `Bạn cần mua gói để chơi "<strong>${escapeHtml(title)}</strong>".`,
      buttonText: 'Mua gói ngay',
      buttonLink: '/index.html#packages',
      requiredPkgs,
    });
  }

  // ── Re-check DB entitlement (dùng cache chung <= 60s) ──────
  getPlayableLevelsCached(cookieData.uid)
    .then((playableLevels) => {
      if (!playableLevels.includes(levelId)) {
        const requiredPkgs = getRequiredPackagesForLevel(levelId);
        return respondLevelBlocked(req, res, {
          status: 403,
          error: 'LEVEL_LOCKED',
          heading: 'Quyền truy cập đã bị thu hồi',
          message: 'Quyền truy cập của bạn đã bị thu hồi. Vui lòng mua gói để tiếp tục.',
          buttonText: 'Mua gói ngay',
          buttonLink: '/index.html#packages',
          requiredPkgs,
        });
      }
      return serveStaticLevelFile(res, levelId, filePath, levelDir);
    })
    .catch((err) => {
      // FAIL-CLOSED: Tuyệt đối không phục vụ file game khi lỗi DB
      console.error('❌ Lỗi khi kiểm tra quyền trong level guard (fail-closed 503):', err.message);
      return respondLevelBlocked(req, res, {
        status: 503,
        error: 'SERVICE_UNAVAILABLE',
        heading: 'Hệ thống đang bận',
        message: 'Hệ thống đang bận hoặc gặp sự cố kết nối, vui lòng thử lại sau ít phút.',
        buttonText: 'Quay về trang chủ',
        buttonLink: '/index.html',
        requiredPkgs: null,
      });
    });
});

// ── 8. API Routes ─────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/me/entitlements', myEntitlementsRoutes);
// Theo dõi thời gian online — mount TRƯỚC handler 404 '/api/*' phía dưới
app.use('/api/me/activity', activityRoutes);
app.use('/api/levels', levelRoutes);
app.use('/api/privacy', privacyRoutes);

// ── 9. Health check ──────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: process.env.NODE_ENV || 'development' });
});

// ── 10. 404 for API ───────────────────────────────────────────
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: 'Không tìm thấy API endpoint này.' });
});

// ── 11. SPA Fallback (không bao gồm /levelN/) ───────────────
app.get('*', (req, res) => {
  if (/^\/level\d+/i.test(req.path)) {
    return res.status(404).type('text/plain').send('Not found');
  }
  res.sendFile(path.join(rootDir, 'index.html'));
});

// ── 12. Error handler ─────────────────────────────────────────
app.use(errorHandler);

// ── Start server ─────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 CyberKnight Server đang chạy tại: http://localhost:${PORT}`);
  console.log(`🛡️  Môi trường: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📁 Phục vụ Web tại: ${rootDir}`);
  console.log(`======================================================\n`);
});

// ── Graceful shutdown ─────────────────────────────────────────
const shutdown = async (signal) => {
  console.log(`\n🛑 Nhận tín hiệu ${signal}. Đang đóng server & kết nối MySQL...`);
  server.close(async () => {
    try {
      await db.end();
      console.log('✅ Đã đóng MySQL Pool thành công.');
    } catch (err) {
      console.error('❌ Lỗi khi đóng MySQL pool:', err.message);
    }
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
