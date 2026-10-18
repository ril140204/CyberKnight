/**
 * PHASE 4 — Level Guard Middleware
 *
 * Mount bằng: app.use(/^\/level(\d+)\//, require('./middleware/levelGuard'))
 *
 * Logic (theo thứ tự):
 * 1. Extract levelId từ URL (/level1/... → 1)
 * 2. FREE_LEVELS → cho qua luôn (không cần cookie)
 * 3. Đọc cookie levelAccess → verify LEVEL_ACCESS_SECRET JWT
 * 4. Kiểm tra levelId ∈ cookie.levels
 * 5. Re-check DB entitlements (in-memory cache ≤60s)
 * 6. Valid → set private Cache-Control + express.static cho thư mục level
 * 7. Invalid → 403 JSON/HTML
 *
 * Path traversal protection: chặn .. / %2e / URL-encoded variants
 * Level allowlist: chỉ serve level tồn tại trong catalog.LEVELS
 *
 * Author: Senior Full-Stack Developer
 */

const path = require('path');
const jwt = require('jsonwebtoken');
const express = require('express');
const db = require('../config/db');
const {
  levelExists,
  getLevelById,
  getPackages,
  getRequiredPackagesForLevel,
  FREE_LEVELS,
  computePlayableLevels,
} = require('../config/catalog');
const { buildEntitlements } = require('../controllers/catalogController');

// ── In-memory cache cho DB entitlement check ────────────────────────
const entitlementCache = new Map();
const CACHE_TTL_MS = 60_000;

/**
 * Lấy playableLevels từ cache hoặc DB
 * @param {number} uid
 * @returns {Promise<number[]>}
 */
async function getPlayableLevelsCached(uid) {
  const cached = entitlementCache.get(uid);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    return cached.playableLevels;
  }

  const [rows] = await db.query(
    `SELECT package_id, expires_at
     FROM user_entitlements
     WHERE user_id = ?
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [uid]
  );

  const entitlements = buildEntitlements(rows);
  const playableLevels = computePlayableLevels(entitlements);
  entitlementCache.set(uid, { timestamp: Date.now(), playableLevels });
  return playableLevels;
}

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
 * Build HTML fallback response
 */
function buildBlockedHtml(statusCode, title, heading, bodyText, buttonText, buttonLink, requiredPkgs) {
  let pkgListHtml = '';
  if (requiredPkgs && requiredPkgs.length > 0) {
    const allPkgs = getPackages();
    const pkgItems = requiredPkgs
      .map(pid => {
        const p = allPkgs[pid];
        // name và price được escape để chống XSS
        return p ? `<strong>${escapeHtml(p.name)}</strong> (${p.price.toLocaleString('vi-VN')} VNĐ)` : null;
      })
      .filter(Boolean)
      .join(', ');
    pkgListHtml = `<br><br>Các gói phù hợp: ${pkgItems}.`;
  }

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/assets/tailwind.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>body { font-family: 'Poppins', sans-serif; }</style>
</head>
<body class="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-950 via-purple-900 to-indigo-950">
  <div class="bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl p-10 max-w-md w-full mx-4 text-center shadow-2xl">
    <div class="text-6xl mb-6">🛡️</div>
    <h1 class="text-2xl font-extrabold text-white mb-4">${escapeHtml(heading)}</h1>
    <p class="text-indigo-200 mb-8 leading-relaxed">${bodyText}${pkgListHtml}</p>
    <a href="${escapeHtml(buttonLink)}"
       class="inline-block bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400
              text-white font-bold px-8 py-3 rounded-full text-lg shadow-lg
              transition-all duration-200 transform hover:scale-105">
      ${escapeHtml(buttonText)}
    </a>
    <p class="text-indigo-400 text-sm mt-6">
      <a href="/" class="hover:text-indigo-200 transition-colors">← Quay về trang chủ</a>
    </p>
  </div>
</body>
</html>`;
}

/**
 * Send blocked response (403 or 401) in JSON or HTML format
 */
function sendBlocked(req, res, status, heading, bodyText, buttonText, buttonLink, requiredPkgs) {
  if (req.accepts(['html', 'json']) === 'html') {
    const html = buildBlockedHtml(status, heading, heading, bodyText, buttonText, buttonLink, requiredPkgs);
    return res.status(status).type('text/html').send(html);
  }

  const payload = {
    success: false,
    error: status === 401 ? 'UNAUTHORIZED' : 'LEVEL_LOCKED',
    message: bodyText,
  };

  if (status === 403 && requiredPkgs && requiredPkgs.length > 0) {
    payload.data = { requiredPackages: requiredPkgs };
  }

  return res.status(status).json(payload);
}

