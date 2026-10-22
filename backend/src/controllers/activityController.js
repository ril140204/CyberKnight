/**
 * Controller cho Activity — Theo dõi TỔNG THỜI GIAN ONLINE của người dùng
 *
 * Endpoint:
 * - POST /api/me/activity/heartbeat — Client báo "tôi còn sống", SERVER tự tính thời gian
 *
 * ── Triết lý chống gian lận (anti-cheat) ──────────────────────────────────
 * 1. TUYỆT ĐỐI KHÔNG tin con số thời lượng do client gửi lên.
 *    Client KHÔNG gửi body (chỉ gọi endpoint), server tự tính:
 *        delta = NOW() - last_heartbeat_at
 * 2. Quy tắc cộng (làm tròn xuống giây, cap cứng):
 *      - delta <  20s  → bỏ qua (chống spam / mở nhiều tab cùng lúc)
 *      - 20s <= delta <= 90s → cộng delta, nhưng tối đa 60s mỗi nhịp
 *      - delta >  90s  → coi là PHIÊN MỚI: không cộng khoảng hở,
 *                          chỉ cộng tối đa 30s cho nhịp đầu tiên của phiên
 * 3. Toàn bộ thao tác nằm trong 1 transaction với `SELECT ... FOR UPDATE`
 *    (pessimistic locking — cùng style với paymentController.js) nên
 *    KHÔNG có race condition khi 2 request đến cùng lúc.
 * 4. Chỉ lưu số giây + mốc thời gian. KHÔNG lưu IP / User-Agent / nội dung
 *    tương tác (bảo mật dữ liệu trẻ em — NĐ 13/2023).
 *
 * Quyết định thiết kế: tính thời gian cho MỌI tài khoản (kể cả admin)
 * để đơn giản và nhất quán; admin chỉ là 1 người dùng nhưng bao giờ.
 *
 * Author: Senior Full-Stack Developer
 */

'use strict';

const db = require('../config/db');

// ── Hằng số quy tắc cộng thời gian (đổi ở đây là đổi toàn hệ thống) ──────
const MIN_DELTA_SECONDS = 20;        // < 20s → bỏ qua (spam / nhiều tab)
const MAX_SESSION_GAP_SECONDS = 90;  // > 90s → phiên mới (không cộng khoảng hở)
const MAX_ADD_PER_HEARTBEAT = 60;    // Cap cứng mỗi nhịp khi đang phiên liên tục
const NEW_SESSION_BONUS_SECONDS = 30; // Thưởng tối đa cho nhịp đầu của phiên mới

/**
 * Ép BIGINT (mysql2 có thể trả string) về Number an toàn
 * @param {*} v
 * @returns {number}
 */
function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Mã lỗi InnoDB: 1213 = deadlock, 1205 = lock wait timeout
// Cả hai đều xảy ra khi 2 heartbeat của CÙNG một user tranh nhau tạo dòng
const ER_LOCK_DEADLOCK = 1213;
const ER_LOCK_WAIT_TIMEOUT = 1205;
const MAX_TX_RETRIES = 3;

/**
 * Chạy một khối transaction, tự thử lại nếu gặp deadlock / lock timeout.
 * Việc serialize thật sự vẫn do khoá X trên dòng user_activity đảm bảo.
 *
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<*>} fn
 * @returns {Promise<*>}
 */
async function withTransactionRetry(fn) {
  let conn;
  try {
    for (let attempt = 1; attempt <= MAX_TX_RETRIES; attempt++) {
      conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        const result = await fn(conn);
        await conn.commit();
        return result;
      } catch (err) {
        try { await conn.rollback(); } catch (_) { /* im lặng */ }
        const isRetryable = err && (err.errno === ER_LOCK_DEADLOCK || err.errno === ER_LOCK_WAIT_TIMEOUT);
        if (!isRetryable || attempt === MAX_TX_RETRIES) throw err;
        // Nghỉ ngắn rồi thử lại (backoff tuyến tính)
        await new Promise(r => setTimeout(r, 20 * attempt));
      } finally {
        conn.release();
        conn = null;
      }
    }
    throw new Error('Không thể hoàn tất transaction activity.');
  } finally {
    if (conn) conn.release();
  }
}

/**
 * POST /api/me/activity/heartbeat
 *
 * Không nhận body. Trả về tổng thời gian online sau khi cộng.
 * @param {object} req
 * @param {object} res
 */
