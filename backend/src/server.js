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
const compression = require('compression');
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

/**
 * Request cùng origin (Origin == scheme://host của chính request, ví dụ khi vào bằng
 * tên miền tuỳ chỉnh www.cyberknight.store) luôn hợp lệ, không phụ thuộc CORS_ORIGINS.
 * `trust proxy` đã bật nên req.protocol lấy từ X-Forwarded-Proto của Heroku/Nginx.
 */
function isSameOrigin(req, origin) {
  const host = req.get('host');
  return Boolean(host) && origin === `${req.protocol}://${host}`;
}
function isAllowedOrigin(req, origin) {
  return !origin || allowedOrigins.includes(origin) || isSameOrigin(req, origin);
}

// Chặn origin không hợp lệ với mã 403 thay vì ném lỗi Error (tránh mã 500)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(req, origin)) {
    return next();
  }
  return res.status(403).json({
    success: false,
    error: 'CORS_DENIED',
    message: 'Nguồn truy cập (Origin) không được phép.',
  });
});

app.use((req, res, next) => cors({
  origin: (origin, cb) => cb(null, isAllowedOrigin(req, origin)),
  credentials: true,
})(req, res, next));

// ── 5a. File định danh site cho crawler & bộ lọc phishing ─────
// robots.txt / sitemap.xml / security.txt: site minh bạch, có đầu mối liên hệ — tín hiệu tin cậy
// cho Google Safe Browsing, SmartScreen... (đặt TRƯỚC khối chặn /.* bên dưới).
const siteOrigin = () => (process.env.FRONTEND_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const contactEmail = () => process.env.CONTACT_EMAIL || 'cyberknight.official.vn@gmail.com';

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').set('Cache-Control', 'public, max-age=86400').send(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /api/',
      'Disallow: /admin',
      'Disallow: /payment',
      'Disallow: /reset-password',
      'Disallow: /level',
      `Sitemap: ${siteOrigin()}/sitemap.xml`,
      '',
    ].join('\n')
  );
});

app.get('/sitemap.xml', (req, res) => {
  const urls = ['/', '/privacy', '/terms', '/refund']
    .map((p) => `  <url><loc>${siteOrigin()}${p}</loc></url>`)
    .join('\n');
  res
    .type('application/xml')
    .set('Cache-Control', 'public, max-age=86400')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});

app.get(['/.well-known/security.txt', '/security.txt'], (req, res) => {
  const expires = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  res.type('text/plain').set('Cache-Control', 'public, max-age=86400').send(
    [
      `Contact: mailto:${contactEmail()}`,
      `Expires: ${expires}`,
      'Preferred-Languages: vi, en',
      `Canonical: ${siteOrigin()}/.well-known/security.txt`,
      `Policy: ${siteOrigin()}/privacy`,
      '',
    ].join('\n')
  );
});

app.get('/favicon.ico', (req, res) => {
  res.set('Cache-Control', 'public, max-age=604800');
  res.sendFile(path.join(rootDir, 'image', 'favicon.ico'));
});

// ── 5. Hard-deny sensitive files & SEO Noindex ───────────────
app.use((req, res, next) => {
  // Gắn header X-Robots-Tag cho /admin*, /payment* và trang game (/levelN/ là tình huống MÔ PHỎNG
  // lừa đảo để dạy trẻ — không để máy tìm kiếm lập chỉ mục tách khỏi ngữ cảnh giáo dục)
  if (
    req.path.startsWith('/admin') ||
    req.path.startsWith('/payment') ||
    req.path.startsWith('/reset-password') ||
    /^\/level\d+/i.test(req.path)
  ) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }

  const path_ = req.path;
  if (/^\/backend|^\/\.|^\/node_modules|^\/video-src/.test(path_)) {
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

// ── 5b. Gzip cho HTML/CSS/JS/JSON/playlist (KHÔNG nén video/ảnh — đã nén sẵn) ─────
// Giúp hls.js 346 KB → ~108 KB, CSS/JS level giảm ~70% — quan trọng với mạng yếu.
app.use(
  compression({
    threshold: 1024,
    filter: (req, res) => {
      if (/\.(ts|mp4|m4s|png|jpg|jpeg|webp|gif|woff2?|glb)$/i.test(req.path)) return false;
      return compression.filter(req, res);
    },
  })
);

// ── 6. Static assets (public) ─────────────────────────────────
const rootDir = process.env.EXEWEB_ROOT
  ? path.resolve(process.env.EXEWEB_ROOT)
  : path.join(__dirname, '../../');

// Cache tĩnh:
//  - /video: segment HLS (.ts) & MP4 không đổi theo tên → cache 30 ngày; playlist .m3u8 cache 1 giờ
//    (express.static hỗ trợ Range request → tua/stream được). Production nên để Nginx phục vụ
//    /video/ trực tiếp từ đĩa (xem deploy/nginx.conf.example) để Node không phải stream file lớn.
const STATIC_MOUNTS = [
  { url: '/assets', dir: 'assets', opts: { maxAge: '1d', etag: true } },
  { url: '/image', dir: 'image', opts: { maxAge: '7d', etag: true } },
  {
    url: '/video',
    dir: 'video',
    opts: {
      maxAge: '30d',
      immutable: true,
      etag: true,
      lastModified: true,
      acceptRanges: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith('.m3u8')) {
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          res.setHeader('Cache-Control', 'public, max-age=3600');
        } else if (filePath.endsWith('.ts')) {
          res.setHeader('Content-Type', 'video/mp2t');
        }
      },
    },
  },
];

