#!/usr/bin/env bash
# ============================================================
# CyberKnight / Sigmabloom — Test restore (cron hằng tuần hoặc thủ công)
#
# Cách dùng:
#   bash deploy/test-restore.sh                       # file .dump mới nhất
#   bash deploy/test-restore.sh /path/to/file.dump
#
# Khôi phục vào schema thử nghiệm "<DB_SCHEMA>_restore_test" trên Supabase,
# đếm bảng/users để xác nhận, rồi XOÁ schema thử nghiệm.
# In "OK" nếu thành công, "FAIL" + exit 1 nếu thất bại.
# ============================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/cyberknight}"
REPO_PATH="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_PATH/backend/.env}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
getenv() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

if [ $# -ge 1 ]; then
  BACKUP_FILE="$1"
else
  # shellcheck disable=SC2012
  BACKUP_FILE=$(ls -t "$BACKUP_DIR"/cyberknight-*.dump 2>/dev/null | head -1 || true)
fi

if [ -z "${BACKUP_FILE:-}" ] || [ ! -f "$BACKUP_FILE" ]; then
  log "FAIL — Không tìm thấy file backup trong $BACKUP_DIR"
  exit 1
fi

DB_URL="$(getenv DIRECT_URL)"; [ -n "$DB_URL" ] || DB_URL="$(getenv DATABASE_URL)"
SCHEMA="$(getenv DB_SCHEMA)"; SCHEMA="${SCHEMA:-local}"
TEST_SCHEMA="${SCHEMA}_restore_test"

log "File backup: $BACKUP_FILE"
if ! bash "$REPO_PATH/deploy/restore-db.sh" "$BACKUP_FILE"; then
  log "FAIL — restore-db.sh thất bại."
  exit 1
fi

TABLE_COUNT=$(psql "$DB_URL" -At -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TEST_SCHEMA';" 2>/dev/null || echo 0)
psql "$DB_URL" -q -c "DROP SCHEMA IF EXISTS \"$TEST_SCHEMA\" CASCADE;" >/dev/null 2>&1 || true

if [ "${TABLE_COUNT:-0}" -gt 0 ]; then
  log "OK — Restore thử thành công ($TABLE_COUNT bảng). Đã xoá schema thử nghiệm."
  exit 0
fi
log "FAIL — Restore xong nhưng schema thử nghiệm rỗng."
exit 1
