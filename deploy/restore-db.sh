#!/usr/bin/env bash
# ============================================================
# CyberKnight / Sigmabloom — Script khôi phục cơ sở dữ liệu MySQL
#
# Mặc định khôi phục vào CƠ SỞ DỮ LIỆU THỬ NGHIỆM `sigmabloom_restore_test`
# để tránh vô tình ghi đè dữ liệu production.
#
# Yêu cầu: user sigmabloom_backup hoặc sigmabloom_migrate trong ~/.my.cnf
#
# Cách dùng:
#   # Xem trước (dry-run — chỉ đọc, không ghi):
#   bash deploy/restore-db.sh backups/sigmabloom-2025-01-15_030000.sql.gz
#
#   # Khôi phục vào DB thử nghiệm (mặc định):
#   bash deploy/restore-db.sh backups/sigmabloom-2025-01-15_030000.sql.gz
#
#   # Khôi phục vào production (CẦN --force):
#   bash deploy/restore-db.sh backups/sigmabloom-2025-01-15_030000.sql.gz --force
# ============================================================

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Cách dùng: $0 <file.sql.gz> [--force]"
  echo ""
  echo "Ví dụ:"
  echo "  $0 backups/sigmabloom-2025-01-15_030000.sql.gz      # Khôi phục vào DB thử nghiệm"
  echo "  $0 backups/sigmabloom-2025-01-15_030000.sql.gz --force  # Khôi phục vào production"
  exit 1
fi

BACKUP_FILE="$1"
FORCE=0
if [ "$2" = "--force" ]; then
  FORCE=1
fi

# Kiểm tra file tồn tại
if [ ! -f "$BACKUP_FILE" ]; then
  echo "LỖI: File không tồn tại: $BACKUP_FILE"
  exit 1
fi

TEST_DB="sigmabloom_restore_test"
PROD_DB="sigmabloom"

# Chọn target DB
if [ "$FORCE" = "1" ]; then
  TARGET_DB="$PROD_DB"
  echo "⚠️  CẢNH BÁO: Khôi phục vào PRODUCTION DB '$PROD_DB' (--force đã bật)"
  echo "   Nhấn Ctrl+C trong 5 giây để hủy..."
  sleep 5
else
  TARGET_DB="$TEST_DB"
  echo "ℹ️  Khôi phục vào DB thử nghiệm '$TEST_DB'"
fi

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# Nếu khôi phục vào DB thử nghiệm, tạo mới (hoặc DROP+CREATE)
if [ "$TARGET_DB" = "$TEST_DB" ]; then
  log "Tạo DB thử nghiệm '$TEST_DB' nếu chưa có..."
  mysql -e "CREATE DATABASE IF NOT EXISTS \`$TEST_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
fi

log "Bắt đầu khôi phục từ: $BACKUP_FILE"
log "Target database: $TARGET_DB"

# Khôi phục
zcat "$BACKUP_FILE" | mysql "$TARGET_DB"

log "OK — Đã khôi phục thành công vào '$TARGET_DB'"
log "Kiểm tra: mysql -e \"USE $TARGET_DB; SHOW TABLES;\""
