#!/usr/bin/env bash
# ============================================================
# CyberKnight / Sigmabloom — Khôi phục PostgreSQL (Supabase) từ file .dump
#
# Mặc định khôi phục vào SCHEMA THỬ NGHIỆM "<DB_SCHEMA>_restore_test"
# (cùng database Supabase) để không đụng dữ liệu production.
#
# Cách dùng:
#   # Khôi phục vào schema thử nghiệm (mặc định):
#   bash deploy/restore-db.sh /var/backups/cyberknight/cyberknight-local-2026-10-19_030000.dump
#
#   # Khôi phục ĐÈ lên schema production (CẦN --force, có 5 giây để Ctrl+C):
#   bash deploy/restore-db.sh <file.dump> --force
#
# Yêu cầu: pg_restore + psql >= phiên bản server (postgresql-client-17),
#          backend/.env có DIRECT_URL (hoặc DATABASE_URL) và DB_SCHEMA.
# ============================================================

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Cách dùng: $0 <file.dump> [--force]"
  exit 1
fi

BACKUP_FILE="$1"
FORCE=0
if [ "${2:-}" = "--force" ]; then
  FORCE=1
fi

[ -f "$BACKUP_FILE" ] || { echo "LỖI: File không tồn tại: $BACKUP_FILE"; exit 1; }

REPO_PATH="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_PATH/backend/.env}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() { log "LỖI: $*"; exit 1; }
getenv() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

[ -f "$ENV_FILE" ] || die "Không tìm thấy $ENV_FILE"
command -v pg_restore >/dev/null || die "Thiếu pg_restore (apt install postgresql-client-17)"
command -v psql >/dev/null || die "Thiếu psql (apt install postgresql-client-17)"

DB_URL="$(getenv DIRECT_URL)"
[ -n "$DB_URL" ] || DB_URL="$(getenv DATABASE_URL)"
[ -n "$DB_URL" ] || die "Không có DIRECT_URL/DATABASE_URL trong $ENV_FILE"
PROD_SCHEMA="$(getenv DB_SCHEMA)"
PROD_SCHEMA="${PROD_SCHEMA:-local}"
TEST_SCHEMA="${PROD_SCHEMA}_restore_test"

pg_restore --list "$BACKUP_FILE" >/dev/null 2>&1 || die "File không phải dump định dạng custom của pg_dump"

if [ "$FORCE" = "1" ]; then
  echo "⚠️  CẢNH BÁO: Khôi phục ĐÈ lên schema PRODUCTION \"$PROD_SCHEMA\" (--force đã bật)"
  echo "   Toàn bộ dữ liệu hiện tại trong schema sẽ bị thay bằng nội dung backup."
  echo "   Nhấn Ctrl+C trong 5 giây để hủy..."
  sleep 5
  log "Khôi phục vào \"$PROD_SCHEMA\" từ $BACKUP_FILE"
  # --clean --if-exists: xoá object cũ trước khi tạo lại; --single-transaction: all-or-nothing
  pg_restore --dbname="$DB_URL" \
    --schema="$PROD_SCHEMA" \
    --clean --if-exists \
    --no-owner --no-privileges \
    --single-transaction \
    "$BACKUP_FILE"
  log "OK — Đã khôi phục schema \"$PROD_SCHEMA\". Nhớ: pm2 restart cyberknight"
  exit 0
fi

# ── Khôi phục vào schema thử nghiệm ───────────────────────────
# pg_dump ghi cứng tên schema trong dump → chuyển dump sang SQL rồi đổi
# "<PROD_SCHEMA>." → "<TEST_SCHEMA>." trước khi nạp. Chỉ dùng cho mục đích
# KIỂM TRA backup có khôi phục được hay không.
log "Khôi phục vào schema thử nghiệm \"$TEST_SCHEMA\" từ $BACKUP_FILE"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "DROP SCHEMA IF EXISTS \"$TEST_SCHEMA\" CASCADE;" -c "CREATE SCHEMA \"$TEST_SCHEMA\";"

pg_restore --no-owner --no-privileges --schema="$PROD_SCHEMA" -f - "$BACKUP_FILE" \
  | sed -E \
      -e "s/(^|[^A-Za-z0-9_])\"?${PROD_SCHEMA}\"?\./\1\"${TEST_SCHEMA}\"./g" \
      -e "s/^CREATE SCHEMA \"?${PROD_SCHEMA}\"?;/-- (schema \"${TEST_SCHEMA}\" đã tạo)/" \
      -e "s/search_path = \"?${PROD_SCHEMA}\"?/search_path = \"${TEST_SCHEMA}\"/g" \
  | psql "$DB_URL" -v ON_ERROR_STOP=1 -q --single-transaction

TABLE_COUNT=$(psql "$DB_URL" -At -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TEST_SCHEMA';")
USER_COUNT=$(psql "$DB_URL" -At -c "SELECT COUNT(*) FROM \"$TEST_SCHEMA\".users;" 2>/dev/null || echo "?")
log "OK — Khôi phục thử thành công: $TABLE_COUNT bảng, $USER_COUNT users trong schema \"$TEST_SCHEMA\"."
log "Xoá schema thử nghiệm khi xong:  psql \"\$DIRECT_URL\" -c 'DROP SCHEMA \"$TEST_SCHEMA\" CASCADE'"
