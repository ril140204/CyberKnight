/**
 * Middleware yêu cầu quyền Admin
 * Dùng cho các route cần kiểm tra quyền admin (ví dụ: /api/admin/*)
 *
 * Kiểm tra cả req.user (từ auth middleware) và truy vấn lại DB để đảm bảo
 * role vẫn là admin và tài khoản đang hoạt động (is_active = TRUE).
 */

const db = require('../config/db');

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function requireAdmin(req, res, next) {
  if (!req.user?.id) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Bạn cần đăng nhập để thực hiện thao tác này.',
    });
  }

  try {
    const [rows] = await db.query(
      'SELECT id, role, is_active FROM users WHERE id = ?',
      [req.user.id]
    );

    if (rows.length === 0 || !rows[0].is_active) {
      return res.status(401).json({
        success: false,
        error: 'ACCOUNT_DISABLED',
        message: 'Tài khoản không tồn tại hoặc đã bị khóa.',
      });
    }

    if (rows[0].role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'Yêu cầu quyền admin.',
      });
    }

    req.user.role = rows[0].role;
    next();
  } catch (err) {
    console.error('❌ Lỗi kiểm tra requireAdmin:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ khi xác thực quyền admin.',
    });
  }
}

module.exports = requireAdmin;
