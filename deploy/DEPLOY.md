# Hướng Dẫn Triển Khai CyberKnight / Sigmabloom

> **Tài liệu này hướng dẫn triển khai từ Phase 4 đến Phase 9.**
> **Phase 1–3 đã hoàn tất trên local.**
> **Thay `<TEN_MIEN>`, `<IP_VPS>`, `<EMAIL>` bằng giá trị thật của bạn.**

---

## Mục Lục

1. [Phase 4 — Đăng nhập VPS, tạo deployer, SSH hardening](#phase-4--đăng-nhập-vps-tạo-deployer-ssh-hardening)
2. [Phase 5 — APT, Node 22, MySQL, 3 users, swap, low-mem config](#phase-5--apt-node-22-mysql-3-users-swap-low-mem-config)
3. [Phase 6 — Code, .env, setup-db, PM2](#phase-6--code-env-setup-db-pm2)
4. [Phase 7 — Nginx, HTTPS (certbot), www→apex, SePay, test thanh toán, backup](#phase-7--nginx-https-certbot-www-apex-sepay-test-thanh-toán-backup)
5. [Phase 8 — Acceptance, vận hành, bảo trì, pháp lý](#phase-8--acceptance-vận-hành-bảo-trì-pháp-lý)
6. [Phase 9 — Checklist báo cáo cuối cùng](#phase-9--checklist-báo-cáo-cuối-cùng)

---

## Phase 4 — Đăng nhập VPS, tạo deployer, SSH hardening

### Tùy chọn A: Dùng bootstrap script (khuyến nghị)

> Script `deploy/bootstrap-server.sh` thực hiện Phase 4–5 tự động.
> Yêu cầu: đã có quyền root SSH vào VPS.

```bash
# Đăng nhập root lần đầu
ssh root@<IP_VPS>

# Copy bootstrap script lên VPS (từ máy local)
scp deploy/bootstrap-server.sh root@<IP_VPS>:/root/

# Chạy bootstrap (nhấn Enter khi được hỏi mysql_secure_installation)
sudo bash /root/bootstrap-server.sh \
  --domain <TEN_MIEN> \
  --email  <EMAIL> \
  --deploy-user deployer
```

**Sau bootstrap, bắt buộc thêm SSH key trước khi chạy SSH hardening (xem 4.4).**

```powershell
# Trên máy local — tạo key mới cho deployer:
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\cyberknight_admin -N "" -C "deployer-admin"

# Lấy public key:
Get-Content $env:USERPROFILE\.ssh\cyberknight_admin.pub

# Trên VPS (cửa sổ root đang mở):
sudo mkdir -p /home/deployer/.ssh
sudo nano /home/deployer/.ssh/authorized_keys   # paste public key
sudo chown -R deployer:deployer /home/deployer/.ssh
sudo chmod 700 /home/deployer/.ssh
sudo chmod 600 /home/deployer/.ssh/authorized_keys

# Test trong cửa sổ SSH MỚI:
ssh -i $env:USERPROFILE\.ssh\cyberknight_admin deployer@<IP_VPS> "whoami"
# → deployer

# Chạy SSH hardening:
sudo bash /opt/cyberknight/deploy/finish-ssh-hardening.sh
```
**Script sẽ hỏi bạn thực hiện `mysql_secure_installation` thủ công khi được hỏi.**

### Tùy chọn B: Làm thủ công từng bước

#### 4.1. Đăng nhập root lần đầu

```bash
ssh root@<IP_VPS>
```

#### 4.2. Cập nhật hệ thống

```bash
apt update && apt upgrade -y
```

#### 4.3. Tạo user deployer

```bash
adduser --disabled-password --gecos "" deployer
usermod -aG sudo deployer

# Copy SSH key của root sang (nếu có)
mkdir -p /home/deployer/.ssh
cp -r /root/.ssh/* /home/deployer/.ssh/
chown -R deployer:deployer /home/deployer/.ssh
chmod 700 /home/deployer/.ssh
chmod 600 /home/deployer/.ssh/*
```

#### 4.4. SSH key bootstrap (BẮT BUỘC trước hardening)

> **Lưu ý quan trọng:** Script `finish-ssh-hardening.sh` sẽ **từ chối chạy** nếu
> deployer chưa có SSH key hợp lệ. Thêm key **TRƯỚC**, test, **SAU đó** mới chạy hardening.

**Tạo key mới trên máy local (PowerShell):**
```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\cyberknight_admin -N "" -C "deployer-admin"
```

**Lấy public key để copy:**
```powershell
Get-Content $env:USERPROFILE\.ssh\cyberknight_admin.pub
# Hoặc:
cat ~/.ssh/cyberknight_admin.pub
```

**Thêm vào VPS (trong cửa sổ SSH root hiện tại):**
```bash
sudo mkdir -p /home/deployer/.ssh
sudo nano /home/deployer/.ssh/authorized_keys
# Paste toàn bộ dòng public key (1 dòng dài bắt đầu bằng ssh-ed25519 AAAA...)
# Lưu: Ctrl+O, Enter, Ctrl+X
sudo chown -R deployer:deployer /home/deployer/.ssh
sudo chmod 700 /home/deployer/.ssh
sudo chmod 600 /home/deployer/.ssh/authorized_keys
```

**Test bằng cửa sổ SSH MỚI (KHÔNG đóng cửa sổ root):**
```powershell
ssh -i $env:USERPROFILE\.ssh\cyberknight_admin deployer@<IP_VPS> "whoami && sudo whoami"
# Phải in: deployer \n root
```

#### 4.5. SSH hardening (chạy SAU khi test key thành công)

```bash
# Trong cửa sổ root, sau khi test SSH key thành công ở bước 4.4:
sudo bash /root/deploy/finish-ssh-hardening.sh
```

Script sẽ:
- **Hard-stop exit 1** nếu `/home/deployer/.ssh/authorized_keys` không tồn tại hoặc rỗng
- Tạo `/etc/ssh/sshd_config.d/00-hardening.conf` với: `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `MaxAuthTries 3`, `X11Forwarding no`
- Kiểm tra `sshd -t`
- Reload sshd

**Kết quả xác nhận:**

```bash
sshd -T | grep -E 'passwordauthentication|permitrootlogin|maxauthtries'
# Phải thấy: passwordauthentication no | permitrootlogin no | maxauthtries 3
```

**Test sau hardening (dùng cửa sổ SSH MỚI KHÁC):**
```powershell
# Phải THÀNH CÔNG:
ssh -i $env:USERPROFILE\.ssh\cyberknight_admin deployer@<IP_VPS>

# Phải THẤT BẠI:
ssh root@<IP_VPS>
# → Permission denied (publickey) ✓
```

#### 4.6. UFW (tường lửa)

> **QUAN TRỌNG:** Bước này có thể khóa bạn khỏi server.
> **BẮT BUỘC** đăng nhập thành công bằng `deployer@<IP_VPS>` trong cửa sổ SSH MỚI
> trước khi chạy script hardening.

```bash
# Mở cửa sổ SSH mới
ssh deployer@<IP_VPS>
# → Đăng nhập thành công ✓ → quay lại cửa sổ root

# Quay lại cửa sổ root, chạy SSH hardening
sudo bash /root/deploy/finish-ssh-hardening.sh
# → Trả lời "yes" khi được hỏi đã thử deployer SSH thành công chưa
```

Script sẽ:
- Tạo `/etc/ssh/sshd_config.d/00-hardening.conf` với: `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `MaxAuthTries 3`, `X11Forwarding no`
- Kiểm tra `sshd -t`
- Hỏi xác nhận
- Reload sshd

**Kết quả xác nhận:**

```bash
sshd -T | grep -E 'passwordauthentication|permitrootlogin|maxauthtries'
# Phải thấy: passwordauthentication no | permitrootlogin no | maxauthtries 3
```

#### 4.6. UFW (tường lửa)

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status
# Kiểm tra: Status: active ✓
```

#### 4.7. Fail2ban

```bash
apt install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban
systemctl status fail2ban
```

#### 4.8. Unattended upgrades

```bash
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
# → Chọn Yes khi được hỏi
```

#### 4.9. Timezone

```bash
timedatectl set-timezone Asia/Ho_Chi_Minh
timedatectl show --property=Timezone --value
# Phải thấy: Asia/Ho_Chi_Minh
```

---

## Phase 5 — APT, Node 22, MySQL, 3 users, swap, low-mem config

### Tùy chọn A: Dùng bootstrap script

```bash
# (Nếu chưa chạy bootstrap ở Phase 4)
sudo bash /root/bootstrap-server.sh --domain <TEN_MIEN> --email <EMAIL>
```

### Tùy chọn B: Thủ công

#### 5.1. Kiểm tra RAM / Swap

```bash
free -h
# Nếu RAM ≤ 2GB, tạo swap 2GB:
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

#### 5.2. Cài gói cơ bản

```bash
apt install -y nginx mysql-server git curl rsync ufw fail2ban unattended-upgrades
```

#### 5.3. Node 22 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
apt install -y nodejs
node -v
# Phải thấy: v22.x.x

npm i -g pm2
pm2 --version
```

#### 5.4. MySQL low-mem config (nếu RAM ≤ 2GB)

```bash
cat > /etc/mysql/mysql.conf.d/zz-lowmem.cnf << 'EOF'
[mysqld]
bind-address=127.0.0.1
innodb_buffer_pool_size=128M
performance_schema=OFF
EOF
systemctl restart mysql
```

#### 5.5. MySQL secure installation

```bash
mysql_secure_installation

# Checklist khi được hỏi:
#   [1] Switch to unix_socket authentication → Y
#   [2] Change root password? → Y (đặt mật khẩu root MySQL mạnh)
#   [3] Remove anonymous users? → Y
#   [4] Disallow root login remotely? → Y
#   [5] Remove test database? → Y
#   [6] Reload privilege tables? → Y
```

#### 5.6. Tạo database + 3 users MySQL

> Các mật khẩu được sinh ngẫu nhiên — **LƯU VÀO TRÌNH QUẢN LÝ MẬT KHẨU**.

```bash
# Sinh mật khẩu
APP_PW=$(openssl rand -hex 24)
MIG_PW=$(openssl rand -hex 24)
BK_PW=$(openssl rand -hex 24)

sudo mysql --defaults-file=/etc/mysql/debian.cnf << SQL
CREATE DATABASE IF NOT EXISTS sigmabloom
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'sigmabloom_app'@'localhost'
  IDENTIFIED BY '${APP_PW}';
GRANT SELECT, INSERT, UPDATE, DELETE
  ON sigmabloom.* TO 'sigmabloom_app'@'localhost';
CREATE USER IF NOT EXISTS 'sigmabloom_migrate'@'localhost'
  IDENTIFIED BY '${MIG_PW}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP
  ON sigmabloom.* TO 'sigmabloom_migrate'@'localhost';
CREATE USER IF NOT EXISTS 'sigmabloom_backup'@'localhost'
  IDENTIFIED BY '${BK_PW}';
GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES
  ON sigmabloom.* TO 'sigmabloom_backup'@'localhost';
FLUSH PRIVILEGES;
SQL

# In ra để lưu
echo "APP:     $APP_PW"
echo "MIG_PW:  $MIG_PW"
echo "BK_PW:   $BK_PW"
```

#### 5.7. Xác nhận MySQL chỉ bind 127.0.0.1

```bash
ss -tlnp | grep 3306
# Phải thấy: 127.0.0.1:3306 hoặc không có dòng nào (OK)
```

#### 5.8. Tạo thư mục ứng dụng

```bash
mkdir -p /opt/cyberknight/logs
chown -R deployer:deployer /opt/cyberknight

mkdir -p /var/backups/cyberknight
chmod 700 /var/backups/cyberknight
chown -R deployer:deployer /var/backups/cyberknight
```

#### 5.9. Nginx server_tokens off

```bash
cat > /etc/nginx/conf.d/00-server-tokens.conf << 'EOF'
server_tokens off;
EOF
nginx -t && systemctl reload nginx
```

---

## Phase 6 — Code, .env, setup-db, PM2

### 6.1. Đăng nhập bằng deployer

```bash
# Từ máy local
ssh deployer@<IP_VPS>
cd /opt/cyberknight
```

### 6.2. Clone / pull code

```bash
# Cách 1: Git clone (nếu chưa có)
git clone <URL_REPO> .

# Cách 2: SCP từ máy local (trên máy local)
# Luôn dùng đường dẫn có dấu cách trong nháy kép:
scp -r "C:\Users\ASUS\OneDrive\Máy tính\EXEWEB" deployer@<IP_VPS>:/opt/cyberknight/
```

### 6.3. Tạo file .env (QUAN TRỌNG)

```bash
cp backend/.env.example backend/.env
chmod 600 backend/.env
nano backend/.env
```

**Nội dung tối thiểu cần điền:**

```env
NODE_ENV=production
PORT=5000
FRONTEND_URL=https://<TEN_MIEN>

# Database — dùng user APP (không dùng root)
DB_HOST=localhost
DB_PORT=3306
DB_USER=sigmabloom_app
DB_PASSWORD=<APP_PW>
DB_NAME=sigmabloom

# JWT Secrets (sinh 3 lệnh riêng biệt)
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=<secret_1>
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=<secret_2>
JWT_REFRESH_EXPIRES_IN=7d
LEVEL_ACCESS_SECRET=<secret_3>

# CORS — dùng tên miền thật có https
CORS_ORIGINS=https://<TEN_MIEN>

# Admin seed (production: mật khẩu ≥ 12 ký tự, đủ hoa/thường/số/đặc biệt)
# SAU KHI SETUP XONG, XÓA GIÁ TRỊ NÀY KHỎI .env!
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=<mật_khẩu_admin_mạnh>
SEED_ADMIN_EMAIL=admin@<TEN_MIEN>

# Thanh toán VietQR / SePay
BANK_ACCOUNT=<số_tài_khoản>
BANK_NAME=<TÊN_CHỦ_TK_IN_HOA_KHÔNG_DẤU>
BANK_BIN=<mã_BIN>
SEPAY_API_KEY=<api_key_từ_SePay>
ORDER_TTL_MINUTES=30

# Email (Gmail App Password hoặc SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<email@gmail.com>
SMTP_PASS=<app_password>
SMTP_FROM="CyberKnight Shield" <no-reply@<TEN_MIEN>>
FEEDBACK_TO=<email_nhận_phản_hồi>
```

> **Mã BIN phổ biến:** VietinBank=`970415`, Vietcombank=`970436`, MBBank=`970422`, BIDV=`970418`, Techcombank=`970407`, ACB=`970416`, TPBank=`970423`.

### 6.4. Tạo file .env.migrate (cho update script)

```bash
nano backend/.env.migrate
# chmod 600 backend/.env.migrate
```

```env
DB_USER=sigmabloom_migrate
DB_PASSWORD=<MIG_PW>
```

### 6.5. Cài dependencies (production)

```bash
cd /opt/cyberknight/backend
npm ci --omit=dev
```

### 6.6. Chạy setup-db (tạo DB + migrations)

```bash
# Dùng migrate user (có quyền CREATE/ALTER)
cd /opt/cyberknight/backend
DB_USER=sigmabloom_migrate DB_PASSWORD=<MIG_PW> npm run setup-db
```

**Kết quả mong đợi:**
```
✅ Kết nối MySQL thành công!
✅ Đã tạo database gốc và bảng cơ bản!
✅ Đã áp dụng migration 002_*.sql!
✅ Đã áp dụng migration 003_*.sql!
...
🎉 Setup cơ sở dữ liệu hoàn tất!
✅ Đã khởi tạo tài khoản Admin mẫu!
```

### 6.7. CSS đã build sẵn (không cần build trên VPS)

File `assets/tailwind.css` đã được commit trong repo. VPS chỉ cần:
```bash
cd /opt/cyberknight/backend
npm ci --omit=dev
```
**Không** chạy `npm run build:css` trên VPS.

> Để sửa giao diện: sửa HTML → chạy `npm run build:css` trên **máy local** (cần Tailwind devDependency) → commit `assets/tailwind.css`.

### 6.8. Khởi chạy PM2

```bash
cd /opt/cyberknight
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup
# → Chạy lệnh sudo mà PM2 in ra để thiết lập startup script

# Cài logrotate
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### 6.9. Kiểm tra ứng dụng

```bash
curl -fsS http://127.0.0.1:5000/api/health
# Phải thấy: {"status":"ok",...}
```

---

## Phase 7 — Nginx, HTTPS (certbot), www→apex, SePay, test thanh toán, backup

### 7.1. Triển khai Nginx config

```bash
sudo cp /opt/cyberknight/deploy/nginx-proxy-params.conf /etc/nginx/includes/
sudo cp /opt/cyberknight/deploy/nginx.conf.example /etc/nginx/sites-available/cyberknight
sudo ln -sf /etc/nginx/sites-available/cyberknight /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

**Kiểm tra:**

```bash
curl -I http://<TEN_MIEN>/
# Phải thấy: HTTP/1.1 200 OK
```

### 7.2. Cài Certbot + HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <TEN_MIEN> -d www.<TEN_MIEN> \
  -m <EMAIL> --agree-tos --redirect
```

**Certbot sẽ tự động:**
- Lấy certificate cho `<TEN_MIEN>` và `www.<TEN_MIEN>`
- Thêm khối `listen 443 ssl` vào nginx config
- Thêm chuyển hướng HTTP → HTTPS

### 7.3. Thêm www→apex redirect (SAU certbot)

> **LƯU Ý:** Bước này PHẢI chạy SAU certbot, không phải trước.
> Nếu thêm trước khi chạy certbot, HTTP-01 challenge cho `www.<TEN_MIEN>` sẽ thất bại.

```bash
sudo nano /etc/nginx/sites-available/cyberknight
```

Trong khối `server { listen 443 ssl http2; }`, thêm **NGAY SAU** dòng `server_name`:

```
    if ($host = www.<TEN_MIEN>) {
        return 301 https://<TEN_MIEN>$request_uri;
    }
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

**Kiểm tra:**

```bash
curl -I https://www.<TEN_MIEN>/
# Phải thấy: HTTP/1.1 301 Moved Permanently → Location: https://<TEN_MIEN>/
curl -I https://<TEN_MIEN>/
# Phải thấy: HTTP/2 200
```

### 7.4. Xác nhận tự gia hạn Certbot (systemd timer)

```bash
# Certbot gia hạn tự động qua certbot.timer — kiểm tra:
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

> **Không cần cron cho certbot.** Timer systemd chạy 2 lần/ngày, tự động gia hạn khi còn 30 ngày.

### 7.5. Cấu hình SePay Webhook

1. Đăng nhập [my.sepay.vn](https://my.sepay.vn)
2. Vào **Cài đặt → Webhook**:
   - **URL:** `https://<TEN_MIEN>/api/payments/webhook/sepay`
   - **API Key:** giá trị đã đặt trong `SEPAY_API_KEY` của `.env`
   - **Header:** `Authorization: Apikey <SEPAY_API_KEY>`

### 7.6. Test thanh toán thật

1. Mở trình duyệt → đăng ký tài khoản test
2. Vào trang thanh toán → tạo đơn hàng
3. Quét mã QR → chuyển khoản đúng số tiền + đúng nội dung
4. Kiểm tra trong vài giây: `pm2 logs cyberknight --lines 20`
5. Đơn hàng phải tự chuyển sang `paid`, quyền chơi được cấp

### 7.7. Thiết lập backup

#### 7.7.1. Tạo file xác thực MySQL cho backup user

```bash
nano ~/.my.cnf
chmod 600 ~/.my.cnf
```

```ini
[mysqldump]
user=sigmabloom_backup
password=<BK_PW>
```

#### 7.7.2. Chạy thử backup

```bash
bash /opt/cyberknight/deploy/backup-db.sh
ls -lh /var/backups/cyberknight/
```

#### 7.7.3. Sao lưu ra ngoài VPS (tùy chọn)

Cài rclone và cấu hình remote:

```bash
sudo apt install rclone
rclone config
# → Làm theo hướng dẫn để tạo remote (S3, GCS, Google Drive, SFTP, ...)
```

Kích hoạt remote backup:

```bash
# Thử nghiệm lần đầu
REMOTE_BACKUP=1 RCLONE_REMOTE="myremote" RCLONE_PATH="cyberknight/backups" \
  bash /opt/cyberknight/deploy/backup-db.sh
```

#### 7.7.4. Thiết lập cron

```bash
crontab -e
# Paste nội dung từ deploy/crontab.example
```

### 7.8. Test restore

```bash
bash /opt/cyberknight/deploy/test-restore.sh
# Hoặc với file cụ thể:
bash /opt/cyberknight/deploy/test-restore.sh /var/backups/cyberknight/sigmabloom-2025-01-15_030000.sql.gz
```

---

## Phase 8 — Acceptance, vận hành, bảo trì, pháp lý

### 8.1. Checklist nghiệm thu

#### Giao diện & chức năng
- [ ] Mở `https://<TEN_MIEN>`: bấm được mọi nút, Console (F12) không có lỗi CSP
- [ ] Vào Level 0 (miễn phí) — game chạy trong iframe
- [ ] `/level1/level1.html` khi chưa đăng nhập → bị chặn
- [ ] Sau khi mua gói → level tương ứng mở được ngay

#### Bảo mật truy cập
- [ ] `https://<TEN_MIEN>/backend/.env` → 404
- [ ] `https://<TEN_MIEN>/package.json` → 404
- [ ] `https://<TEN_MIEN>/backend/src/server.js` → 404
- [ ] `https://<TEN_MIEN>/README.md` → 404
- [ ] `https://<TEN_MIEN>/deploy/` → 404

#### Xác thực & phân quyền
- [ ] Đăng nhập admin → đổi mật khẩu ngay → xóa `SEED_ADMIN_PASSWORD` khỏi `.env`
- [ ] Tạo username chứa `<script>` → bị từ chối
- [ ] Trang admin không chạy script từ dữ liệu người dùng

#### Webhook & thanh toán
- [ ] Gọi webhook không có key → 401/403
- [ ] Quét QR đúng: đúng ngân hàng / số TK / tên / số tiền / nội dung = mã đơn
- [ ] Mua gói thật số tiền nhỏ → đơn tự `paid` trong vài giây, email xác nhận đến

#### Security headers
- [ ] `curl -I https://<TEN_MIEN>` thấy HSTS, CSP, `X-Content-Type-Options`
- [ ] Cookie `refreshToken` và `levelAccess` có `HttpOnly; Secure; SameSite`

#### Hạ tầng
- [ ] `ss -tlnp` trên VPS: chỉ 22/80/443 công khai; 3306 và 5000 chỉ ở `127.0.0.1`
- [ ] Tắt MySQL tạm thời → level trả phí không phục vụ (fail-closed)

### 8.2. Vận hành hằng ngày

```bash
# Xem log
pm2 logs cyberknight --lines 50

# Restart nếu cần
pm2 restart cyberknight

# Kiểm tra trạng thái
pm2 status

# Xem backup gần nhất
ls -lht /var/backups/cyberknight/

# Test restore định kỳ
bash /opt/cyberknight/deploy/test-restore.sh
```

### 8.3. Cập nhật code

```bash
# Luôn dùng script update.sh — không update thủ công
cd /opt/cyberknight
bash deploy/update.sh

# Nếu cần rollback:
bash deploy/update.sh --rollback <commit_hash>
```

### 8.4. Khắc phục sự cố

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| **502 Bad Gateway** | PM2 chưa chạy hoặc crash | `pm2 status` → `pm2 restart cyberknight` → `pm2 logs` |
| **Cookie không lưu** | Thiếu `X-Forwarded-Proto` / HTTPS | Kiểm tra Nginx proxy headers & `trust proxy` |
| **Webhook 401/403** | Sai `SEPAY_API_KEY` | Đối chiếu key trong `.env` với cấu hình SePay |
| **QR sai thông tin** | Sai `BANK_BIN`/`BANK_ACCOUNT`/`BANK_NAME` | Kiểm tra `.env` |
| **Email không gửi** | Sai App Password / chưa bật 2FA Google | Tạo App Password mới tại myaccount.google.com |
| **Nút bấm không chạy** | CSP chặn inline handler | Mở Console (F12) → tìm lỗi CSP → kiểm tra helmet |
| **Level trả phí mở được khi chưa mua** | Level guard lỗi | `pm2 logs` → restart |
| **Trang trắng / lỗi 500** | Thiếu biến `.env` hoặc DB chưa migrate | `pm2 logs` → kiểm tra `.env` → `npm run setup-db` |
| **Certbot không gia hạn** | DNS chưa trỏ hoặc port 80 bị chặn | `sudo certbot renew --dry-run` → kiểm tra DNS & UFW & `systemctl status certbot.timer` |

### 8.5. Cấu hình khi đặt sau Cloudflare

> **LƯU Ý:** KHÔNG dùng Cloudflare cho lần đầu triển khai.
> Nếu sau này cần Cloudflare:
> 1. Đọc `README.md` mục "Cloudflare IP forwarding"
> 2. Thêm `X-Forwarded-Proto https` header nếu cần
> 3. Đảm bảo `app.set('trust proxy', 1)` đã bật trong `server.js`
> 4. Tắt Cloudflare Proxy (橙色/灰色) trên các bản ghi API/webhook

### 8.6. Sao lưu ra ngoài VPS (rclone)

Chi tiết các biến trong `deploy/backup-db.sh`:

| Biến | Ý nghĩa | Ví dụ |
|---|---|---|
| `REMOTE_BACKUP` | Bật/tắt backup lên remote | `0` (tắt), `1` (bật) |
| `RCLONE_REMOTE` | Tên remote + path (dạng `myremote:path`) đã cấu hình trong `rclone config` | `myremote:cyberknight-backups` |

**Ví dụ chạy:**

```bash
REMOTE_BACKUP=1 \
  RCLONE_REMOTE="myremote:cyberknight-backups" \
  bash deploy/backup-db.sh
```

**Cấu hình rclone cho một số provider phổ biến:**

```bash
# Amazon S3
rclone config
# → Chọn type: s3 → Provider: AWS → Access Key ID → Secret Access Key → Region

# Google Cloud Storage
rclone config
# → Chọn type: google cloud storage → Project Number → JSON API Token

# Google Drive (miễn phí, giới hạn)
rclone config
# → Chọn type: drive → Google Application Credentials (để trống nếu dùng personal)

# SFTP
rclone config
# → Chọn type: sftp → Host → User → Key file
```

### 8.7. Pháp lý & vận hành

#### Thông tin trẻ em
- Hệ thống có thu thập dữ liệu người dùng (email, họ tên, năm sinh).
- Nếu người dùng dưới 16 tuổi (hoặc 13 tuổi tùy quốc gia), cần có sự đồng ý của cha mẹ/người giám hộ trước khi thu thập dữ liệu.
- Tham khảo: [GDPR Article 8](https://gdpr.eu/article-8-conditions-applicable-to-childs-consent/), COPPA (Mỹ).

#### Nghị định 13/2023/NĐ-CP (Việt Nam)
- Nghị định 13/2023 về bảo vệ dữ liệu cá nhân có hiệu lực từ 01/07/2023.
- Cần: (1) Đăng ký bộ xử lý dữ liệu (nếu bắt buộc), (2) Đảm bảo quyền của chủ dữ liệu (truy cập, sửa, xóa), (3) Lưu trữ dữ liệu an toàn.
- Khuyến nghị: tham vấn luật sư trước khi triển khai.

#### Chính sách hoàn tiền
- Tùy theo quy định nội bộ và pháp luật địa phương.
- Nếu dùng thanh toán tự động (VietQR): giao dịch ngân hàng thường không thể hoàn tiền tự động qua API.
- Nên có quy trình xử lý yêu cầu hoàn tiền thủ công qua admin.

#### Kế toán
- Tất cả giao dịch thanh toán cần được ghi nhận với mã đơn, số tiền, thời gian.
- Kiểm tra định kỳ: `GET /api/admin/payments/mismatches` để phát hiện giao dịch lỗi.
- Đối soát hằng ngày với sao kê ngân hàng (nếu có API bank).

---

## Phase 9 — Checklist báo cáo cuối cùng

```markdown
## Triển Khai CyberKnight / Sigmabloom — Báo Cáo

**Ngày triển khai:** __/__/____
**Domain:** <TEN_MIEN>
**VPS IP:** <IP_VPS>

### Hạ tầng
- [ ] VPS: Ubuntu ___, RAM ___, Ổ ___
- [ ] Node.js: ___, PM2: ___
- [ ] MySQL: ___, bind 127.0.0.1 ✓
- [ ] Nginx + Certbot: HTTPS ✓
- [ ] UFW active: SSH + Nginx Full ✓
- [ ] fail2ban: sshd jail ✓
- [ ] unattended-upgrades: configured ✓

### Database
- [ ] Database `sigmabloom` tạo ✓
- [ ] 3 user: sigmabloom_app, sigmabloom_migrate, sigmabloom_backup ✓
- [ ] Migrations: 002 → 007 applied ✓
- [ ] Admin seed: username `admin` tạo ✓
- [ ] backup-db.sh chạy OK ✓

### Ứng dụng
- [ ] PM2: cyberknight running ✓
- [ ] Health endpoint: 200 OK ✓
- [ ] Static files: chặn .env, backend, README.md ✓

### Bảo mật
- [ ] SSH hardening: root login disabled ✓
- [ ] .env: chmod 600 ✓
- [ ] SEED_ADMIN_PASSWORD: đã đổi + xóa khỏi .env ✓
- [ ] Rate-limit: auth 30r/m, webhook 100r/m ✓
- [ ] server_tokens off ✓

### HTTPS & Domain
- [ ] HTTPS: certificate Let's Encrypt ✓
- [ ] www → apex redirect: 301 ✓
- [ ] Certbot auto-renew: timer active ✓

### Thanh toán
- [ ] SePay webhook: configured ✓
- [ ] Test thanh toán: đơn chuyển paid ✓
- [ ] Email xác nhận: nhận được ✓

### Backup
- [ ] Cron backup hằng ngày: 03:00 ✓
- [ ] Cron test-restore hằng tuần: Chủ nhật 04:00 ✓
- [ ] Remote backup (rclone): ___(có/không)___
```

---

## Các file trong thư mục `deploy/`

| File | Mục đích |
|---|---|
| `bootstrap-server.sh` | One-shot setup VPS (Phase 4–5 tự động) |
| `finish-ssh-hardening.sh` | SSH hardening riêng (chạy sau khi deployer login thành công) |
| `update.sh` | Cập nhật code trên production (chạy as deployer) |
| `backup-db.sh` | Sao lưu MySQL hằng ngày |
| `restore-db.sh` | Khôi phục MySQL (mặc định vào DB test) |
| `test-restore.sh` | Test restore tự động (chọn file mới nhất) |
| `crontab.example` | Mẫu crontab cho deployer |
| `nginx.conf.example` | Cấu hình Nginx (port 80 → certbot sẽ thêm 443) |
| `nginx-proxy-params.conf` | Proxy headers chung cho Nginx |
| `ecosystem.config.js` | Cấu hình PM2 |
| `mysql-user.sql` | Ghi chú SQL tạo user (đã chuyển vào bootstrap) |

---

*Tài liệu thuộc dự án CyberKnight / Sigmabloom.*
*Cập nhật lần cuối: Phase 9 (Bootstrap Phase 2).*
