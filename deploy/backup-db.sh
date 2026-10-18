#!/usr/bin/env bash
# ============================================================
# CyberKnight / Sigmabloom — Script sao lưu cơ sở dữ liệu MySQL
#
# Yêu cầu:
#   1. User `sigmabloom_backup@localhost` phải tồn tại (tạo ở Phase 2.2 bootstrap):
#        CREATE USER IF NOT EXISTS 'sigmabloom_backup'@'localhost'
#          IDENTIFIED BY '<password>';
#        GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES
#          ON sigmabloom.* TO 'sigmabloom_backup'@'localhost';
#        FLUSH PRIVILEGES;
#
#   2. File ~/.my.cnf (quyền 600) chứa thông tin kết nối:
#       [mysqldump]
#       user=sigmabloom_backup
#       password=<password>
#   chmod 600 ~/.my.cnf
#
#   3. Nếu dùng rclone để đẩy lên remote (xem phần REMOTE_BACKUP bên dưới):
#      Cài đặt rclone: https://rclone.org/install/
#      Cấu hình remote:  rclone config
#      (bật REMOTE_BACKUP=1 và điền RCLONE_REMOTE, RCLONE_PATH bên dưới)
#
# Cách dùng thủ công:
#   bash deploy/backup-db.sh
#
# Cron hằng ngày (thêm vào crontab -e):
#   0 3 * * * /opt/cyberknight/deploy/backup-db.sh >> /var/log/cyberknight-backup.log 2>&1
# ============================================================

set -euo pipefail

# ── Cấu hình ───────────────────────────────────────────────────
DB_NAME="sigmabloom"
BACKUP_DIR="/var/backups/cyberknight"
RETAIN_DAYS=14

# ===== Tùy chọn: đẩy bản sao lưu ra ngoài VPS bằng rclone =====
# Cài:  sudo apt install rclone  &&  rclone config
# Bật:  REMOTE_BACKUP=1 RCLONE_REMOTE="myremote:cyberknight-backups" bash deploy/backup-db.sh
: "${REMOTE_BACKUP:=0}"
if [ "$REMOTE_BACKUP" = "1" ]; then
  : "${RCLONE_REMOTE:?Set RCLONE_REMOTE=myremote:path before running}"
fi
# ── Hàm tiện ích ───────────────────────────────────────────────
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

die() {
  log "LỖI: $*"
  exit 1
}

# Tạo thư mục backup nếu chưa có
mkdir -p "$BACKUP_DIR"

# Tên file backup theo ngày
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}-$(date +%F_%H%M%S).sql.gz"

log "Bắt đầu sao lưu cơ sở dữ liệu $DB_NAME ..."

# ── Dump database ───────────────────────────────────────────────
# Dùng --single-transaction cho các bảng InnoDB (không khóa bảng)
# --no-tablespaces yêu cầu privilege cao, dùng backup user không cần
mysqldump \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  "$DB_NAME" \
  | gzip > "$BACKUP_FILE"

# ── Kiểm tra kích thước file ───────────────────────────────────
FILE_SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null || echo "0")

if [ "$FILE_SIZE" -lt 1024 ]; then
  die "File backup quá nhỏ ($FILE_SIZE bytes), có thể rỗng. Kiểm tra kết nối DB!"
fi

# Kiểm tra nội dung có chứa CREATE TABLE (xác nhận backup hợp lệ)
if ! zcat "$BACKUP_FILE" | head -c 1024 | grep -q "CREATE TABLE"; then
  die "File backup không chứa 'CREATE TABLE' — backup có thể không hợp lệ!"
fi

log "OK — Đã sao lưu: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# ── Xóa bản backup cũ ─────────────────────────────────────────
DELETED=$(find "$BACKUP_DIR" -name "${DB_NAME}-*.sql.gz" -mtime "+$RETAIN_DAYS" -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  log "OK — Đã xóa $DELETED bản backup cũ hơn $RETAIN_DAYS ngày."
fi

# ── Backup lên remote (tùy chọn) ──────────────────────────────
if [ "${REMOTE_BACKUP:-0}" = "1" ]; then
  log "Đang đẩy backup lên remote ${RCLONE_REMOTE} ..."
  rclone copy "$BACKUP_FILE" "${RCLONE_REMOTE}/" --progress
  log "OK — Đã đẩy backup lên remote."
fi

log "Hoàn tất sao lưu."