async function heartbeat(req, res) {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Bạn cần đăng nhập để ghi nhận thời gian sử dụng.',
    });
  }

  try {
    const result = await withTransactionRetry(async (conn) => {
      // 1. Bảo đảm dòng dữ liệu tồn tại (INSERT IGNORE chống lỗi trùng khóa khi
      //    2 request đồng thời tới lần đầu tiên của cùng một user).
      //    Lưu ý: INSERT IGNORE trên PRIMARY KEY có thể tạo gap-lock; nếu bị
      //    deadlock (errno 1213) hoặc lock timeout (1205) thì withTransactionRetry
      //    tự thử lại — lần chạy lại sẽ đi vào nhánh "dòng đã tồn tại" dưới đây.
      await conn.query(
        `INSERT IGNORE INTO user_activity (user_id, total_seconds, last_heartbeat_at, first_seen_at)
         VALUES (?, 0, NULL, NULL)`,
        [userId]
      );

      // 2. Khoá pessimistic — chặn request song song cho tới khi commit
      const [rows] = await conn.query(
        `SELECT total_seconds,
                last_heartbeat_at,
                first_seen_at,
                TIMESTAMPDIFF(SECOND, last_heartbeat_at, NOW()) AS delta_seconds
         FROM user_activity
         WHERE user_id = ?
         FOR UPDATE`,
        [userId]
      );

      const row = rows[0];
      const delta = row.last_heartbeat_at === null ? null : toInt(row.delta_seconds);

      let addedSeconds = 0;
      let reason;

      if (delta === null) {
        // ── Nhịp đầu tiên của phiên đầu tiên: KHÔNG cộng (tránh bơm số giây ảo)
        reason = 'first_seen';
        await conn.query(
          `UPDATE user_activity
           SET first_seen_at = COALESCE(first_seen_at, NOW()),
               last_heartbeat_at = NOW()
           WHERE user_id = ?`,
          [userId]
        );
      } else if (delta < 0) {
        // Lệch đồng hồ (hiếm gặp): giữ nguyên mốc cũ, không cộng
        reason = 'clock_skipped';
      } else if (delta < MIN_DELTA_SECONDS) {
        // Quá sớm so với nhịp 30s (spam / nhiều tab): chỉ chốt mốc thời gian
        reason = 'too_soon';
        await conn.query(
          'UPDATE user_activity SET last_heartbeat_at = NOW() WHERE user_id = ?',
          [userId]
        );
      } else {
        // ── Tính số giây được phép cộng
        addedSeconds = delta > MAX_SESSION_GAP_SECONDS
          ? NEW_SESSION_BONUS_SECONDS
          : Math.min(delta, MAX_ADD_PER_HEARTBEAT);

        reason = delta > MAX_SESSION_GAP_SECONDS ? 'new_session' : 'counted';

        await conn.query(
          `UPDATE user_activity
           SET total_seconds = total_seconds + ?,
               first_seen_at = COALESCE(first_seen_at, NOW()),
               last_heartbeat_at = NOW()
           WHERE user_id = ?`,
          [addedSeconds, userId]
        );

        // 3. Cộng song song vào bảng thống kê theo ngày (cùng transaction)
        if (addedSeconds > 0) {
          await conn.query(
            `INSERT INTO user_activity_daily (user_id, day, seconds)
             VALUES (?, CURDATE(), ?)
             ON DUPLICATE KEY UPDATE seconds = seconds + VALUES(seconds)`,
            [userId, addedSeconds]
          );
        }
      }

      const [finalRows] = await conn.query(
        'SELECT total_seconds FROM user_activity WHERE user_id = ?',
        [userId]
      );

      return {
        totalSeconds: toInt(finalRows[0].total_seconds),
        addedSeconds,
        reason,
      };
    });

    return res.json({
      success: true,
      message: 'Đã ghi nhận thời gian sử dụng.',
      data: result,
    });
  } catch (err) {
    console.error('❌ Lỗi heartbeat activity:', err.code || '', err.message);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ khi ghi nhận thời gian sử dụng.',
    });
  }
}

/**
 * GET /api/me/activity/me — tự xem thời gian online của chính mình (tiện ích/debug)
 * @param {object} req
 * @param {object} res
 */
async function getMyActivity(req, res) {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Bạn cần đăng nhập để xem thời gian sử dụng.',
    });
  }

  try {
    const [rows] = await db.query(
      `SELECT total_seconds, last_heartbeat_at, first_seen_at,
              TIMESTAMPDIFF(SECOND, last_heartbeat_at, NOW()) AS seconds_since_heartbeat
       FROM user_activity WHERE user_id = ?`,
      [userId]
    );

    const row = rows[0];
    return res.json({
      success: true,
      message: 'Thông tin thời gian sử dụng.',
      data: {
        totalSeconds: row ? toInt(row.total_seconds) : 0,
        lastHeartbeatAt: row ? row.last_heartbeat_at : null,
        firstSeenAt: row ? row.first_seen_at : null,
        isOnlineNow: Boolean(row && toInt(row.seconds_since_heartbeat) <= MAX_SESSION_GAP_SECONDS),
      },
    });
  } catch (err) {
    console.error('❌ Lỗi getMyActivity:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ.',
    });
  }
}

module.exports = {
  heartbeat,
  getMyActivity,
  withTransactionRetry,
  MIN_DELTA_SECONDS,
  MAX_SESSION_GAP_SECONDS,
  MAX_ADD_PER_HEARTBEAT,
  NEW_SESSION_BONUS_SECONDS,
};