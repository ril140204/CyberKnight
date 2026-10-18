/**
 * Controller cho User Self-Service Entitlements
 *
 * Endpoints:
 * - GET /api/me/entitlements    — Lấy entitlements hiện tại của user
 * - DELETE /api/me/entitlements/:packageId — Hủy entitlement (chỉ admin_grant)
 *
 * Author: Senior Full-Stack Developer
 */

const db = require('../config/db');
const { buildEntitlements } = require('./catalogController');

/**
 * GET /api/me/entitlements
 * Trả về entitlements của user hiện tại (cùng shape với catalog/me entitlements)
 */
async function getMyEntitlements(req, res) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({
      success: false,
      message: 'Bạn cần đăng nhập.',
    });
  }

  try {
    const [rows] = await db.query(
      `SELECT package_id, expires_at, source
       FROM user_entitlements
       WHERE user_id = ?
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [req.user.id]
    );

    const entitlements = buildEntitlements(rows);

    // Trả thêm thông tin chi tiết từng entitlement (bao gồm source, expires_at)
    const entitlementsDetail = rows.map(r => ({
      packageId: r.package_id,
      source: r.source,
      expiresAt: r.expires_at,
    }));

    return res.json({
      success: true,
      data: {
        entitlements,
        entitlementsDetail,
      },
    });
  } catch (err) {
    console.error('❌ Lỗi getMyEntitlements:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

/**
 * DELETE /api/me/entitlements/:packageId
 * User tự hủy entitlement — CHỈ cho phép hủy entitlement do admin cấp (admin_grant)
 */
async function cancelMyEntitlement(req, res) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({
      success: false,
      message: 'Bạn cần đăng nhập.',
    });
  }

  const { packageId } = req.params;

  if (!packageId) {
    return res.status(400).json({
      success: false,
      message: 'Thiếu packageId.',
    });
  }

  try {
    // Chỉ xóa nếu source = 'admin_grant' (không cho user tự hủy gói đã mua)
    const [result] = await db.query(
      `DELETE FROM user_entitlements
       WHERE user_id = ? AND package_id = ? AND source = 'admin_grant'`,
      [req.user.id, packageId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy entitlement nào có thể hủy. Chỉ entitlement do admin cấp mới có thể tự hủy.',
      });
    }

    return res.json({
      success: true,
      message: `Đã hủy gói "${packageId}" thành công.`,
    });
  } catch (err) {
    console.error('❌ Lỗi cancelMyEntitlement:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

module.exports = {
  getMyEntitlements,
  cancelMyEntitlement,
};
