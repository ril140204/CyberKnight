/**
 * Controller cho Payments — tạo đơn, xem đơn, hủy đơn, webhook
 *
 * Endpoints:
 * - POST /api/payments/orders            — Tạo đơn hàng mới (AUTH)
 * - GET  /api/payments/orders/:orderCode — Chi tiết một đơn (AUTH)
 * - POST /api/payments/orders/:orderCode/cancel — Hủy đơn hàng (AUTH)
 * - GET  /api/payments/orders/mine       — Danh sách đơn hàng của user (AUTH)
 * - POST /api/payments/webhook/:provider — Nhận webhook từ ngân hàng (NO AUTH, adapter verify)
 *
 * Author: Senior Full-Stack Developer
 */

'use strict';

const db = require('../config/db');
const { getPackageById } = require('../config/catalog');
const { generateOrderCode, extractOrderCode } = require('../utils/orderCode');
const { buildQrUrl } = require('../utils/qr');
const { sendPackageActivatedEmail } = require('../utils/mailer');
const { invalidateEntitlementCache } = require('../utils/entitlementCache');
const { isPaymentConfigured } = require('../utils/paymentConfig');

// Các adapter thanh toán
const providers = {
  sepay: require('../payments/providers/sepay'),
  casso: require('../payments/providers/casso'),
};

/**
 * Kiểm tra người dùng có quyền admin hay không trực tiếp từ DB
 * @param {number|string} userId
 * @returns {Promise<boolean>}
 */
async function checkIsAdmin(userId) {
  if (!userId) return false;
  try {
    const [rows] = await db.query(
      'SELECT role, is_active FROM users WHERE id = ?',
      [userId]
    );
    return rows.length > 0 && Boolean(rows[0].is_active) && rows[0].role === 'admin';
  } catch {
    return false;
  }
}

/**
 * POST /api/payments/orders (hoặc POST /api/payments/create-order)
 * Body: { packageId: string }
 */
async function createOrder(req, res) {
  if (!req.user?.id) {
    return res.status(401).json({
      success: false,
      message: 'Bạn cần đăng nhập để tạo đơn hàng.',
    });
  }

  // 1. Kiểm tra cấu hình ngân hàng (Fail-closed nếu thiếu hoặc còn giá trị giữ chỗ)
  const bankBin = process.env.BANK_BIN;
  const bankAccount = process.env.BANK_ACCOUNT;
  const bankName = process.env.BANK_NAME;

  if (!isPaymentConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'PAYMENTS_DISABLED',
      message: 'Thanh toán trực tuyến đang tạm đóng. Level 0 vẫn chơi miễn phí — vui lòng quay lại sau.',
    });
  }

  const { packageId } = req.body;

  if (!packageId || typeof packageId !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'Thiếu mã gói (packageId).',
    });
  }

  const pkg = getPackageById(packageId);
  if (!pkg) {
    return res.status(400).json({
      success: false,
      message: 'Gói dịch vụ không tồn tại trong danh mục.',
    });
  }

  try {
    // 2. Kiểm tra nếu user đã sở hữu gói này hoặc Premium (409 Conflict)
    const [owned] = await db.query(
      `SELECT package_id FROM user_entitlements
       WHERE user_id = ? AND (package_id = ? OR package_id = 'premium')
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [req.user.id, packageId]
    );
    if (owned.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'ALREADY_OWNED',
        message: 'Bạn đã sở hữu gói dịch vụ này hoặc gói Premium.',
      });
    }

    // 3. Nếu đang có đơn 'pending' còn hạn cùng gói -> trả lại đơn cũ kèm mã QR
    const [existingPending] = await db.query(
      `SELECT id, order_code, package_id, amount, status, payment_method, expires_at, created_at
       FROM orders
       WHERE user_id = ? AND package_id = ? AND status = 'pending' AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id, packageId]
    );

    if (existingPending.length > 0) {
      const pendingOrder = existingPending[0];
      const qrUrl = buildQrUrl({
        bin: bankBin,
        account: bankAccount,
        amount: pendingOrder.amount,
        orderCode: pendingOrder.order_code,
        accountName: bankName,
      });

      return res.status(200).json({
        success: true,
        data: {
          order: {
            id: pendingOrder.id,
            orderCode: pendingOrder.order_code,
            packageId: pendingOrder.package_id,
            packageName: pkg.name,
            amount: pendingOrder.amount,
            status: pendingOrder.status,
            paymentMethod: pendingOrder.payment_method,
            expiresAt: pendingOrder.expires_at,
            createdAt: pendingOrder.created_at,
          },
          qr: {
            provider: 'bank_qr',
            accountNumber: bankAccount,
            accountName: bankName,
            bankBin: bankBin,
            content: pendingOrder.order_code,
            amount: pendingOrder.amount,
            expiredAt: pendingOrder.expires_at,
            qrUrl,
          },
        },
      });
    }

    // 4. Tạo đơn hàng mới với TTL cấu hình qua ORDER_TTL_MINUTES (mặc định 30 phút)
    const ttlMinutes = Number.parseInt(process.env.ORDER_TTL_MINUTES, 10) || 30;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const orderCode = generateOrderCode();

    const [result] = await db.query(
      `INSERT INTO orders (order_code, user_id, package_id, amount, status, payment_method, expires_at)
       VALUES (?, ?, ?, ?, 'pending', 'bank_qr', ?)`,
      [orderCode, req.user.id, packageId, pkg.price, expiresAt]
    );

    const qrUrl = buildQrUrl({
      bin: bankBin,
      account: bankAccount,
      amount: pkg.price,
      orderCode,
      accountName: bankName,
    });

    const order = {
      id: result.insertId,
      orderCode,
      packageId,
      packageName: pkg.name,
      amount: pkg.price,
      status: 'pending',
      paymentMethod: 'bank_qr',
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
    };

    const qr = {
      provider: 'bank_qr',
      accountNumber: bankAccount,
      accountName: bankName,
      bankBin: bankBin,
      content: orderCode,
      amount: pkg.price,
      expiredAt: expiresAt.toISOString(),
      qrUrl,
    };

    return res.status(201).json({
      success: true,
      data: { order, qr },
    });
  } catch (err) {
    console.error('❌ Lỗi createOrder:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ khi tạo đơn hàng, vui lòng thử lại sau.',
    });
  }
}

