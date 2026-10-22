-- ============================================
-- SIGMABLOOM - Migration 005: Payments & Entitlements
-- ============================================
-- Tables: orders, payment_transactions, user_entitlements
-- Idempotent: CREATE TABLE IF NOT EXISTS
-- Charset/Engine: utf8mb4 / utf8mb4_unicode_ci / InnoDB

-- =============================================
-- 1. Bảng orders — Lưu thông tin đơn hàng
-- =============================================
CREATE TABLE IF NOT EXISTS orders (
  id              BIGINT       AUTO_INCREMENT PRIMARY KEY,
  order_code      VARCHAR(20)  NOT NULL UNIQUE,
  user_id         INT          NOT NULL,
  package_id      VARCHAR(30)  NOT NULL,
  amount          INT          NOT NULL COMMENT 'Số tiền VND (integer)',
  status          ENUM('pending','paid','expired','cancelled','underpaid')
                              NOT NULL DEFAULT 'pending',
  payment_method  VARCHAR(30)  NOT NULL DEFAULT 'bank_qr',
  expires_at      DATETIME     NOT NULL COMMENT 'Hạn thanh toán',
  paid_at         DATETIME     NULL COMMENT 'Thời điểm thanh toán thành công',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Khóa ngoại
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

  -- Chỉ mục
  INDEX idx_orders_user_status  (user_id, status),
  INDEX idx_orders_status_expires (status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================
-- 2. Bảng payment_transactions — Log webhook từ ngân hàng
-- =============================================
CREATE TABLE IF NOT EXISTS payment_transactions (
  id                BIGINT       AUTO_INCREMENT PRIMARY KEY,
  provider          VARCHAR(20)  NOT NULL COMMENT 'Mã nhà cung cấp (vietcombank, momo, etc.)',
  provider_tx_id    VARCHAR(100) NOT NULL COMMENT 'ID giao dịch tại nhà cung cấp',
  order_id          BIGINT       NULL COMMENT 'FK về orders, NULL nếu chưa match',
  amount_in         INT          NOT NULL COMMENT 'Số tiền thực nhận (VND integer)',
  content           TEXT         NULL COMMENT 'Nội dung/memo chuyển khoản',
  account_number    VARCHAR(50)  NULL COMMENT 'Số tài khoản người chuyển',
  transaction_date  DATETIME     NULL COMMENT 'Thời điểm giao dịch tại ngân hàng',
  raw_payload       JSON         NULL COMMENT 'Toàn bộ payload gốc từ webhook',
  match_status     ENUM('matched','no_order','underpaid','duplicate','error')
                              NOT NULL DEFAULT 'error',
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- UNIQUE: chặn double-processing cùng một provider_tx_id
  UNIQUE KEY uniq_provider_tx (provider, provider_tx_id),

  -- Khóa ngoại: order bị xóa → set NULL (không cascade delete transaction)
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,

  -- Chỉ mục cho admin queries
  INDEX idx_tx_match_created (match_status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================
-- 3. Bảng user_entitlements — Quyền chơi của user
-- =============================================
CREATE TABLE IF NOT EXISTS user_entitlements (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT          NOT NULL,
  package_id  VARCHAR(30)  NOT NULL,
  order_id    BIGINT       NULL COMMENT 'FK về orders (NULL nếu admin grant)',
  source      ENUM('purchase','admin_grant') NOT NULL DEFAULT 'purchase',
  granted_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  DATETIME     NULL COMMENT 'NULL = vĩnh viễn',

  -- Khóa ngoại
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,

  -- Mỗi user chỉ có 1 entitlement per package
  UNIQUE KEY uniq_user_package (user_id, package_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