for (const mount of STATIC_MOUNTS) {
  const resolved = path.join(rootDir, mount.dir);
  if (fs.existsSync(resolved)) {
    app.use(mount.url, express.static(resolved, mount.opts));
  }
}

// Trang chủ: thay __SITE_ORIGIN__ (canonical, og:url, og:image, JSON-LD) bằng FRONTEND_URL — link chia sẻ
// lên Facebook/Zalo có ảnh xem trước và địa chỉ tuyệt đối đúng. Production đọc file 1 lần rồi giữ trong RAM.
let indexHtmlCache = null;
function sendIndexHtml(req, res) {
  if (!indexHtmlCache || !isProd) {
    indexHtmlCache = fs
      .readFileSync(path.join(rootDir, 'index.html'), 'utf8')
      .replaceAll('__SITE_ORIGIN__', siteOrigin());
  }
  res.set('Cache-Control', 'public, max-age=0');
  return res.type('html').send(indexHtmlCache);
}

// Direct HTML routes
app.get('/index.html', sendIndexHtml);
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
  const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)} — CyberKnight</title><link rel="stylesheet" href="/assets/tailwind.css?v=3a831b77"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet"><style>body{font-family:'Poppins',sans-serif}</style></head><body class="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-950 via-purple-900 to-indigo-950"><div class="bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl p-10 max-w-md w-full mx-4 text-center shadow-2xl"><div class="mb-6 flex justify-center" style="color:#67e8f9"><svg width="64" height="64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;" aria-hidden="true"><use href="/assets/icons.svg?v=aee0804d#i-shield-check"></use></svg></div><h1 class="text-2xl font-extrabold text-white mb-4">${escapeHtml(heading)}</h1><p class="text-indigo-200 mb-8 leading-relaxed">${bodyText}${pkgList}</p><a href="${buttonLink}" class="inline-block bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-white font-bold px-8 py-3 rounded-full text-lg shadow-lg transition-all duration-200 transform hover:scale-105">${escapeHtml(buttonText)}</a><p class="text-indigo-400 text-sm mt-6"><a href="/" class="hover:text-indigo-200 inline-flex items-center gap-1"><svg class="icon" width="1em" height="1em" aria-hidden="true"><use href="/assets/icons.svg?v=aee0804d#i-arrow-left"></use></svg> Quay về trang chủ</a></p></div></body></html>`;
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
  // private, no-cache: trình duyệt được lưu bản riêng nhưng PHẢI hỏi lại server mỗi lần dùng
  // → request vẫn đi qua level guard (bảo mật như cũ), nhưng file không đổi chỉ tốn 304, không tốn bytes.
  res.set('Cache-Control', 'private, no-cache');
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

// ── 11. Trang chủ + 404 thật ─────────────────────────────────
// Trước đây mọi đường dẫn lạ (/login, /verify, /wp-admin...) đều trả index.html kèm form đăng nhập với
// mã 200 — đúng dấu hiệu "phishing kit" mà các bộ quét tự động tìm. Giờ chỉ "/" là trang chủ.
app.get('/', sendIndexHtml);

app.get('*', (req, res) => {
  if (req.accepts(['html', 'json']) !== 'html') {
    return res.status(404).type('text/plain').send('Not found');
  }
  return res
    .status(404)
    .type('text/html')
    .send(
      '<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<meta name="robots" content="noindex"><title>Không tìm thấy trang — CyberKnight</title><link rel="icon" href="/favicon.ico">' +
        '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;background:#F0F7FF;color:#1a365d;padding:16px;box-sizing:border-box}' +
        'main{max-width:420px;text-align:center}h1{font-size:1.5rem;margin:.5rem 0}p{color:#475569;line-height:1.6}' +
        'a{display:inline-block;margin-top:1rem;padding:.75rem 1.5rem;border-radius:999px;background:#0066FF;color:#fff;text-decoration:none;font-weight:600}</style></head>' +
        '<body><main><div style="color:#0066FF"><svg width="56" height="56" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;" aria-hidden="true"><use href="/assets/icons.svg?v=aee0804d#i-shield-check"></use></svg></div><h1>Không tìm thấy trang</h1>' +
        '<p>Đường dẫn này không tồn tại trên CyberKnight. Nếu ai đó gửi link này kèm lời mời nhận quà hay yêu cầu nhập mật khẩu, hãy cẩn thận — đó có thể là lừa đảo.</p>' +
        '<a href="/">Về trang chủ CyberKnight</a></main></body></html>'
    );
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
  console.log(`\n🛑 Nhận tín hiệu ${signal}. Đang đóng server & kết nối PostgreSQL...`);
  server.close(async () => {
    try {
      await db.end();
      console.log('✅ Đã đóng PostgreSQL Pool thành công.');
    } catch (err) {
      console.error('❌ Lỗi khi đóng PostgreSQL pool:', err.message);
    }
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
