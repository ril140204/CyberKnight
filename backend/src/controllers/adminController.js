/**
 * Controller cho Admin — quản lý users, orders, payments
 *
 * Tất cả các hàm yêu cầu requireAdmin middleware (đã kiểm tra trước khi gọi)
 *
 * Endpoints:
 * - GET /api/admin/stats           — Thống kê tổng quan
 * - GET /api/admin/users          — Danh sách users (phân trang, tìm kiếm, sắp xếp online)
 * - GET /api/admin/users/:id      — Chi tiết user + entitlements + thời gian online
 * - POST /api/admin/users/:id/entitlements — Cấp entitlement cho user
 * - DELETE /api/admin/users/:id/entitlements/:packageId — Thu hồi entitlement
 * - GET /api/admin/orders         — Danh sách orders (phân trang, lọc)
 * - GET /api/admin/payments/mismatches — Danh sách giao dịch lỗi
 *
 * Author: Senior Full-Stack Developer
 */

const db = require('../config/db');
const { getPackageById } = require('../config/catalog');
const { buildEntitlements } = require('./catalogController');

// Ngưỡng "đang online": heartbeat trong vòng 90 giây gần nhất (3 nhịp × 30s)
const ONLINE_WINDOW_SECONDS = 90;

/**
 * GET /api/admin/stats
 * Trả về thống kê tổng quan
 */