/**
 * GET /api/payments/orders/mine (hoặc GET /api/payments/orders)
 * Trả về danh sách đơn hàng của user hiện tại
 */
async function listOrders(req, res) {
  if (!req.user?.id) {
    return res.status(401).json({
      success: false,
      message: 'Bạn cần đăng nhập để xem danh sách đơn hàng.',
    });
  }

  try {
    const [rows] = await db.query(
      `SELECT o.id, o.order_code, o.package_id, o.amount, o.status, o.payment_method,
              o.expires_at, o.paid_at, o.created_at
       FROM orders o
       WHERE o.user_id = ?
       ORDER BY o.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    const orders = rows.map(r => ({
      id: r.id,
      orderCode: r.order_code,
      packageId: r.package_id,
      amount: r.amount,
      status: r.status,
      paymentMethod: r.payment_method,
      expiresAt: r.expires_at,
      paidAt: r.paid_at,
      createdAt: r.created_at,
    }));

    return res.json({
      success: true,
      data: { orders },
    });
  } catch (err) {
    console.error('❌ Lỗi listOrders:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

/**
 * GET /api/payments/orders/:orderCode
 * Trả về chi tiết một đơn hàng kèm thông tin QR
 */
async function getOrder(req, res) {
  if (!req.user?.id) {
    return res.status(401).json({
      success: false,
      message: 'Bạn cần đăng nhập.',
    });
  }

  const { orderCode } = req.params;
  if (!orderCode) {
    return res.status(400).json({
      success: false,
      message: 'Thiếu mã đơn hàng.',
    });
  }

  try {
    const [rows] = await db.query(
      `SELECT o.id, o.order_code, o.user_id, o.package_id, o.amount, o.status,
              o.payment_method, o.expires_at, o.paid_at, o.created_at
       FROM orders o
       WHERE o.order_code = ?`,
      [orderCode]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đơn hàng.',
      });
    }

    const order = rows[0];

    // Chỉ cho phép xem đơn của chính mình hoặc admin (kiểm tra vai trò từ DB)
    if (order.user_id !== req.user.id) {
      const isAdmin = await checkIsAdmin(req.user.id);
      if (!isAdmin) {
        // Trả 404 để không để lộ sự tồn tại của đơn hàng người khác
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy đơn hàng.',
        });
      }
    }

    const pkg = getPackageById(order.package_id);
    // Cổng thanh toán đang tắt → không trả thông tin tài khoản / mã QR (tránh chuyển nhầm vào tài khoản giữ chỗ)
    const paymentsOn = isPaymentConfigured();
    const bankBin = paymentsOn ? process.env.BANK_BIN || '' : '';
    const bankAccount = paymentsOn ? process.env.BANK_ACCOUNT || '' : '';
    const bankName = paymentsOn ? process.env.BANK_NAME || '' : '';

    const qrUrl = paymentsOn
      ? buildQrUrl({
          bin: bankBin,
          account: bankAccount,
          amount: order.amount,
          orderCode: order.order_code,
          accountName: bankName,
        })
      : '';

    return res.json({
      success: true,
      data: {
        id: order.id,
        orderCode: order.order_code,
        packageId: order.package_id,
        packageName: pkg ? pkg.name : order.package_id,
        amount: order.amount,
        status: order.status,
        paymentMethod: order.payment_method,
        expiresAt: order.expires_at,
        paidAt: order.paid_at,
        createdAt: order.created_at,
        qr: {
          accountNumber: bankAccount,
          accountName: bankName,
          bankBin,
          content: order.order_code,
          amount: order.amount,
          qrUrl,
        },
      },
    });
  } catch (err) {
    console.error('❌ Lỗi getOrder:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

/**
 * POST /api/payments/orders/:orderCode/cancel
 * Hủy đơn hàng đang chờ thanh toán
 */
async function cancelOrder(req, res) {
  if (!req.user?.id) {
    return res.status(401).json({
      success: false,
      message: 'Bạn cần đăng nhập.',
    });
  }

  const { orderCode } = req.params;
  if (!orderCode) {
    return res.status(400).json({
      success: false,
      message: 'Thiếu mã đơn hàng.',
    });
  }

  try {
    const [rows] = await db.query(
      'SELECT id, user_id, status FROM orders WHERE order_code = ?',
      [orderCode]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đơn hàng.',
      });
    }

    const order = rows[0];

    // Chỉ cho phép hủy đơn của chính mình hoặc admin (kiểm tra vai trò từ DB)
    if (order.user_id !== req.user.id) {
      const isAdmin = await checkIsAdmin(req.user.id);
      if (!isAdmin) {
        // Trả 404 để không để lộ sự tồn tại của đơn hàng
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy đơn hàng.',
        });
      }
    }

    if (order.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Không thể hủy đơn hàng có trạng thái "${order.status}".`,
      });
    }

    await db.query(
      "UPDATE orders SET status = 'cancelled' WHERE id = ?",
      [order.id]
    );

    return res.json({
      success: true,
      message: 'Đã hủy đơn hàng thành công.',
    });
  } catch (err) {
    console.error('❌ Lỗi cancelOrder:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

// ── Webhook helper handlers để tối ưu Cognitive Complexity ───────

async function handleNoOrder(conn, tx, txDate) {
  await conn.query(
    `INSERT INTO payment_transactions
       (provider, provider_tx_id, amount_in, content, account_number, transaction_date, raw_payload, match_status)
     VALUES (?, ?, ?, ?, ?, COALESCE(?, NOW()), ?, 'no_order')`,
    [
      tx.provider,
      tx.id,
      tx.amountIn,
      tx.content || null,
      tx.accountNumber || null,
      txDate,
      JSON.stringify(tx.rawPayload),
    ]
  );
  await conn.commit();
}

async function handlePaidDuplicate(conn, tx, order, txDate) {
  console.warn(`⚠️ Đơn hàng ${order.order_code} đã ở trạng thái paid nhưng nhận thêm giao dịch #${tx.id} (${tx.amountIn}đ)!`);
  await conn.query(
    `INSERT INTO payment_transactions
       (provider, provider_tx_id, order_id, amount_in, content, account_number, transaction_date, raw_payload, match_status)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), ?, 'duplicate')`,
    [
      tx.provider,
      tx.id,
      order.id,
      tx.amountIn,
      tx.content || null,
      tx.accountNumber || null,
      txDate,
      JSON.stringify(tx.rawPayload),
    ]
  );
  await conn.commit();
}

async function handleUnderpaid(conn, tx, order, txDate) {
  await conn.query(
    `INSERT INTO payment_transactions
       (provider, provider_tx_id, order_id, amount_in, content, account_number, transaction_date, raw_payload, match_status)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), ?, 'underpaid')`,
    [
      tx.provider,
      tx.id,
      order.id,
      tx.amountIn,
      tx.content || null,
      tx.accountNumber || null,
      txDate,
      JSON.stringify(tx.rawPayload),
    ]
  );

  if (order.status === 'pending') {
    await conn.query(
      "UPDATE orders SET status = 'underpaid' WHERE id = ?",
      [order.id]
    );
  }
  await conn.commit();
}

async function handleMatched(conn, tx, order, txDate, orderCode) {
  if (order.status === 'cancelled') {
    console.warn(`⚠️ Tiền thật đã vào cho đơn hàng đã hủy ${orderCode} (User #${order.user_id}). Hệ thống vẫn kích hoạt quyền cho người dùng.`);
  }

  await conn.query(
    `INSERT INTO payment_transactions
       (provider, provider_tx_id, order_id, amount_in, content, account_number, transaction_date, raw_payload, match_status)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), ?, 'matched')`,
    [
      tx.provider,
      tx.id,
      order.id,
      tx.amountIn,
      tx.content || null,
      tx.accountNumber || null,
      txDate,
      JSON.stringify(tx.rawPayload),
    ]
  );

  await conn.query(
    "UPDATE orders SET status = 'paid', paid_at = NOW() WHERE id = ?",
    [order.id]
  );

  await conn.query(
    `INSERT INTO user_entitlements (user_id, package_id, order_id, source, granted_at, expires_at)
     VALUES (?, ?, ?, 'purchase', NOW(), NULL)
     ON CONFLICT (user_id, package_id) DO UPDATE SET
       order_id = EXCLUDED.order_id,
       source = 'purchase',
       granted_at = NOW(),
       expires_at = NULL`,
    [order.user_id, order.package_id, order.id]
  );

  await conn.commit();
  invalidateEntitlementCache(order.user_id);

  console.log(`🎉 [DUYỆT ĐƠN THÀNH CÔNG]: Mã đơn ${orderCode} đã kích hoạt gói "${order.package_id}" vĩnh viễn cho User #${order.user_id}!`);

  setImmediate(async () => {
    try {
      const [userRows] = await db.query(
        'SELECT username, email FROM users WHERE id = ?',
        [order.user_id]
      );
      if (userRows.length > 0) {
        const emailPkg = getPackageById(order.package_id);
        await sendPackageActivatedEmail(userRows[0].email, userRows[0].username, order, emailPkg);
      }
    } catch (mailErr) {
      console.error('⚠️ Không thể gửi email kích hoạt gói:', mailErr.message);
    }
  });
}

/**
 * Kiểm tra và giải mã request webhook đầu vào
 */
function parseAndValidateWebhook(req, res) {
  const providerName = (req.params.provider || 'sepay').toLowerCase();
  const adapter = providers[providerName];

  if (!adapter) {
    res.status(400).json({
      success: false,
      message: `Nhà cung cấp webhook "${providerName}" không được hỗ trợ.`,
    });
    return null;
  }

  const hasWebhookSecret = Boolean(process.env.SEPAY_API_KEY || process.env.PAYMENT_WEBHOOK_SECRET);
  if (!hasWebhookSecret) {
    console.error('❌ SEPAY_API_KEY chưa được cấu hình. Từ chối webhook (503 Service Unavailable).');
    res.status(503).json({
      success: false,
      message: 'Webhook endpoint chưa được kích hoạt hoặc cấu hình khóa bảo mật.',
    });
    return null;
  }

  if (!adapter.verifyRequest(req)) {
    res.status(403).json({
      success: false,
      message: 'Webhook authentication failed.',
    });
    return null;
  }

  const tx = adapter.parseTransaction(req);
  if (tx.error) {
    res.status(400).json({
      success: false,
      error: tx.error,
      message: tx.message,
    });
    return null;
  }

  return tx;
}

/**
 * POST /api/payments/webhook/:provider (hoặc POST /api/payments/webhook)
 * Nhận webhook từ cổng thanh toán (SePay, Casso)
 */
async function webhook(req, res) {
  const tx = parseAndValidateWebhook(req, res);
  if (!tx) return;

  if (!tx.isMoneyIn) {
    return res.json({
      success: true,
      ignored: true,
      message: 'Bỏ qua giao dịch tiền ra.',
    });
  }

  console.log(`\n🔔 [SEPAY WEBHOOK]: +${tx.amountIn?.toLocaleString('vi-VN')} đ | Nội dung: "${tx.content}" | TxID: ${tx.id}`);

  let orderCode = extractOrderCode(tx.content);
  if (!orderCode && tx.sepayCode) {
    orderCode = extractOrderCode(tx.sepayCode);
  }

  let conn;
  try {
    conn = await db.getConnection();
  } catch (dbErr) {
    console.error('❌ Lỗi kết nối PostgreSQL khi nhận webhook:', dbErr.message);
    return res.status(500).json({
      success: false,
      message: 'Lỗi kết nối cơ sở dữ liệu khi xử lý webhook.',
    });
  }

  try {
    await conn.beginTransaction();

    const [existing] = await conn.query(
      'SELECT id, match_status FROM payment_transactions WHERE provider = ? AND provider_tx_id = ?',
      [tx.provider, tx.id]
    );

    if (existing.length > 0) {
      await conn.rollback();
      return res.json({
        success: true,
        data: { match_status: existing[0].match_status, duplicate: true },
      });
    }

    const txDate = tx.transactionDate ? new Date(tx.transactionDate) : null;

    if (!orderCode) {
      await handleNoOrder(conn, tx, txDate);
      return res.json({ success: true, data: { match_status: 'no_order' } });
    }

    const [orders] = await conn.query(
      'SELECT * FROM orders WHERE order_code = ? FOR UPDATE',
      [orderCode]
    );

    if (orders.length === 0) {
      await handleNoOrder(conn, tx, txDate);
      return res.json({ success: true, data: { match_status: 'no_order' } });
    }

    const order = orders[0];

    if (order.status === 'paid') {
      await handlePaidDuplicate(conn, tx, order, txDate);
      return res.json({
        success: true,
        data: { match_status: 'duplicate', duplicate: true, message: 'Đơn hàng đã được thanh toán hoàn tất trước đó.' },
      });
    }

    const [prevTxRows] = await conn.query(
      `SELECT COALESCE(SUM(amount_in), 0) AS total_paid
       FROM payment_transactions
       WHERE order_id = ? AND match_status IN ('matched', 'underpaid')`,
      [order.id]
    );
    const previouslyPaid = Number(prevTxRows[0].total_paid) || 0;
    const totalAccumulated = previouslyPaid + tx.amountIn;

    if (totalAccumulated < order.amount) {
      await handleUnderpaid(conn, tx, order, txDate);
      return res.json({
        success: true,
        data: {
          match_status: 'underpaid',
          orderId: order.id,
          accumulated: totalAccumulated,
          required: order.amount,
        },
      });
    }

    await handleMatched(conn, tx, order, txDate, orderCode);
    return res.json({
      success: true,
      data: {
        match_status: 'matched',
        orderId: order.id,
        orderCode: order.order_code,
        packageId: order.package_id,
      },
    });
  } catch (txErr) {
    await conn.rollback();
    if (db.isDuplicateError(txErr)) {
      console.warn(`⚠️ Webhook trùng lặp song song (duplicate key Tx #${tx.id}) - đã rollback an toàn.`);
      return res.json({ success: true, duplicate: true });
    }

    console.error('❌ Lỗi transaction trong webhook:', txErr);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ khi xử lý giao dịch.',
    });
  } finally {
    conn.release();
  }
}

// ── Job dọn đơn hết hạn định kỳ 5 phút/lần ─────────────────────
let cleanupInterval = null;
function startOrderCleanupJob() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(async () => {
    try {
      const [res] = await db.query(
        "UPDATE orders SET status = 'expired' WHERE status = 'pending' AND expires_at < NOW()"
      );
      if (res.affectedRows > 0) {
        console.log(`🧹 [Orders Cleanup] Đã cập nhật ${res.affectedRows} đơn hàng hết hạn.`);
      }
    } catch (err) {
      console.error('❌ Lỗi job dọn đơn hết hạn:', err.message);
    }
  }, 5 * 60 * 1000);
}

module.exports = {
  createOrder,
  listOrders,
  getOrder,
  cancelOrder,
  webhook,
  startOrderCleanupJob,
};
