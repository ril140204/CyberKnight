#!/usr/bin/env bash
# ============================================================
# CyberKnight / Sigmabloom — One-shot VPS bootstrap script
# Chạy trên Ubuntu 22.04 / 24.04 (Jammy / Noble)
#
# Cách dùng:
#   sudo bash deploy/bootstrap-server.sh \
#     --domain <TEN_MIEN> \
#     --email  <EMAIL> \
#     [--deploy-user deployer]
#
# Tùy chọn:
#   --dry-run  — chỉ echo lệnh, không thực thi
#
# Lưu ý:
#   - Script này KHÔNG làm SSH hardening.
#     Sau khi tạo deployer thành công, chạy riêng:
#       sudo bash deploy/finish-ssh-hardening.sh
#   - KHÔNG cài MySQL/PostgreSQL server: DB chạy trên Supabase (chỉ cài postgresql-client-17 để backup)
#     (yêu cầu tương tác). Hướng dẫn sẽ được in ra màn hình.
# ============================================================

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────
DEPLOY_USER="deployer"
DRY_RUN=0
DOMAIN=""
EMAIL=""

# ── Parse flags ───────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --domain)
      DOMAIN="$2"
      shift 2
      ;;
    --email)
      EMAIL="$2"
      shift 2
      ;;
    --deploy-user)
      DEPLOY_USER="$2"
      shift 2
      ;;
    *)
      echo "Tùy chọn không rõ: $1"
      echo "Cách dùng: $0 --domain <TEN_MIEN> --email <EMAIL> [--deploy-user deployer] [--dry-run]"
      exit 1
      ;;
  esac
done

# ── Validate required flags ──────────────────────────────────
if [ -z "$DOMAIN" ]; then
  echo "LỖI: --domain là bắt buộc."
  exit 1
fi
if [ -z "$EMAIL" ]; then
  echo "LỖI: --email là bắt buộc (cho Let's Encrypt)."
  exit 1
fi

# ── Header checks ────────────────────────────────────────────
echo "============================================"
echo " CyberKnight — VPS Bootstrap"
echo " Domain: $DOMAIN"
echo " Email:  $EMAIL"
echo " Deploy user: $DEPLOY_USER"
echo "============================================"

if [ "$(id -u)" -ne 0 ]; then
  echo "LỖI: Chạy script này với quyền root (sudo)."
  exit 1
fi

# Detect Ubuntu codename
CODENAME=$(lsb_release -cs 2>/dev/null || cat /etc/os-release | grep VERSION_CODENAME | cut -d= -f2)
if [ "$CODENAME" != "jammy" ] && [ "$CODENAME" != "noble" ]; then
  echo "LỖI: Script chỉ hỗ trợ Ubuntu 22.04 (jammy) hoặc 24.04 (noble)."
  echo "      Phát hiện: $CODENAME"
  exit 1
fi
echo "[OK] Ubuntu codename: $CODENAME"

# ── Helper: run or dry-run ────────────────────────────────────
run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "[DRY-RUN] $*"
  else
    "$@"
  fi
}

run_cmd() {
  echo "[EXEC] $*"
  if [ "$DRY_RUN" = "0" ]; then
    eval "$*" || { echo "LỖI: lệnh trên thất bại (exit $?)"; exit 1; }
  fi
}

# ══════════════════════════════════════════════════════════════
# 1. APT UPDATE & UPGRADE
# ══════════════════════════════════════════════════════════════
echo ""
echo "=== 1/19: Cập nhật hệ thống ==="
run_cmd "apt update && apt upgrade -y"

# ══════════════════════════════════════════════════════════════
# 2. CREATE DEPLOYER USER
# ══════════════════════════════════════════════════════════════
echo ""
echo "=== 2/19: Tạo user deployer ==="
if id "$DEPLOY_USER" &>/dev/null; then
  echo "[SKIP] User '$DEPLOY_USER' đã tồn tại — bỏ qua."
else
  run_cmd "adduser --disabled-password --gecos '' $DEPLOY_USER"
  run_cmd "usermod -aG sudo $DEPLOY_USER"
  echo "[OK] User '$DEPLOY_USER' đã tạo."
fi

