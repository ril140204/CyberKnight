-- ============================================
-- SIGMABLOOM - CyberKnight Database Schema
-- Chạy file này trong MySQL để tạo database
-- ============================================

CREATE DATABASE IF NOT EXISTS sigmabloom
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE sigmabloom;

-- Bảng người dùng
CREATE TABLE IF NOT EXISTS users (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  first_name  VARCHAR(100)        NOT NULL,
  last_name   VARCHAR(100)        NOT NULL,
  username    VARCHAR(50)         NOT NULL UNIQUE,
  email       VARCHAR(255)        NOT NULL UNIQUE,
  password    VARCHAR(255)        NOT NULL,   -- bcrypt hash
  birth_year  YEAR                NULL,
  level       VARCHAR(50)         DEFAULT 'Rookie',
  points      INT                 DEFAULT 0,
  avatar_url  VARCHAR(500)        NULL,
  is_active   TINYINT(1)          DEFAULT 1,
  created_at  DATETIME            DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME            DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login  DATETIME            NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Bảng refresh token (để hỗ trợ logout an toàn)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT          NOT NULL,
  token       VARCHAR(512) NOT NULL UNIQUE,
  expires_at  DATETIME     NOT NULL,
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Index để tăng tốc tìm kiếm
CREATE INDEX idx_users_email    ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_refresh_token  ON refresh_tokens(token);

-- Bảng tổng thời gian online của người dùng (migration 008)
-- Chỉ lưu số giây + mốc thời gian, KHÔNG lưu IP/User-Agent/nội dung tương tác.
CREATE TABLE IF NOT EXISTS user_activity (
  user_id            INT             NOT NULL,
  total_seconds      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_heartbeat_at  DATETIME        NULL,
  first_seen_at      DATETIME        NULL,
  updated_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_activity_total     (total_seconds),
  INDEX idx_activity_heartbeat (last_heartbeat_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Bảng thống kê thời gian online theo ngày (migration 008)
CREATE TABLE IF NOT EXISTS user_activity_daily (
  user_id  INT NOT NULL,
  day      DATE NOT NULL,
  seconds  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_activity_daily_day (day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- NOTE: Tài khoản admin mẫu được tạo tự động bởi seed.js
-- (dùng biến môi trường ADMIN_PASSWORD, băm bcrypt cost 12)
-- File database.sql KHÔNG chứa INSERT admin cứng để tránh mâu thuẫn hash.