async function getStats(req, res) {
  try {
    const [totalUsers] = await db.query('SELECT COUNT(*) AS cnt FROM users WHERE is_active = 1');
    const [totalPaidOrders] = await db.query(
      "SELECT COUNT(*) AS cnt FROM orders WHERE status = 'paid'"
    );
    const [totalEntitlements] = await db.query(
      `SELECT COUNT(*) AS cnt FROM user_entitlements
       WHERE expires_at IS NULL OR expires_at > NOW()`
    );
    const [todayUsers] = await db.query(
      `SELECT COUNT(*) AS cnt FROM users
       WHERE is_active = 1 AND DATE(created_at) = CURDATE()`
    );
    const [totalMismatches] = await db.query(
      "SELECT COUNT(*) AS cnt FROM payment_transactions WHERE match_status IN ('no_order', 'underpaid', 'error')"
    );
    const [totalRevenue] = await db.query(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM orders WHERE status = 'paid'"
    );

    return res.json({
      success: true,
      data: {
        totalUsers: totalUsers[0].cnt,
        totalPaidOrders: totalPaidOrders[0].cnt,
        totalEntitlements: totalEntitlements[0].cnt,
        todayNewUsers: todayUsers[0].cnt,
        totalMismatches: totalMismatches[0].cnt,
        totalRevenue: Number(totalRevenue[0].total) || 0,
      },
    });
  } catch (err) {
    console.error('❌ Lỗi getStats:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

/**
 * GET /api/admin/users
 * Query params: ?page=1&limit=20&search=
 *
 * LEFT JOIN user_activity để lấy tổng thời gian online (onlineSeconds)
 * và trạng thái đang online (isOnlineNow = heartbeat trong 90 giây gần nhất).
 * Tất cả điều kiện đều dùng placeholder `?` — KHÔNG nối chuỗi.
 */
async function listUsers(req, res) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const search = (req.query.search || '').trim();

  try {
    // Count: LEFT JOIN không làm thay đổi số dòng (bảng activity 1 dòng / user)
    let countQuery = `
      SELECT COUNT(*) AS total
      FROM users u
      LEFT JOIN user_activity ua ON ua.user_id = u.id
      WHERE u.is_active = 1
    `;
    let dataQuery = `
      SELECT u.id, u.username, u.email, u.role, u.level, u.points,
             u.created_at, u.last_login,
             COALESCE(ua.total_seconds, 0) AS online_seconds,
             ua.last_heartbeat_at,
             ua.first_seen_at,
             (ua.last_heartbeat_at IS NOT NULL
              AND ua.last_heartbeat_at >= DATE_SUB(NOW(), INTERVAL ? SECOND)) AS is_online_now
      FROM users u
      LEFT JOIN user_activity ua ON ua.user_id = u.id
      WHERE u.is_active = 1
    `;
    // Tham số đầu tiên của dataQuery là tham số cho INTERVAL (placeholder trong SELECT)
    const dataParams = [ONLINE_WINDOW_SECONDS];
    const countParams = [];

    if (search) {
      const searchCondition = ' AND (u.username LIKE ? OR u.email LIKE ?)';
      countQuery += searchCondition;
      dataQuery += searchCondition;
      const searchPattern = `%${search}%`;
      countParams.push(searchPattern, searchPattern);
      dataParams.push(searchPattern, searchPattern);
    }

    // Sắp xếp: whitelist tuyệt đối — chỉ chấp nhận giá trị đã định nghĩa sẵn
    const SORT_WHITELIST = {
      newest: 'u.created_at DESC',
      oldest: 'u.created_at ASC',
      online_desc: 'online_seconds DESC, u.created_at DESC',
      online_asc: 'online_seconds ASC, u.created_at DESC',
    };
    const sortKey = String(req.query.sort || 'newest').trim();
    const orderBy = SORT_WHITELIST[sortKey] || SORT_WHITELIST.newest;

    dataQuery += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;

    const [countResult] = await db.query(countQuery, countParams);
    const total = countResult[0].total;

    // Đặt limit/offset làm số
    const [rows] = await db.query(dataQuery, [...dataParams, limit, offset]);

    return res.json({
      success: true,
      data: {
        users: rows.map(u => ({
          id: u.id,
          username: u.username,
          email: u.email,
          role: u.role || 'user',
          level: u.level,
          points: u.points,
          createdAt: u.created_at,
          lastLogin: u.last_login,
          onlineSeconds: Number(u.online_seconds) || 0,
          lastHeartbeatAt: u.last_heartbeat_at,
          firstSeenAt: u.first_seen_at,
          isOnlineNow: Boolean(u.is_online_now),
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('❌ Lỗi listUsers:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

/**
 * GET /api/admin/users/:id
 * Chi tiết user + entitlements
 */
async function getUserDetail(req, res) {
  const userId = parseInt(req.params.id);
  if (!userId || isNaN(userId)) {
    return res.status(400).json({
      success: false,
      message: 'ID người dùng không hợp lệ.',
    });
  }

  try {
    const [users] = await db.query(
      `SELECT id, first_name, last_name, username, email, birth_year,
              level, points, role, is_active, created_at, last_login, avatar_url
       FROM users WHERE id = ?`,
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy người dùng.',
      });
    }

    const [entitlementsRows] = await db.query(
      `SELECT package_id, order_id, source, granted_at, expires_at
       FROM user_entitlements WHERE user_id = ?`,
      [userId]
    );

    const entitlements = buildEntitlements(entitlementsRows);

    // Thống kê thời gian online (LEFT JOIN nên user chưa từng gửi heartbeat vẫn trả về 0)
    const [activityRows] = await db.query(
      `SELECT COALESCE(total_seconds, 0) AS online_seconds,
              last_heartbeat_at,
              first_seen_at,
              (last_heartbeat_at IS NOT NULL
               AND last_heartbeat_at >= DATE_SUB(NOW(), INTERVAL ? SECOND)) AS is_online_now
       FROM user_activity WHERE user_id = ?`,
      [ONLINE_WINDOW_SECONDS, userId]
    );
    const act = activityRows[0] || {};

    const u = users[0];
    return res.json({
      success: true,
      data: {
        user: {
          id: u.id,
          firstName: u.first_name,
          lastName: u.last_name,
          username: u.username,
          email: u.email,
          birthYear: u.birth_year,
          level: u.level,
          points: u.points,
          role: u.role || 'user',
          isActive: Boolean(u.is_active),
          avatarUrl: u.avatar_url,
          createdAt: u.created_at,
          lastLogin: u.last_login,
          onlineSeconds: Number(act.online_seconds) || 0,
          lastHeartbeatAt: act.last_heartbeat_at || null,
          firstSeenAt: act.first_seen_at || null,
          isOnlineNow: Boolean(act.is_online_now),
        },
        entitlements,
      },
    });
  } catch (err) {
    console.error('❌ Lỗi getUserDetail:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

/**
 * POST /api/admin/users/:id/entitlements
 * Body: { packageId: string, expiresAt?: string|null }
 */
async function grantEntitlement(req, res) {
  const userId = parseInt(req.params.id);
  if (!userId || isNaN(userId)) {
    return res.status(400).json({
      success: false,
      message: 'ID người dùng không hợp lệ.',
    });
  }

  const { packageId, expiresAt } = req.body;

  if (!packageId || typeof packageId !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'Thiếu packageId.',
    });
  }

  const pkg = getPackageById(packageId);
  if (!pkg) {
    return res.status(400).json({
      success: false,
      message: 'Gói không tồn tại.',
    });
  }

  try {
    // Kiểm tra user tồn tại
    const [users] = await db.query(
      'SELECT id FROM users WHERE id = ? AND is_active = 1',
      [userId]
    );
    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy người dùng.',
      });
    }

    // Parse expiresAt: null hoặc undefined = vĩnh viễn (null trong DB)
    // Chuỗi ISO = giá trị cụ thể
    let expiresAtValue = null;
    if (expiresAt !== undefined && expiresAt !== null && expiresAt !== '') {
      const parsed = new Date(expiresAt);
      if (!isNaN(parsed.getTime())) {
        expiresAtValue = parsed;
      }
    }

    await db.query(
      `INSERT INTO user_entitlements (user_id, package_id, source, expires_at)
       VALUES (?, ?, 'admin_grant', ?)
       ON DUPLICATE KEY UPDATE
         source = 'admin_grant',
         expires_at = VALUES(expires_at)`,
      [userId, packageId, expiresAtValue]
    );

    // Ghi nhật ký vào admin_audit_log
    try {
      await db.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_user_id, package_id, reason)
         VALUES (?, 'grant_package', ?, ?, ?)`,
        [req.user.id, userId, packageId, 'Cấp quyền từ chi tiết user']
      );
    } catch (auditErr) {
      console.warn('⚠️ Không thể ghi audit log:', auditErr.message);
    }

    return res.json({
      success: true,
      message: `Đã cấp gói "${pkg.name}" cho người dùng.`,
      data: {
        userId,
        packageId,
        expiresAt: expiresAtValue,
        source: 'admin_grant',
      },
    });
  } catch (err) {
    console.error('❌ Lỗi grantEntitlement:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

/**
 * DELETE /api/admin/users/:id/entitlements/:packageId
 * Thu hồi entitlement của user
 */
async function revokeEntitlement(req, res) {
  const userId = parseInt(req.params.id);
  const { packageId } = req.params;

  if (!userId || isNaN(userId) || !packageId) {
    return res.status(400).json({
      success: false,
      message: 'Thông tin không hợp lệ.',
    });
  }

  try {
    const [result] = await db.query(
      'DELETE FROM user_entitlements WHERE user_id = ? AND package_id = ?',
      [userId, packageId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy entitlement để thu hồi.',
      });
    }

    // Ghi nhật ký vào admin_audit_log
    try {
      await db.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_user_id, package_id, reason)
         VALUES (?, 'revoke_package', ?, ?, ?)`,
        [req.user.id, userId, packageId, 'Thu hồi entitlement qua admin']
      );
    } catch (auditErr) {
      console.warn('⚠️ Không thể ghi audit log:', auditErr.message);
    }

    return res.json({
      success: true,
      message: `Đã thu hồi gói "${packageId}" của người dùng.`,
    });
  } catch (err) {
    console.error('❌ Lỗi revokeEntitlement:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

/**
 * GET /api/admin/orders
 * Query params: ?page=1&limit=20&status=&search=
 */
async function listAdminOrders(req, res) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const statusFilter = (req.query.status || '').trim();
  const search = (req.query.search || '').trim();

  try {
    let countQuery = `
      SELECT COUNT(*) AS total
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
    `;
    let dataQuery = `
      SELECT o.id, o.order_code, o.user_id, o.package_id, o.amount, o.status,
             o.payment_method, o.expires_at, o.paid_at, o.created_at,
             u.username, u.email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
    `;
    const whereConditions = [];
    const params = [];

    if (statusFilter) {
      whereConditions.push('o.status = ?');
      params.push(statusFilter);
    }

    if (search) {
      whereConditions.push('(o.order_code LIKE ? OR u.username LIKE ? OR u.email LIKE ?)');
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern);
    }

    if (whereConditions.length > 0) {
      const whereClause = ' WHERE ' + whereConditions.join(' AND ');
      countQuery += whereClause;
      dataQuery += whereClause;
    }

    const [countResult] = await db.query(countQuery, params);
    const total = countResult[0].total;

    dataQuery += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';

    const [rows] = await db.query(dataQuery, [...params, limit, offset]);

    return res.json({
      success: true,
      data: {
        orders: rows.map(r => ({
          id: r.id,
          orderCode: r.order_code,
          userId: r.user_id,
          username: r.username,
          userEmail: r.email,
          packageId: r.package_id,
          amount: r.amount,
          status: r.status,
          paymentMethod: r.payment_method,
          expiresAt: r.expires_at,
          paidAt: r.paid_at,
          createdAt: r.created_at,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('❌ Lỗi listAdminOrders:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

/**
 * GET /api/admin/transactions
 * Danh sách giao dịch ngân hàng đã nhận, filter theo provider, order_id
 * Query params: ?page=1&limit=20&provider=&order_id=
 */
async function listAdminTransactions(req, res) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const providerFilter = (req.query.provider || '').trim();
  const orderIdFilter = parseInt(req.query.order_id) || null;

  try {
    let countQuery = `
      SELECT COUNT(*) AS total
      FROM payment_transactions pt
      LEFT JOIN orders o ON pt.order_id = o.id
    `;
    let dataQuery = `
      SELECT pt.id, pt.provider, pt.provider_tx_id, pt.order_id, pt.amount_in,
             pt.content, pt.account_number, pt.transaction_date,
             pt.match_status, pt.created_at,
             o.order_code, o.user_id, u.username, u.email
      FROM payment_transactions pt
      LEFT JOIN orders o ON pt.order_id = o.id
      LEFT JOIN users u ON o.user_id = u.id
    `;
    const whereConditions = [];
    const params = [];

    if (providerFilter) {
      whereConditions.push('pt.provider = ?');
      params.push(providerFilter);
    }

    if (orderIdFilter) {
      whereConditions.push('pt.order_id = ?');
      params.push(orderIdFilter);
    }

    if (whereConditions.length > 0) {
      const whereClause = ' WHERE ' + whereConditions.join(' AND ');
      countQuery += whereClause;
      dataQuery += whereClause;
    }

    const [countResult] = await db.query(countQuery, params);
    const total = countResult[0].total;

    dataQuery += ' ORDER BY pt.created_at DESC LIMIT ? OFFSET ?';

    const [rows] = await db.query(dataQuery, [...params, limit, offset]);

    return res.json({
      success: true,
      data: {
        transactions: rows.map(r => ({
          id: r.id,
          provider: r.provider,
          providerTxId: r.provider_tx_id,
          orderId: r.order_id,
          orderCode: r.order_code,
          userId: r.user_id,
          username: r.username,
          userEmail: r.email,
          amountIn: r.amount_in,
          content: r.content,
          accountNumber: r.account_number,
          transactionDate: r.transaction_date,
          matchStatus: r.match_status,
          createdAt: r.created_at,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('❌ Lỗi listAdminTransactions:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

/**
 * POST /api/admin/grant
 * Cấp gói thủ công: body { user_id, email, package_id, reason }
 * Ghi log vào bảng admin_audit_log
 */
async function grantPackageDirect(req, res) {
  const adminId = req.user.id;
  const { user_id, email, package_id, reason } = req.body;

  if (!package_id || typeof package_id !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'Thiếu mã gói (package_id).',
    });
  }

  const pkg = getPackageById(package_id);
  if (!pkg) {
    return res.status(400).json({
      success: false,
      message: `Gói "${package_id}" không tồn tại trong hệ thống.`,
    });
  }

  try {
    let targetUserId = parseInt(user_id) || null;

    if (!targetUserId && email) {
      const [userRows] = await db.query(
        'SELECT id FROM users WHERE email = ? AND is_active = 1',
        [email.trim()]
      );
      if (userRows.length > 0) {
        targetUserId = userRows[0].id;
      }
    }

    if (!targetUserId) {
      return res.status(400).json({
        success: false,
        message: 'Không tìm thấy người dùng hợp lệ từ user_id hoặc email cung cấp.',
      });
    }

    // Kiểm tra user có tồn tại và active
    const [targetUser] = await db.query(
      'SELECT id, username, email FROM users WHERE id = ? AND is_active = 1',
      [targetUserId]
    );

    if (targetUser.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Người dùng không tồn tại hoặc tài khoản đã bị khóa.',
      });
    }

    // Cấp quyền vĩnh viễn (expires_at = null theo quyết định đã duyệt)
    await db.query(
      `INSERT INTO user_entitlements (user_id, package_id, source, granted_at, expires_at)
       VALUES (?, ?, 'admin_grant', NOW(), NULL)
       ON DUPLICATE KEY UPDATE
         source = 'admin_grant',
         granted_at = NOW(),
         expires_at = NULL`,
      [targetUserId, package_id]
    );

    // Ghi nhật ký vào admin_audit_log
    const auditReason = reason && typeof reason === 'string' ? reason.trim().slice(0, 255) : 'Cấp gói thủ công bởi admin';
    await db.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_user_id, package_id, reason)
       VALUES (?, 'grant_package', ?, ?, ?)`,
      [adminId, targetUserId, package_id, auditReason]
    );

    return res.json({
      success: true,
      message: `Đã cấp gói "${pkg.name}" cho tài khoản ${targetUser[0].username} (${targetUser[0].email}) thành công.`,
      data: {
        userId: targetUserId,
        username: targetUser[0].username,
        email: targetUser[0].email,
        packageId: package_id,
        packageName: pkg.name,
        expiresAt: null,
      },
    });
  } catch (err) {
    console.error('❌ Lỗi grantPackageDirect:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ khi cấp gói.',
    });
  }
}

/**
 * GET /api/admin/payments/mismatches
 * Danh sách giao dịch lỗi cần admin reconcile
 */
async function getMismatches(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT pt.id, pt.provider, pt.provider_tx_id, pt.order_id, pt.amount_in,
              pt.content, pt.account_number, pt.transaction_date,
              pt.match_status, pt.created_at,
              o.order_code, o.user_id, u.username, u.email
       FROM payment_transactions pt
       LEFT JOIN orders o ON pt.order_id = o.id
       LEFT JOIN users u ON o.user_id = u.id
       WHERE pt.match_status IN ('no_order', 'underpaid', 'error')
       ORDER BY pt.created_at DESC
       LIMIT 200`
    );

    return res.json({
      success: true,
      data: {
        transactions: rows.map(r => ({
          id: r.id,
          provider: r.provider,
          providerTxId: r.provider_tx_id,
          orderId: r.order_id,
          orderCode: r.order_code,
          userId: r.user_id,
          username: r.username,
          userEmail: r.email,
          amountIn: r.amount_in,
          content: r.content,
          accountNumber: r.account_number,
          transactionDate: r.transaction_date,
          matchStatus: r.match_status,
          createdAt: r.created_at,
        })),
      },
    });
  } catch (err) {
    console.error('❌ Lỗi getMismatches:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

/**
 * POST /api/admin/payments/reconcile
 * Đối soát và khớp giao dịch lỗi với đơn hàng
 * Body: { transaction_id: number, order_code?: string, order_id?: number, note?: string }
 */
async function reconcileTransaction(req, res) {
  const adminId = req.user.id;
  const { transaction_id, order_code, order_id, note } = req.body;

  const txId = Number.parseInt(transaction_id, 10);
  if (!txId || Number.isNaN(txId)) {
    return res.status(400).json({
      success: false,
      message: 'Thiếu hoặc sai ID giao dịch (transaction_id).',
    });
  }

  const orderCode = (order_code || '').trim();
  const orderId = Number.parseInt(order_id, 10) || null;

  if (!orderCode && !orderId) {
    return res.status(400).json({
      success: false,
      message: 'Vui lòng cung cấp mã đơn hàng (order_code) hoặc ID đơn hàng (order_id).',
    });
  }

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    // 1. Khóa và lấy thông tin giao dịch
    const [txRows] = await conn.query(
      'SELECT * FROM payment_transactions WHERE id = ? FOR UPDATE',
      [txId]
    );

    if (txRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy giao dịch ngân hàng.',
      });
    }

    const tx = txRows[0];

    // 2. Khóa và lấy thông tin đơn hàng
    let orderQuery = 'SELECT * FROM orders WHERE ';
    const orderParams = [];
    if (orderCode) {
      orderQuery += 'order_code = ?';
      orderParams.push(orderCode);
    } else {
      orderQuery += 'id = ?';
      orderParams.push(orderId);
    }
    orderQuery += ' FOR UPDATE';

    const [orderRows] = await conn.query(orderQuery, orderParams);
    if (orderRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đơn hàng cần khớp.',
      });
    }

    const order = orderRows[0];

    // 3. Tính tổng số tiền đã nhận cho đơn hàng này (bao gồm cả giao dịch này)
    const [sumRows] = await conn.query(
      `SELECT COALESCE(SUM(amount_in), 0) AS total_received
       FROM payment_transactions
       WHERE (order_id = ? AND id != ?) AND match_status IN ('matched', 'underpaid')`,
      [order.id, tx.id]
    );

    const prevReceived = Number(sumRows[0].total_received) || 0;
    const totalReceived = prevReceived + Number(tx.amount_in);
    const orderAmount = Number(order.amount);

    let matchStatus = 'matched';
    let isFullyPaid = false;

    if (totalReceived >= orderAmount) {
      isFullyPaid = true;
      matchStatus = 'matched';
    } else {
      matchStatus = 'underpaid';
    }

    // 4. Cập nhật giao dịch ngân hàng
    await conn.query(
      `UPDATE payment_transactions
       SET order_id = ?, match_status = ?
       WHERE id = ?`,
      [order.id, matchStatus, tx.id]
    );

    // 5. Cập nhật đơn hàng và cấp quyền nếu đã đủ tiền
    if (isFullyPaid) {
      await conn.query(
        `UPDATE orders
         SET status = 'paid', paid_at = COALESCE(paid_at, NOW())
         WHERE id = ?`,
        [order.id]
      );

      // Cấp quyền vĩnh viễn cho user (expires_at = null)
      await conn.query(
        `INSERT INTO user_entitlements (user_id, package_id, order_id, source, granted_at, expires_at)
         VALUES (?, ?, ?, 'purchase', NOW(), NULL)
         ON DUPLICATE KEY UPDATE
           order_id = VALUES(order_id),
           source = 'purchase',
           granted_at = NOW(),
           expires_at = NULL`,
        [order.user_id, order.package_id, order.id]
      );
    } else {
      // Đơn bị thiếu tiền
      await conn.query(
        "UPDATE orders SET status = 'underpaid' WHERE id = ? AND status = 'pending'",
        [order.id]
      );
    }

    // 6. Ghi nhật ký vào admin_audit_log
    const auditReason = (note && typeof note === 'string' ? note.trim().slice(0, 255) : '') ||
      `Đối soát giao dịch #${tx.id} (+${Number(tx.amount_in).toLocaleString('vi-VN')}đ) khớp đơn ${order.order_code}`;

    await conn.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_user_id, package_id, reason)
       VALUES (?, 'reconcile_transaction', ?, ?, ?)`,
      [adminId, order.user_id, order.package_id, auditReason]
    );

    await conn.commit();

    return res.json({
      success: true,
      message: isFullyPaid
        ? `Đã khớp giao dịch #${tx.id} với đơn ${order.order_code} thành công. Đơn hàng đã được thanh toán đủ và kích hoạt gói "${order.package_id}".`
        : `Đã liên kết giao dịch #${tx.id} với đơn ${order.order_code}, tuy nhiên số tiền còn thiếu (${totalReceived.toLocaleString('vi-VN')} / ${orderAmount.toLocaleString('vi-VN')} đ).`,
      data: {
        transactionId: tx.id,
        orderId: order.id,
        orderCode: order.order_code,
        userId: order.user_id,
        packageId: order.package_id,
        amountIn: tx.amount_in,
        totalReceived,
        orderAmount,
        matchStatus,
        orderStatus: isFullyPaid ? 'paid' : 'underpaid',
      },
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('❌ Lỗi reconcileTransaction:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ khi đối soát giao dịch.',
    });
  } finally {
    if (conn) conn.release();
  }
}

/**
 * GET /api/admin/audit-logs
 * Danh sách nhật ký hoạt động của admin
 * Query params: ?page=1&limit=20&admin_id=&target_user_id=&action=
 */
async function listAuditLogs(req, res) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const adminIdFilter = Number.parseInt(req.query.admin_id, 10) || null;
  const targetUserIdFilter = Number.parseInt(req.query.target_user_id, 10) || null;
  const actionFilter = (req.query.action || '').trim();

  try {
    let countQuery = `
      SELECT COUNT(*) AS total
      FROM admin_audit_log a
    `;
    let dataQuery = `
      SELECT a.id, a.admin_id, a.action, a.target_user_id, a.package_id, a.reason, a.created_at,
             u_admin.username AS admin_username, u_admin.email AS admin_email,
             u_target.username AS target_username, u_target.email AS target_email
      FROM admin_audit_log a
      LEFT JOIN users u_admin ON a.admin_id = u_admin.id
      LEFT JOIN users u_target ON a.target_user_id = u_target.id
    `;
    const whereConditions = [];
    const params = [];

    if (adminIdFilter) {
      whereConditions.push('a.admin_id = ?');
      params.push(adminIdFilter);
    }

    if (targetUserIdFilter) {
      whereConditions.push('a.target_user_id = ?');
      params.push(targetUserIdFilter);
    }

    if (actionFilter) {
      whereConditions.push('a.action = ?');
      params.push(actionFilter);
    }

    if (whereConditions.length > 0) {
      const whereClause = ' WHERE ' + whereConditions.join(' AND ');
      countQuery += whereClause;
      dataQuery += whereClause;
    }

    const [countResult] = await db.query(countQuery, params);
    const total = countResult[0].total;

    dataQuery += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';

    const [rows] = await db.query(dataQuery, [...params, limit, offset]);

    return res.json({
      success: true,
      data: {
        logs: rows.map(r => ({
          id: r.id,
          adminId: r.admin_id,
          adminUsername: r.admin_username,
          adminEmail: r.admin_email,
          action: r.action,
          targetUserId: r.target_user_id,
          targetUsername: r.target_username,
          targetEmail: r.target_email,
          packageId: r.package_id,
          reason: r.reason,
          createdAt: r.created_at,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('❌ Lỗi listAuditLogs:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

module.exports = {
  getStats,
  listUsers,
  getUserDetail,
  grantEntitlement,
  revokeEntitlement,
  listAdminOrders,
  listAdminTransactions,
  grantPackageDirect,
  getMismatches,
  reconcileTransaction,
  listAuditLogs,
};
