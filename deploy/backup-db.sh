#!/usr/bin/env bash
# ============================================================
# CyberKnight / Sigmabloom — Sao lưu PostgreSQL (Supabase) bằng pg_dump
#
# DB chạy trên Supabase (managed). Script này dump SCHEMA ứng dụng
# (DB_SCHEMA, mặc định "local") ra file định dạng custom (.dump) để
# khôi phục chọn lọc bằng pg_restore.
#
# Yêu cầu:
#   1. pg_dump phiên bản >= phiên bản PostgreSQL trên Supabase (hiện tại 17):
#        # Ubuntu: thêm repo PGDG rồi
#        sudo apt install postgresql-client-17
#      (pg_dump cũ hơn server sẽ báo "server version mismatch")
#   2. backend/.env chứa DIRECT_URL (session pooler, cổng 5432) — hoặc DATABASE_URL.
#      Script đọc chuỗi kết nối từ file, KHÔNG in ra log.
#   3. (Tuỳ chọn) rclone để đẩy backup ra ngoài VPS:
#        REMOTE_BACKUP=1 RCLONE_REMOTE="myremote:cyberknight-backups" bash deploy/backup-db.sh
#
# Cách dùng thủ công:
#   bash deploy/backup-db.sh
#
# Cron hằng ngày (crontab -e):
#   0 3 * * * /opt/cyberknight/deploy/backup-db.sh >> /home/deployer/cyberknight-backup.log 2>&1
# ============================================================

set -euo pipefail

REPO_PATH="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_PATH/backend/.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/cyberknight}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"

: "${REMOTE_BACKUP:=0}"
if [ "$REMOTE_BACKUP" = "1" ]; then
  : "${RCLONE_REMOTE:?Set RCLONE_REMOTE=myremote:path before running}"
fi

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() { log "LỖI: $*"; exit 1; }

# Đọc biến từ .env (bỏ dấu nháy bao quanh) — không export, không echo
getenv() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

[ -f "$ENV_FILE" ] || die "Không tìm thấy $ENV_FILE"
command -v pg_dump >/dev/null || die "Thiếu pg_dump (apt install postgresql-client-17)"

DB_URL="$(getenv DIRECT_URL)"
[ -n "$DB_URL" ] || DB_URL="$(getenv DATABASE_URL)"
[ -n "$DB_URL" ] || die "Không có DIRECT_URL/DATABASE_URL trong $ENV_FILE"
SCHEMA="$(getenv DB_SCHEMA)"
SCHEMA="${SCHEMA:-local}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true
BACKUP_FILE="$BACKUP_DIR/cyberknight-${SCHEMA}-$(date +%F_%H%M%S).dump"

log "Bắt đầu sao lưu schema \"$SCHEMA\" (Supabase) → $BACKUP_FILE"

# Custom format: nén sẵn, cho phép pg_restore chọn lọc / liệt kê nội dung
pg_dump "$DB_URL" \
  --schema="$SCHEMA" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-privileges \
  --file="$BACKUP_FILE"

FILE_SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null || echo "0")
if [ "$FILE_SIZE" -lt 1024 ]; then
  die "File backup quá nhỏ ($FILE_SIZE bytes). Kiểm tra kết nối DB!"
fi

# Xác nhận dump chứa bảng
if ! pg_restore --list "$BACKUP_FILE" | grep -q " TABLE "; then
  die "File backup không chứa TABLE nào — backup có thể không hợp lệ!"
fi
chmod 600 "$BACKUP_FILE"

log "OK — Đã sao lưu: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# ── Xóa bản backup cũ ─────────────────────────────────────────
DELETED=$(find "$BACKUP_DIR" -name "cyberknight-*.dump" -mtime "+$RETAIN_DAYS" -delete -print | wc -l | tr -d ' ')
if [ "$DELETED" -gt 0 ]; then
  log "OK — Đã xóa $DELETED bản backup cũ hơn $RETAIN_DAYS ngày."
fi

# ── Backup lên remote (tùy chọn) ──────────────────────────────
if [ "$REMOTE_BACKUP" = "1" ]; then
  log "Đang đẩy backup lên remote ${RCLONE_REMOTE} ..."
  rclone copy "$BACKUP_FILE" "${RCLONE_REMOTE}/" --progress
  log "OK — Đã đẩy backup lên remote."
fi

log "Hoàn tất sao lưu."