# Copy root SSH keys to deployer
if [ -d /root/.ssh ] && [ ! -d "/home/$DEPLOY_USER/.ssh" ]; then
  echo "--- Copy SSH keys cho $DEPLOY_USER ---"
  run_cmd "mkdir -p /home/$DEPLOY_USER/.ssh"
  run_cmd "cp -r /root/.ssh/* /home/$DEPLOY_USER/.ssh/"
  run_cmd "chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh"
  run_cmd "chmod 700 /home/$DEPLOY_USER/.ssh"
  run_cmd "chmod 600 /home/$DEPLOY_USER/.ssh/*"
  echo "[OK] SSH keys đã copy."
fi

# ══════════════════════════════════════════════════════════════
# 3. UFW (tường lửa)
# ══════════════════════════════════════════════════════════════
echo ""
echo "=== 3/19: Cấu hình UFW ==="
run_cmd "ufw allow OpenSSH"
run_cmd "ufw allow 'Nginx Full'"

# Kiểm tra UFW đã active chưa
UFW_STATUS=$(ufw status 2>/dev/null | head -1 || echo "unknown")
if echo "$UFW_STATUS" | grep -q "Status: active"; then
  echo "[SKIP] UFW đã active — bỏ qua bước enable."
else
  echo "--- Bật UFW (sẽ yêu cầu xác nhận) ---"
  # Disable interactive mode for dry-run
  if [ "$DRY_RUN" = "1" ]; then
    echo "[DRY-RUN] ufw --force enable"
  else
    echo "y" | ufw --force enable || true
  fi
fi
run_cmd "ufw status"

# ══════════════════════════════════════════════════════════════
# 4. FAIL2BAN
# ══════════════════════════════════════════════════════════════
echo ""
echo "=== 4/19: Cài fail2ban ==="
if command -v fail2ban-server &>/dev/null; then
  echo "[SKIP] fail2ban đã cài — bỏ qua."
else
  run_cmd "apt install -y fail2ban"
fi
run_cmd "systemctl enable fail2ban"
run_cmd "systemctl start fail2ban"

# ══════════════════════════════════════════════════════════════
# 5. UNATTENDED UPGRADES
# ══════════════════════════════════════════════════════════════
echo ""
echo "=== 5/19: Cài unattended-upgrades ==="
if command -v unattended-upgrade &>/dev/null; then
  echo "[SKIP] unattended-upgrades đã cài — bỏ qua."
else
  run_cmd "apt install -y unattended-upgrades"
fi

# Cấu hình non-interactive
if [ "$DRY_RUN" = "0" ]; then
  echo "--- Cấu hình unattended-upgrades (non-interactive) ---"
  # Try non-interactive; if it asks, we echo 'yes' to all
  # The dpkg-reconfigure is interactive; we use debconf-set-selections approach
  # for unattended-upgrades, a simple config file works
  cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'UBUNTU'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}";
    "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
UBUNTU
  cat > /etc/apt/apt.conf.d/51ugrade-force-confnew << 'UCONF'
DPkg::options {
  "--force-confdef";
  "--force-confnew";
}
UCONF
  echo "[OK] Cấu hình unattended-upgrades đã ghi."
else
  echo "[DRY-RUN] Cấu hình unattended-upgrades files"
fi

# ══════════════════════════════════════════════════════════════
# 6. TIMEZONE
# ══════════════════════════════════════════════════════════════
echo ""
echo "=== 6/19: Đặt timezone Asia/Ho_Chi_Minh ==="
run_cmd "timedatectl set-timezone Asia/Ho_Chi_Minh"
run_cmd "timedatectl show --property=Timezone --value"

# ══════════════════════════════════════════════════════════════
# 7. SWAP FILE (nếu RAM ≤ 2GB)
# ══════════════════════════════════════════════════════════════
echo ""
echo "=== 7/19: Kiểm tra RAM / Swap ==="
TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
TOTAL_MEM_GB=$((TOTAL_MEM_KB / 1024 / 1024))
echo "Tổng RAM: ${TOTAL_MEM_GB}GB"

if [ -f /swapfile ]; then
  echo "[SKIP] Swapfile đã tồn tại — bỏ qua."
elif [ "$TOTAL_MEM_GB" -le 2 ]; then
  echo "RAM ≤ 2GB — tạo swap 2GB..."
  run_cmd "fallocate -l 2G /swapfile"
  run_cmd "chmod 600 /swapfile"
  run_cmd "mkswap /swapfile"
  run_cmd "swapon /swapfile"
  # Add to fstab
  if ! grep -q "/swapfile" /etc/fstab; then
    run_cmd "echo '/swapfile none swap sw 0 0' >> /etc/fstab"
  fi
  echo "[OK] Swap 2GB đã tạo."
