-- ============================================
-- SIGMABLOOM — Migration 008: User Activity (Online Time) — PostgreSQL
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
-- PostgreSQL: dùng TIMESTAMPTZ + trigger set_updated_at() (định nghĩa ở
-- migration 001) thay cho MySQL ON UPDATE CURRENT_TIMESTAMP.
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE TRIGGER.
-- ============================================

-- 1. Tổng thời gian online toàn hệ thống
CREATE TABLE IF NOT EXISTS user_activity (
  user_id            INTEGER      NOT NULL,
  total_seconds      BIGINT       NOT NULL DEFAULT 0,
  last_heartbeat_at  TIMESTAMPTZ  NULL,
  first_seen_at      TIMESTAMPTZ  NULL,
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Truy vấn admin: sắp xếp theo thời gian online / lọc user đang online
CREATE INDEX IF NOT EXISTS idx_activity_total     ON user_activity (total_seconds);
CREATE INDEX IF NOT EXISTS idx_activity_heartbeat ON user_activity (last_heartbeat_at);

-- updated_at tự cập nhật mỗi lần heartbeat ghi vào (thay ON UPDATE của MySQL)
CREATE OR REPLACE TRIGGER trg_user_activity_updated_at
BEFORE UPDATE ON user_activity
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 2. Thống kê theo ngày (dự phòng — cộng trong cùng transaction với bảng trên)
CREATE TABLE IF NOT EXISTS user_activity_daily (
  user_id   INTEGER     NOT NULL,
  day       DATE        NOT NULL,
  seconds   INTEGER     NOT NULL DEFAULT 0,

  PRIMARY KEY (user_id, day),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Báo cáo tổng theo ngày
CREATE INDEX IF NOT EXISTS idx_activity_daily_day ON user_activity_daily (day);

-- ============================================
-- Marker
-- ============================================
SELECT 'Migration 008 OK' AS status;