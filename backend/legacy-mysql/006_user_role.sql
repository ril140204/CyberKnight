-- ============================================
-- SIGMABLOOM - Migration 006: User Role
-- ============================================
-- Thêm cột 'role' vào bảng users và set admin mặc định
-- Idempotent: kiểm tra INFORMATION_SCHEMA trước khi ALTER
-- Style: match migration 002 (PREPARE/EXECUTE pattern)

-- =============================================
-- 1. Thêm cột role vào bảng users (idempotent)
-- =============================================
SET @dbname = DATABASE();
SET @tablename = 'users';
SET @columnname = 'role';

SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME   = @tablename
      AND COLUMN_NAME  = @columnname
  ) > 0,
  'SELECT 1',
  'ALTER TABLE users ADD COLUMN role ENUM(\'user\',\'admin\') NOT NULL DEFAULT \'user\''
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =============================================
-- 2. Set role=admin cho user 'admin' (idempotent)
-- =============================================
-- Dùng UPDATE trực tiếp — nếu username 'admin' chưa có thì 0 rows affected (OK)
UPDATE users SET role = 'admin' WHERE username = 'admin';

-- =============================================
-- Marker
-- =============================================
SELECT 'Migration 006 OK' AS status;