else
  echo "[SKIP] RAM > 2GB — không cần swap."
fi

# ══════════════════════════════════════════════════════════════
# 8. INSTALL CORE PACKAGES
# ══════════════════════════════════════════════════════════════
echo ""
echo "=== 8/19: Cài các gói cơ bản ==="
PACKAGES="nginx git curl rsync ufw fail2ban unattended-upgrades ca-certificates gnupg lsb-release"
MISSING=""
for pkg in $PACKAGES; do
  if ! command -v "$pkg" &>/dev/null && ! dpkg -l "$pkg" &>/dev/null; then
    MISSING="$MISSING $pkg"
  fi
done
if [ -n "$MISSING" ]; then
  run_cmd "apt install -y$MISSING"
else
  echo "[SKIP] Tất cả gói đã cài."
fi

# ══════════════════════════════════════════════════════════════
# 9. NODE 22 LTS (NodeSource — curl | sudo bash duy nhất được phép)
# ══════════════════════════════════════════════════════════════
echo ""
echo "=== 9/19: Cài Node.js 22 LTS ==="
NODE_VERSION=$(node -v 2>/dev/null || echo "")
if [ -n "$NODE_VERSION" ] && echo "$NODE_VERSION" | grep -q "^v22"; then
  echo "[SKIP] Node.js $NODE_VERSION đã cài — bỏ qua."
else
  run_cmd "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
  run_cmd "apt install -y nodejs"
  echo "[OK] Node.js $(node -v) đã cài."
fi

# PM2
if command -v pm2 &>/dev/null; then
  echo "[SKIP] PM2 đã cài."
else
  run_cmd "npm i -g pm2"
fi
echo "PM2: $(pm2 --version 2>/dev/null || echo '?')"

# ══════════════════════════════════════════════════════════════
# 10. POSTGRESQL CLIENT 17 (pg_dump/psql cho backup) — DB chạy trên SUPABASE
# ══════════════════════════════════════════════════════════════
echo ""
echo "=== 10/19: Cài postgresql-client-17 (chỉ client — DB là Supabase, KHÔNG cài DB server) ==="
if command -v pg_dump &>/dev/null && pg_dump --version | grep -qE " 1[7-9]\."; then
  echo "[SKIP] $(pg_dump --version) đã cài."
else
  # Repo PGDG để có client cùng phiên bản với Supabase (PostgreSQL 17)
  run_cmd "install -d /usr/share/postgresql-common/pgdg"
  run_cmd "curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc"
  run_cmd "sh -c 'echo \"deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt \$(lsb_release -cs)-pgdg main\" > /etc/apt/sources.list.d/pgdg.list'"
  run_cmd "apt update"
  run_cmd "apt install -y postgresql-client-17"
  echo "[OK] $(pg_dump --version 2>/dev/null || echo 'postgresql-client-17') đã cài."
fi

# ══════════════════════════════════════════════════════════════
# 11. TCP BBR — tối ưu stream video cho mạng yếu / rớt gói
# ══════════════════════════════════════════════════════════════
echo ""
echo "=== 11/19: Bật TCP BBR + fq (tối ưu stream video trên mạng yếu) ==="
SYSCTL_CONF="/etc/sysctl.d/99-cyberknight.conf"
if [ -f "$SYSCTL_CONF" ]; then
  echo "[SKIP] $SYSCTL_CONF đã tồn tại."
else
  run_cmd "cat > $SYSCTL_CONF << 'SYSCTL'
# CyberKnight — tối ưu TCP cho HLS video trên mạng yếu
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_notsent_lowat = 16384
net.ipv4.tcp_slow_start_after_idle = 0
SYSCTL"
  run_cmd "sysctl --system >/dev/null"
  echo "[OK] $(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || echo bbr) đã bật."
fi

# ══════════════════════════════════════════════════════════════
# 12–13. (BỎ) MySQL — đã chuyển sang Supabase PostgreSQL
# ══════════════════════════════════════════════════════════════
echo ""
echo "=== 12-13/19: [SKIP] Không cài MySQL — ứng dụng dùng Supabase PostgreSQL ==="
echo "   Sau bootstrap, điền DATABASE_URL / DIRECT_URL / DB_SCHEMA vào backend/.env"
echo "   (Supabase → Project Settings → Database → Connection string → Transaction / Session pooler)."