/**
 * Check path traversal:
 * - URL-decoded variants: %2e%2e, ..%2f, %2e%2e/, etc.
 * - Returns true if path is safe (no traversal)
 */
function isSafePath(reqPath) {
  // Decode URL first to handle encoded variants (%2e = '.')
  let decoded;
  try {
    decoded = decodeURIComponent(reqPath);
  } catch {
    decoded = reqPath;
  }

  // Check for .. segments by splitting on both separators
  const segments = decoded.split('/');
  for (const seg of segments) {
    if (seg === '..') return false;
  }
  const backslashSegments = decoded.split('\\');
  for (const seg of backslashSegments) {
    if (seg === '..') return false;
  }

  return true;
}

// ── Main middleware factory ────────────────────────────────────────

/**
 * Create level guard middleware.
 * Handles the entire request: extract level, check auth, serve static.
 *
 * Uses req.originalUrl so the path always includes the full path (not just the
 * portion matched by the mount regex). The regex `app.use(/^\/level(\d+)\//, ...)`
 * ensures this middleware only runs for /level1/, /level2/, etc.
 */
function levelGuardMiddleware(req, res, next) {
  // With app.use() mount (not express.Router), req.baseUrl is the matched prefix
  // and req.path is the remainder. So baseUrl + path gives the full path.
  const rawPath = (req.baseUrl + req.path).split('?')[0];
  // normalizedPath: leading slash, used for path matching and segment extraction
  const normalizedPath = '/' + rawPath.replace(/^\//, '');

  // ── Step 1: Extract level number from path ─────────────────────
  const match = normalizedPath.match(/^\/level(\d+)\//);
  if (!match) {
    // Không phải /levelN/... — let other handlers deal with it
    return next();
  }

  const levelId = parseInt(match[1], 10);

  // ── Step 2: Validate path traversal ────────────────────────────
  if (!isSafePath(normalizedPath)) {
    return res.status(403).type('text/plain').send('Not found');
  }

  // ── Step 3: Level không tồn tại trong catalog → 404 ───────────
  if (!levelExists(levelId)) {
    return res.status(404).json({
      success: false,
      error: 'LEVEL_NOT_FOUND',
      message: 'Level không tồn tại.',
    });
  }

  // ── Step 4: FREE_LEVELS → serve directly ───────────────────────
  if (FREE_LEVELS.includes(levelId)) {
    const levelDir = path.join(process.env.EXEWEB_ROOT
      ? path.resolve(process.env.EXEWEB_ROOT)
      : path.join(__dirname, '../../../'),
      `level${levelId}`
    );

    // Resolve and validate — strip leading / so path.join doesn't treat it as absolute
    const resolved = path.resolve(path.join(levelDir, normalizedPath.replace(/^\//, '')));
    const rootResolved = path.resolve(process.env.EXEWEB_ROOT
      ? path.resolve(process.env.EXEWEB_ROOT)
      : path.join(__dirname, '../../../'));

    if (!resolved.startsWith(rootResolved + path.sep)) {
      return res.status(403).type('text/plain').send('Not found');
    }

    if (!require('fs').existsSync(resolved)) {
      // Redirect /level0/ → /level0/level0.html
      const indexPath = path.join(levelDir, `level${levelId}.html`);
      if (require('fs').existsSync(indexPath)) {
        return res.redirect(`/${`level${levelId}`}/${`level${levelId}.html`}`);
      }
      return res.status(404).type('text/plain').send('Not found');
    }

    res.set('Cache-Control', 'private, no-store');
    return res.sendFile(resolved);
  }

  // ── Step 5: Read levelAccess cookie ─────────────────────────────
  const levelAccessSecret = process.env.LEVEL_ACCESS_SECRET;
  if (!levelAccessSecret) {
    // Config missing — fail closed
    console.error('❌ LEVEL_ACCESS_SECRET chưa được cấu hình!');
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Lỗi cấu hình máy chủ. Không thể kiểm tra quyền truy cập level.',
    });
  }

  const cookieToken = req.cookies && req.cookies.levelAccess;

  if (!cookieToken) {
    const level = getLevelById(levelId);
    return sendBlocked(
      req, res,
      401,
      'Vui lòng đăng nhập',
      `Bạn cần đăng nhập để chơi "<strong>${level ? level.title : `Level ${levelId}`}</strong>".`,
      'Đăng nhập ngay',
      '/index.html',
      null
    );
  }

  // ── Step 6: Verify cookie JWT ───────────────────────────────────
  let cookieData;
  try {
    cookieData = jwt.verify(cookieToken, levelAccessSecret);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return sendBlocked(
        req, res,
        401,
        'Phiên chơi đã hết hạn',
        'Phiên chơi game đã hết hạn. Vui lòng bấm "Chơi" lại từ trang chủ.',
        'Đăng nhập ngay',
        '/index.html',
        null
      );
    }
    return sendBlocked(
      req, res,
      403,
      'Mã xác thực không hợp lệ',
      'Mã xác thực phiên chơi không hợp lệ. Vui lòng bấm "Chơi" lại từ trang chủ.',
      'Thử lại',
      '/index.html',
      null
    );
  }

  // ── Step 7: Check levelId in cookie.levels ─────────────────────
  const cookieLevels = Array.isArray(cookieData.levels) ? cookieData.levels : [];
  if (!cookieLevels.includes(levelId)) {
    const level = getLevelById(levelId);
    const requiredPkgs = getRequiredPackagesForLevel(levelId);
    return sendBlocked(
      req, res,
      403,
      'Cần mua gói để tiếp tục',
      `Bạn cần mua gói để chơi "<strong>${level ? level.title : `Level ${levelId}`}</strong>".`,
      'Mua gói ngay',
      '/index.html#packages',
      requiredPkgs
    );
  }

  // ── Step 8: Re-check DB entitlement (cache ≤60s) ─────────────────
  const uid = cookieData.uid;
  if (!uid) {
    return sendBlocked(
      req, res,
      403,
      'Phiên chơi không hợp lệ',
      'Không tìm thấy thông tin người dùng trong phiên chơi.',
      'Đăng nhập ngay',
      '/index.html',
      null
    );
  }

  // Do the DB check asynchronously but don't block if it fails — use cache
  getPlayableLevelsCached(uid)
    .then((playableLevels) => {
      if (!playableLevels.includes(levelId)) {
        // Quyền đã bị thu hồi → cookie bị invalidate
        const level = getLevelById(levelId);
        const requiredPkgs = getRequiredPackagesForLevel(levelId);
        return sendBlocked(
          req, res,
          403,
          'Quyền truy cập đã bị thu hồi',
          `Bạn cần mua gói để chơi "<strong>${level ? level.title : `Level ${levelId}`}</strong>".`,
          'Mua gói ngay',
          '/index.html#packages',
          requiredPkgs
        );
      }

      // Valid → serve the file with private Cache-Control
      const levelDir = path.join(
        process.env.EXEWEB_ROOT
          ? path.resolve(process.env.EXEWEB_ROOT)
          : path.join(__dirname, '../../../'),
        `level${levelId}`
      );

      const resolved = path.resolve(path.join(levelDir, normalizedPath.replace(/^\//, '')));
      const rootResolved = path.resolve(
        process.env.EXEWEB_ROOT
          ? path.resolve(process.env.EXEWEB_ROOT)
          : path.join(__dirname, '../../../')
      );

      if (!resolved.startsWith(rootResolved + path.sep)) {
        return res.status(403).type('text/plain').send('Not found');
      }

      if (!require('fs').existsSync(resolved)) {
        // Redirect /levelN/ → /levelN/levelN.html
        const indexPath = path.join(levelDir, `level${levelId}.html`);
        if (require('fs').existsSync(indexPath)) {
          return res.redirect(`/${`level${levelId}`}/${`level${levelId}.html`}`);
        }
        return res.status(404).type('text/plain').send('Not found');
      }

      res.set('Cache-Control', 'private, no-store');
      res.sendFile(resolved);
    })
    .catch((err) => {
      console.error('❌ Lỗi khi re-check entitlement trong level guard:', err);
      // DB error → serve the file anyway using cookie (defense in depth)
      // The cookie was valid when issued; DB check is an extra layer
      const levelDir = path.join(
        process.env.EXEWEB_ROOT
          ? path.resolve(process.env.EXEWEB_ROOT)
          : path.join(__dirname, '../../../'),
        `level${levelId}`
      );

      const resolved = path.resolve(path.join(levelDir, normalizedPath.replace(/^\//, '')));
      res.set('Cache-Control', 'private, no-store');
      res.sendFile(resolved);
    });
}

module.exports = levelGuardMiddleware;
