#!/usr/bin/env bash
# ============================================================
# CyberKnight / Sigmabloom — Update / deploy script (chạy as deployer)
#
# Cách dùng:
#   cd /opt/cyberknight && bash deploy/update.sh
#   bash deploy/update.sh --repo /path/to/repo
#
# Tùy chọn:
#   --rollback <commit>  — rollback về commit cụ thể
#   --dry-run            — chỉ echo lệnh, không thực thi
#
# Luồng:
#   1. Kiểm tra git status (abort nếu có uncommitted changes)
#   2. Backup DB via backup-db.sh
#   3. git fetch + git pull --ff-only
#   4. npm ci --omit=dev
#   5. Chạy setup-db (với migrate user)
#   6. pm2 reload cyberknight
#   7. Verify health endpoint
#   8. Rollback nếu health check fail
# ============================================================

set -euo pipefail

REPO_PATH=""
ROLLBACK_COMMIT=""
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)
      REPO_PATH="$2"
      shift 2
      ;;
    --rollback)
      ROLLBACK_COMMIT="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    *)
      echo "Tùy chọn không rõ: $1"
      echo "Cách dùng: $0 [--repo <path>] [--rollback <commit>] [--dry-run]"
      exit 1
      ;;
  esac
done

# Default repo path
if [ -z "$REPO_PATH" ]; then
  REPO_PATH="$(cd "$(dirname "$0")/.." && pwd)"
fi
cd "$REPO_PATH"

echo "============================================"
echo " CyberKnight — Update Script"
echo " Repo: $REPO_PATH"
echo "============================================"

run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "[DRY-RUN] $*"
  else
    "$@"
  fi
}

# ── Check uncommitted changes ───────────────────────────────
echo ""
echo "--- Kiểm tra git status ---"
if [ -n "$(git status --porcelain)" ]; then
  echo "LỖI: Có thay đổi chưa commit trong repo!"
  echo "     Commit hoặc stash trước khi chạy update."
  git status --short
  exit 1
fi
echo "[OK] Không có uncommitted changes."

