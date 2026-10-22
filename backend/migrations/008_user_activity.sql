-- ============================================
-- SIGMABLOOM - Migration 008: User Activity (Online Time)
-- ============================================
-- Mục đích: Lưu TỔNG THỜI GIAN ONLINE của từng người dùng.
--   - user_activity        : tổng số giây online (cộng dồn) + mốc heartbeat gần nhất
--   - user_activity_daily  : thống kê theo ngày (dự phòng cho báo cáo sau này)
--
-- Nguyên tắc bảo mật (anti-cheat):
--   - Client KHÔNG gửi thời lượng. Client chỉ báo "tôi còn sống" (heartbeat).
--   - Server tự tính delta = NOW() - last_heartbeat_at rồi mới cộng.
--   - Dữ liệu chỉ là số giây + mốc thời gian, KHÔNG lưu IP / User-Agent /
--     nội dung tương tác (bảo mật dữ liệu trẻ em - NĐ 13/2023).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS (chạy lại nhiều lần vẫn an toàn)
-- Style: match migration 007
-- ============================================

-- 1. Tổng thời gian online toàn hệ thống
CREATE TABLE IF NOT EXISTS user_activity (
  user_id            INT            NOT NULL COMMENT 'FK về users(id)',
  total_seconds      BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Tổng số giây online đã cộng dồn',
  last_heartbeat_at  DATETIME       NULL COMMENT 'Lần heartbeat hợp lệ gần nhất',
  first_seen_at      DATETIME       NULL COMMENT 'Lần đầu tiên gửi heartbeat',
  updated_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

  -- Truy vấn admin: sắp xếp theo thời gian online
  INDEX idx_activity_total  (total_seconds),
  -- Truy vấn admin: lọc user đang online (last_heartbeat_at gần đây)
  INDEX idx_activity_heartbeat (last_heartbeat_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Thống kê theo ngày (dự phòng — đã cộng trong cùng transaction với bảng trên)
CREATE TABLE IF NOT EXISTS user_activity_daily (
  user_id   INT     NOT NULL,
  day       DATE    NOT NULL COMMENT 'Ngày tính theo giờ máy chủ (NOW())',
  seconds   INT     NOT NULL DEFAULT 0,

  PRIMARY KEY (user_id, day),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

  -- Báo cáo tổng theo ngày
  INDEX idx_activity_daily_day (day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Marker
-- ============================================
SELECT 'Migration 008 OK' AS status;