# ══════════════════════════════════════════════════════════════
# 14. CREATE APP DIRECTORIES
# ══════════════════════════════════════════════════════════════
echo ""
echo "=== 14/19: Tạo thư mục ứng dụng ==="
APP_DIR="/opt/cyberknight"
run_cmd "mkdir -p $APP_DIR/logs"
run_cmd "chown -R $DEPLOY_USER:$DEPLOY_USER $APP_DIR"

BACKUP_DIR="/var/backups/cyberknight"
run_cmd "mkdir -p $BACKUP_DIR"
run_cmd "chmod 700 $BACKUP_DIR"
run_cmd "chown -R $DEPLOY_USER:$DEPLOY_USER $BACKUP_DIR"
echo "[OK] Thư mục đã tạo: $APP_DIR và $BACKUP_DIR"

# ══════════════════════════════════════════════════════════════
# 16. NGINX INCLUDES DIRECTORY
# ══════════════════════════════════════════════════════════════
echo ""
echo "=== 16/20: Nginx includes directory + proxy params ==="
run_cmd "mkdir -p /etc/nginx/includes"
# Idempotent: use -f so it's safe to run multiple times
run_cmd "cp -f /opt/cyberknight/deploy/nginx-proxy-params.conf /etc/nginx/includes/"
echo "[OK] Nginx includes directory ready."

# ══════════════════════════════════════════════════════════════
# 17. NGINX SERVER_TOKENS OFF
# ══════════════════════════════════════════════════════════════
echo ""
echo "=== 17/20: Nginx server_tokens off ==="
RUNIQUE_CONF="/etc/nginx/conf.d/00-server-tokens.conf"
if [ -f "$RUNIQUE_CONF" ]; then
  echo "[SKIP] $RUNIQUE_CONF đã tồn tại."
else
  run_cmd "cat > $RUNIQUE_CONF << 'NGINXCONF'
server_tokens off;
NGINXCONF"
  run_cmd "nginx -t && systemctl reload nginx"
  echo "[OK] server_tokens off đã bật."
fi

# ══════════════════════════════════════════════════════════════
# 18–20. PLACEHOLDER STEPS (các bước thủ công sau này)
# ══════════════════════════════════════════════════════════════
echo ""
echo "=== 18–20/20: Các bước còn lại (sẽ hướng dẫn sau) ==="
echo "[SKIP] Pull code, .env, setup-db, PM2 — xem DEPLOY.md Phase 4–7"

# ══════════════════════════════════════════════════════════════
# NEXT STEPS
# ══════════════════════════════════════════════════════════════
echo ""
echo ""
echo "============================================"
echo " BOOTSTRAP HOÀN TẤT!"
echo "============================================"
echo ""
echo " Bước tiếp theo — BẮT BUỘC thêm SSH key cho deployer:"
echo ""
echo "   TRƯỚC KHI chạy finish-ssh-hardening.sh, bạn phải thêm SSH key."
echo ""
echo "   1. Trên MÁY LOCAL (PowerShell), tạo key mới cho deployer:"
echo "      ssh-keygen -t ed25519 -f ~/.ssh/cyberknight_admin -N \"\" -C \"deployer-admin\""
echo ""
echo "   2. Lấy public key:"
echo "      cat ~/.ssh/cyberknight_admin.pub"
echo "      (Copy toàn bộ dòng này)"
echo ""
echo "   3. Trên VPS (cửa sổ SSH root hiện tại):"
echo "      sudo mkdir -p /home/deployer/.ssh"
echo "      sudo nano /home/deployer/.ssh/authorized_keys"
echo "      # Paste public key, Ctrl+O, Enter, Ctrl+X"
echo "      sudo chown -R deployer:deployer /home/deployer/.ssh"
echo "      sudo chmod 700 /home/deployer/.ssh"
echo "      sudo chmod 600 /home/deployer/.ssh/authorized_keys"
echo ""
echo "   4. TEST trong cửa sổ SSH MỚI (KHÔNG đóng cửa sổ root):"
echo "      ssh -i ~/.ssh/cyberknight_admin deployer@<IP_VPS> \"whoami && sudo whoami\""
echo "      # Phải in: deployer \\n root"
echo ""
echo "   5. Nếu test OK, quay lại cửa sổ root và chạy:"
echo "      sudo bash /opt/cyberknight/deploy/finish-ssh-hardening.sh"
echo ""
echo " Tài liệu tham khảo: deploy/DEPLOY.md"
echo "============================================"