# ══════════════════════════════════════════════════════════════
# ROLLBACK MODE
# ══════════════════════════════════════════════════════════════
if [ -n "$ROLLBACK_COMMIT" ]; then
  echo ""
  echo "--- Rollback mode: về commit $ROLLBACK_COMMIT ---"

  OLD=$(git rev-parse HEAD)
  run git checkout "$ROLLBACK_COMMIT"
  if [ -d backend ]; then
    run bash -c "cd backend && npm ci --omit=dev 2>&1 | tail -5"
  fi
  run pm2 reload cyberknight
  sleep 3

  HEALTH=$(curl -fsS http://127.0.0.1:5000/api/health 2>/dev/null || echo "FAIL")
  if echo "$HEALTH" | grep -q '"status"'; then
    echo "[OK] Health check sau rollback: $HEALTH"
    echo "Rollback từ $OLD → $ROLLBACK_COMMIT hoàn tất."
  else
    echo "[WARN] Health check không xác nhận: $HEALTH"
    echo "Có thể cần restart PM2 thủ công: pm2 restart cyberknight"
  fi
  exit 0
fi

# ══════════════════════════════════════════════════════════════
# REGULAR UPDATE
# ══════════════════════════════════════════════════════════════

# ── 1. Backup DB ────────────────────────────────────────────
echo ""
echo "--- Bước 1/6: Backup DB ---"
BACKUP_SCRIPT="$REPO_PATH/deploy/backup-db.sh"
if [ ! -f "$BACKUP_SCRIPT" ]; then
  echo "LỖI: $BACKUP_SCRIPT không tồn tại!"
  exit 1
fi

# Chạy backup — nếu fail thì abort
if ! run bash "$BACKUP_SCRIPT"; then
  echo "LỖI: Backup DB thất bại — abort update!"
  exit 1
fi
echo "[OK] Backup DB hoàn tất."

# ── 2. Save current commit ──────────────────────────────────
echo ""
echo "--- Bước 2/6: Lưu commit hiện tại ---"
OLD=$(git rev-parse HEAD)
echo "Current commit: $OLD"

# ── 3. Git pull ────────────────────────────────────────────
echo ""
echo "--- Bước 3/6: Git fetch + pull ---"
run git fetch origin
if ! git pull --ff-only origin "$(git symbolic-ref --short HEAD 2>/dev/null || echo main)"; then
  echo "LỖI: git pull không thể fast-forward!"
  echo "     Có thể có conflict hoặc branch đã diverged."
  echo "     Giải quyết conflict hoặc dùng --rollback <commit>."
  exit 1
fi
NEW=$(git rev-parse HEAD)
echo "[OK] Updated: $OLD → $NEW"

# ── 4. npm ci ───────────────────────────────────────────────
echo ""
echo "--- Bước 4/6: npm ci (production) ---"
if [ ! -d backend ]; then
  echo "LỖI: Không tìm thấy thư mục backend/ trong repo."
  exit 1
fi
run bash -c "cd backend && npm ci --omit=dev 2>&1 | tail -10"

# ── 5. Migration (setup-db) ────────────────────────────────
echo ""
echo "--- Bước 5/6: Chạy setup-db (migration) ---"

# Kiểm tra .env.migrate tồn tại chưa
MIGRATE_ENV="$REPO_PATH/backend/.env.migrate"
if [ ! -f "$MIGRATE_ENV" ]; then
  echo "LỖI: $MIGRATE_ENV chưa tồn tại."
  echo "     Tạo file này với DB_USER=sigmabloom_migrate và DB_PASSWORD=<mật khẩu>"
  echo "     (chmod 600)"
  exit 1
fi
chmod 600 "$MIGRATE_ENV"

# Đọc migrate password từ env (không in ra)
source "$MIGRATE_ENV"
MIGPW="${DB_PASSWORD:-}"
if [ -z "$MIGPW" ]; then
  echo "LỖI: DB_PASSWORD trong .env.migrate bị trống."
  exit 1
fi

echo "(Migrate password: **** — không in ra)"
if ! run bash -c "cd backend && DB_USER=sigmabloom_migrate DB_PASSWORD='$MIGPW' npm run setup-db 2>&1"; then
  echo ""
  echo "LỖI: setup-db thất bại — đang rollback..."
  run git checkout "$OLD"
  run bash -c "cd backend && npm ci --omit=dev 2>&1 | tail -3"
  run pm2 reload cyberknight
  echo "Đã rollback về commit $OLD."
  echo "Hãy kiểm tra lỗi và thử lại."
  exit 1
fi

# Xóa biến khỏi bộ nhớ
unset MIGPW MIG_PW DB_PASSWORD
unset MIGPW MIG_PW 2>/dev/null || true

echo "[OK] setup-db hoàn tất."

# ── 6. PM2 reload ──────────────────────────────────────────
echo ""
echo "--- Bước 6/6: PM2 reload + verify ---"
run pm2 reload cyberknight
sleep 5

HEALTH=$(curl -fsS --max-time 10 http://127.0.0.1:5000/api/health 2>/dev/null || echo "")
if echo "$HEALTH" | grep -q '"status"'; then
  echo "[OK] Health check: $HEALTH"
else
  echo ""
  echo "LỖI: Health check thất bại: $HEALTH"
  echo "     Đang rollback..."
  run git checkout "$OLD"
  run bash -c "cd backend && npm ci --omit=dev 2>&1 | tail -3"
  run pm2 reload cyberknight
  echo "Đã rollback về commit $OLD."
  echo "Kiểm tra: pm2 logs cyberknight --lines 30"
  exit 1
fi

echo ""
echo "============================================"
echo " UPDATE HOÀN TẤT!"
echo " Commit: $OLD → $NEW"
echo " Health: $HEALTH"
echo " Logs:   pm2 logs cyberknight --lines 20"
echo "============================================"
