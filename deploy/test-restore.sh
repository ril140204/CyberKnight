#!/usr/bin/env bash
# ============================================================
# CyberKnight / Sigmabloom — Test restore (chạy trong cron hoặc thủ công)
#
# Cách dùng:
#   bash deploy/test-restore.sh
#   bash deploy/test-restore.sh backups/sigmabloom-2025-01-15_030000.sql.gz
#
# Luôn restore vào DB test sigmabloom_restore_test.
# In "OK" nếu restore thành công, "FAIL" + exit 1 nếu thất bại.
# ============================================================

set -euo pipefail

BACKUP_DIR="/var/backups/cyberknight"
TEST_DB="sigmabloom_restore_test"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# Chọn file mới nhất nếu không truyền argument
if [ $# -ge 1 ]; then
  BACKUP_FILE="$1"
else
  echo "Tìm file backup mới nhất trong $BACKUP_DIR..."
  # shellcheck disable=SC2012
  BACKUP_FILE=$(ls -t "$BACKUP_DIR"/sigmabloom-*.sql.gz 2>/dev/null | head -1 || true)
fi

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  log "FAIL — Không tìm thấy file backup: $BACKUP_FILE"
  exit 1
fi

log "File backup: $BACKUP_FILE"
log "Target DB:   $TEST_DB"

# Tạo DB test nếu chưa có
mysql -e "CREATE DATABASE IF NOT EXISTS \`$TEST_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# Restore
if ! zcat "$BACKUP_FILE" | mysql "$TEST_DB" 2>/dev/null; then
  log "FAIL — mysql restore thất bại."
  exit 1
fi

# Verify: đếm số bảng
TABLE_COUNT=$(mysql -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TEST_DB';")
if [ "$TABLE_COUNT" -gt 0 ]; then
  log "OK — Restore thành công. ($TABLE_COUNT bảng trong $TEST_DB)"
  exit 0
else
  log "FAIL — Restore xong nhưng DB rỗng."
  exit 1
fi
