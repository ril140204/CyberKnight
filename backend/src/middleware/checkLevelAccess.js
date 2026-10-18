/**
 * PHASE 4 — Middleware kiểm tra quyền truy cập level game
 *
 * Logic:
 * 1. Chưa đăng nhập (req.user missing) → 401 JSON/HTML
 * 2. Level không tồn tại → 404 JSON/HTML
 * 3. Query entitlements từ DB → compute playableLevels
 * 4. userCanPlay(levelId, entitlements) → next() hoặc 403 JSON/HTML
 *
 * Author: Senior Full-Stack Developer
 */

const db = require('../config/db');
const {
  levelExists,
  userCanPlay,
  getLevelById,
  getPackages,
  listPackageLevels,
  getRequiredPackagesForLevel,
  FREE_LEVELS,
} = require('../config/catalog');
const { buildEntitlements } = require('../controllers/catalogController');

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Trả về response phù hợp với Accept header
// ─────────────────────────────────────────────────────────────────────────────

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
 * Trả về 401/403 theo định dạng phù hợp:
 * - Accept: text/html → trả trang HTML thân thiện (cho direct browser navigation)
 * - Accept: application/json (hoặc fetch) → trả JSON (cho frontend JS logic)
 *
 * @param {object} req
 * @param {object} res
 * @param {number} status
 * @param {string} error
 * @param {string} message
 * @param {object} [data]
 */
function respond(req, res, status, error, message, data) {
  if (req.accepts(['html', 'json']) === 'html') {
    // ── HTML fallback — cho người dùng truy cập trực tiếp bằng trình duyệt
    const levelId = req._levelId;
    const level = levelId !== undefined ? getLevelById(levelId) : null;
    const levelTitle = level ? level.title : `Level ${levelId}`;

    let heading = '';
    let body = '';
    let buttonText = '';
    let buttonLink = '/index.html';

    if (status === 401) {
      heading = 'Vui lòng đăng nhập';
      body = `Bạn cần đăng nhập để chơi "<strong>${levelTitle}</strong>".`;
      buttonText = 'Đăng nhập ngay';
    } else if (status === 404) {
      heading = 'Level không tồn tại';
      body = `Level "${levelId}" không tồn tại trong hệ thống.`;
      buttonText = 'Quay về trang chủ';
    } else {
      // 403 — LEVEL_LOCKED
      heading = 'Cần mua gói để tiếp tục';
      body = `Bạn cần mua gói để chơi "<strong>${levelTitle}</strong>".`;

      if (data && data.requiredPackages && data.requiredPackages.length > 0) {
        const allPkgs = getPackages();
        const pkgList = data.requiredPackages
          .map(pid => {
            const p = allPkgs[pid];
            return p ? `<strong>${p.name}</strong> (${p.price.toLocaleString('vi-VN')} VNĐ)` : null;
          })
          .filter(Boolean)
          .join(', ');
        body += `<br><br>Các gói phù hợp: ${pkgList}.`;
      }

      buttonText = 'Mua gói ngay';
      buttonLink = '/index.html#packages';
    }

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(heading)} — CyberKnight</title>
  <link rel="stylesheet" href="/assets/tailwind.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Poppins', sans-serif; }
  </style>
</head>
<body class="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-950 via-purple-900 to-indigo-950">

  <div class="bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl p-10 max-w-md w-full mx-4 text-center shadow-2xl">
    <!-- Shield Icon -->
    <div class="text-6xl mb-6">🛡️</div>

    <h1 class="text-2xl font-extrabold text-white mb-4">${escapeHtml(heading)}</h1>

    <p class="text-indigo-200 mb-8 leading-relaxed">${body}</p>

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

    return res.status(status).type('text/html').send(html);
  }

  // ── JSON response — cho fetch() từ frontend JS
  const payload = {
    success: false,
    error,
    message,
  };
  if (data) payload.data = data;
  return res.status(status).json(payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tạo middleware kiểm tra quyền truy cập level.
 *
 * @param {number} levelId — ID của level cần kiểm tra
 * @returns {function} Express middleware
 */
function checkLevelAccess(levelId) {
  return async function (req, res, next) {
    try {
      // Lưu levelId vào req để dùng trong HTML fallback
      req._levelId = levelId;

      // ── Bước 1: Level không tồn tại → 404 ──────────────────────────
      if (!levelExists(levelId)) {
        return respond(
          req, res,
          404,
          'LEVEL_NOT_FOUND',
          'Level không tồn tại.'
        );
      }

      // ── Bước 2: Level miễn phí → cho qua luôn (FREE_LEVELS) ────────
      // Không cần đăng nhập vẫn chơi được level miễn phí
      if (FREE_LEVELS.includes(levelId)) {
        return next();
      }

      // ── Bước 3: Chưa đăng nhập → 401 ──────────────────────────────
      if (!req.user || !req.user.id) {
        return respond(
          req, res,
          401,
          'UNAUTHORIZED',
          'Vui lòng đăng nhập để tiếp tục.'
        );
      }

      // ── Bước 4: Query entitlements từ DB ───────────────────────────
      const [rows] = await db.query(
        `SELECT package_id, expires_at
         FROM user_entitlements
         WHERE user_id = ?
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [req.user.id]
      );

      const entitlements = buildEntitlements(rows);

      // ── Bước 5: Kiểm tra quyền chơi ────────────────────────────────
      const canPlay = userCanPlay(levelId, entitlements);

      if (canPlay) {
        return next();
      }

      // ── Bước 6: Không có quyền → 403 ──────────────────────────────
      const requiredPackages = getRequiredPackagesForLevel(levelId);

      return respond(
        req, res,
        403,
        'LEVEL_LOCKED',
        'Bạn cần mua gói để chơi level này.',
        { levelId, requiredPackages }
      );
    } catch (err) {
      console.error('❌ Lỗi checkLevelAccess:', err);
      return res.status(500).json({
        success: false,
        message: 'Lỗi máy chủ khi kiểm tra quyền truy cập level.',
      });
    }
  };
}

module.exports = checkLevelAccess;
