/**
 * Controller cho Catalog — endpoints công khai và người dùng đã đăng nhập
 *
 * Endpoints:
 * - GET /api/catalog/levels    — Danh sách toàn bộ level (public)
 * - GET /api/catalog/packages  — Danh sách gói mua với giá server-side (public)
 * - GET /api/catalog/me        — Thông tin user + entitlements (AUTH)
 *
 * Author: Senior Full-Stack Developer
 */

const db = require('../config/db');
const {
  getLevels,
  getPackages,
  computePlayableLevels,
  listPackageLevels,
} = require('../config/catalog');

/**
 * GET /api/catalog/levels
 * Trả về danh sách toàn bộ level — không cần đăng nhập
 */
async function getLevelsHandler(req, res) {
  try {
    const levels = getLevels();
    return res.json({
      success: true,
      data: levels,
    });
  } catch (err) {
    console.error('❌ Lỗi getLevels:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

/**
 * GET /api/catalog/packages
 * Trả về danh sách gói mua với giá server-side — không cần đăng nhập
 * GIÁ LUÔN TỪ SERVER, KHÔNG BAO GIỜ TIN TƯỞNG GIÁ TỪ CLIENT
 */
async function getPackagesHandler(req, res) {
  try {
    const packages = getPackages();
    return res.json({
      success: true,
      data: packages,
    });
  } catch (err) {
    console.error('❌ Lỗi getPackages:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

/**
 * Xây dựng entitlements object từ kết quả query user_entitlements
 * @param {Array} rows - Kết quả query từ user_entitlements
 * @returns {{ premium: boolean, packages: Array, playableLevels: number[] }}
 */
function buildEntitlements(rows) {
  const packages = [];
  let premium = false;

  for (const row of rows) {
    const packageId = row.package_id;
    if (packageId === 'premium') {
      premium = true;
      packages.push({ packageId, levels: null }); // null = ALL
    } else {
      const levels = listPackageLevels(packageId);
      packages.push({ packageId, levels });
    }
  }

  const entitlements = { premium, packages };
  const playableLevels = computePlayableLevels(entitlements);

  return { premium, packages, playableLevels };
}

/**
 * GET /api/catalog/me
 * Trả về thông tin user hiện tại + entitlements (AUTH bắt buộc)
 */
async function getCatalogMe(req, res) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({
      success: false,
      message: 'Bạn cần đăng nhập để xem thông tin này.',
    });
  }

  try {
    // Lấy user info cơ bản
    const [users] = await db.query(
      `SELECT id, username, role FROM users WHERE id = ? AND is_active = TRUE`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy người dùng.',
      });
    }

    const user = users[0];

    // Lấy entitlements đang active
    const [entitlementsRows] = await db.query(
      `SELECT package_id, expires_at
       FROM user_entitlements
       WHERE user_id = ?
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [req.user.id]
    );

    const entitlements = buildEntitlements(entitlementsRows);

    return res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          role: user.role || 'user',
        },
        entitlements,
      },
    });
  } catch (err) {
    console.error('❌ Lỗi getCatalogMe:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

module.exports = {
  getLevelsHandler,
  getPackagesHandler,
  getCatalogMe,
  buildEntitlements,
};
