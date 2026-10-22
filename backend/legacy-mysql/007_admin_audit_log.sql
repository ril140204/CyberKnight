-- ============================================
-- SIGMABLOOM - Migration 007: Admin Audit Log
-- ============================================
-- Tables: admin_audit_log
-- Idempotent: CREATE TABLE IF NOT EXISTS
-- Charset/Engine: utf8mb4 / utf8mb4_unicode_ci / InnoDB

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id              BIGINT       AUTO_INCREMENT PRIMARY KEY,
  admin_id        INT          NOT NULL COMMENT 'FK về users(id) của admin thao tác',
  action          VARCHAR(50)  NOT NULL COMMENT 'Hành động: grant_package, revoke_package, etc.',
  target_user_id  INT          NOT NULL COMMENT 'FK về users(id) của user được tác động',
  package_id      VARCHAR(30)  NULL COMMENT 'ID gói nếu là thao tác cấp quyền',
  reason          VARCHAR(255) NULL COMMENT 'Lý do thao tác',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,

  INDEX idx_audit_admin  (admin_id, created_at),
  INDEX idx_audit_target (target_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
