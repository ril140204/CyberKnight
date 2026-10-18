# HƯỚNG DẪN DEPLOY CYBERKNIGHT / SIGMABLOOM — PHIÊN BẢN CHÍNH XÁC

> **⚠️ Khuyến nghị mạnh:** Chuyển dự án sang đường dẫn không dấu, không khoảng trắng,
> ví dụ `C:\dev\EXEWEB`. Nhiều công cụ (Node, npm scripts, rsync, scp) xử lý sai tên có dấu/khoảng trắng.
> Nếu bắt buộc dùng đường dẫn có dấu cách, **LUÔN bọc trong dấu nháy kép**.

> **Ngày:** 2026-10-18
> **Phiên bản:** Fix tất cả 8 nhóm drift (Group 1–8)
> **Code is the source of truth.** Mọi tài liệu phải khớp với code thật.

---

## Bảng biến thay thế

| Biến | Ý nghĩa | Ví dụ |
|------|---------|-------|
| `<IP_VPS>` | IP của VPS | `103.123.45.67` |
| `<TEN_MIEN>` | Tên miền chính (không có www) | `sigmabloom.vn` |
| `<EMAIL>` | Email đăng ký Let's Encrypt | `admin@sigmabloom.vn` |

---

## Giai đoạn A — Chuẩn bị trên máy local

### A.1. Chuẩn bị code và SSH key

1. **Mở PowerShell**, điều hướng đến thư mục project:
   ```powershell
   cd "C:\Users\ASUS\OneDrive\Máy tính\EXEWEB"
   ```

2. **Tạo SSH key riêng cho deployer** (khuyến nghị — không dùng key cá nhân):
   ```powershell
   ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\cyberknight_admin -N "" -C "deployer-admin"
   ```

3. **Hiển thị public key** để copy sang VPS:
   ```powershell
   Get-Content $env:USERPROFILE\.ssh\cyberknight_admin.pub
   ```
   Copy toàn bộ dòng output (bắt đầu bằng `ssh-ed25519 AAAA...`).

4. **Kiểm tra code:**
   ```powershell
   cd "C:\Users\ASUS\OneDrive\Máy tính\EXEWEB"
   npm run test:all
   ```
   (Nếu MySQL không chạy trên local, integration test sẽ skip — đây là expected.)

---

## Giai đoạn B — Bootstrap VPS (Phase 4–5 tự động)

### B.1. Đăng nhập root lần đầu

```powershell
ssh root@<IP_VPS>
```

### B.2. Upload bootstrap script

Mở **PowerShell mới** (không đóng cửa sổ root đang mở):
```powershell
cd "C:\Users\ASUS\OneDrive\Máy tính\EXEWEB"
scp deploy/bootstrap-server.sh root@<IP_VPS>:/root/
scp deploy/finish-ssh-hardening.sh root@<IP_VPS>:/root/
scp -r deploy root@<IP_VPS>:/opt/cyberknight/
```

### B.3. Chạy bootstrap

```bash
sudo bash /root/bootstrap-server.sh \
  --domain <TEN_MIEN> \
  --email  <EMAIL> \
  --deploy-user deployer
```

Script sẽ:
- Cập nhật hệ thống
- Tạo user `deployer`
- Cài Nginx, MySQL, Node 22 LTS, PM2, fail2ban, unattended-upgrades
- Tạo database `sigmabloom` + 3 user MySQL
- Tạo thư mục `/opt/cyberknight`, `/var/backups/cyberknight`
- **Tạo `/etc/nginx/includes/nginx-proxy-params.conf`**
- Cấu hình Nginx `server_tokens off`

> Script sẽ **dừng ở bước `mysql_secure_installation`** — nhấn Enter để làm theo checklist.

**Sau khi script kết thúc, KHÔNG đóng cửa sổ root.**

---

## Giai đoannh C — SSH Key bootstrap (BẮT BUỘC trước hardening)

> Script `finish-ssh-hardening.sh` **sẽ từ chối chạy** nếu deployer chưa có SSH key.
> Thực hiện TRONG cửa sổ root (cửa sổ đang mở):

```bash
# Tạo thư mục SSH cho deployer
sudo mkdir -p /home/deployer/.ssh

# Tạo file authorized_keys
sudo nano /home/deployer/.ssh/authorized_keys
# Paste public key (ssh-ed25519 AAAA...) vào đây
# Lưu: Ctrl+O, Enter, Ctrl+X

# Phân quyền đúng
sudo chown -R deployer:deployer /home/deployer/.ssh
sudo chmod 700 /home/deployer/.ssh
sudo chmod 600 /home/deployer/.ssh/authorized_keys
```

**Test trong cửa sổ PowerShell mới** (KHÔNG đóng root):
```powershell
ssh -i $env:USERPROFILE\.ssh\cyberknight_admin deployer@<IP_VPS> "whoami && sudo whoami"
```
**Phải in:**
```
deployer
root
```

**Nếu test OK → chạy SSH hardening:**
```bash
# Trong cửa sổ root
sudo bash /root/finish-ssh-hardening.sh
```

**Test sau hardening trong cửa sổ PowerShell mới:**
```powershell
# Phải THÀNH CÔNG:
ssh -i $env:USERPROFILE\.ssh\cyberknight_admin deployer@<IP_VPS>

# Phải THẤT BẠI:
ssh root@<IP_VPS>
# → Permission denied (publickey) ✓
```

---

## Giai đoạn D — Upload code và cấu hình (Phase 6)

### D.1. Tạo thư mục + upload code (as deployer)

```powershell
# Mở cửa sổ PowerShell mới — đăng nhập as deployer
ssh -i $env:USERPROFILE\.ssh\cyberknight_admin deployer@<IP_VPS>

# Trên VPS, as deployer:
mkdir -p /opt/cyberknight
exit  # về local
```

```powershell
# Trên local:
cd "C:\Users\ASUS\OneDrive\Máy tính\EXEWEB"
scp -r . deployer@<IP_VPS>:/opt/cyberknight/
```
> Lệnh này upload toàn bộ project. File `assets/tailwind.css` (đã build sẵn) cũng được upload — **không cần build CSS trên VPS.**

### D.2. Tạo `.env`

```bash
# Trên VPS, as deployer:
ssh -i $env:USERPROFILE\.ssh\cyberknight_admin deployer@<IP_VPS>
cd /opt/cyberknight
cp backend/.env.example backend/.env
chmod 600 backend/.env
nano backend/.env
```

**Nội dung tối thiểu cần điền:**

```env
NODE_ENV=production
PORT=5000
FRONTEND_URL=https://<TEN_MIEN>

# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=sigmabloom_app
DB_PASSWORD=<APP_PW>          # Lấy từ bước bootstrap (đã lưu)
DB_NAME=sigmabloom

# JWT Secrets — SINH 3 LỆNH RIÊNG:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=<secret_1>
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=<secret_2>
JWT_REFRESH_EXPIRES_IN=7d
LEVEL_ACCESS_SECRET=<secret_3>

# CORS
CORS_ORIGINS=https://<TEN_MIEN>

# Admin seed — SAU KHI SETUP XONG, XÓA GIÁ TRỊ NÀY!
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=<mật_khẩu_mạnh_≥12_ký_tự>
SEED_ADMIN_EMAIL=admin@<TEN_MIEN>

# Thanh toán
BANK_ACCOUNT=<số_tài_khoản>
BANK_NAME=<TÊN_CHỦ_TK_IN_HOA_KHÔNG_DẤU>
BANK_BIN=<mã_BIN>          # VietinBank=970415, Vietcombank=970436, MBBank=970422, BIDV=970418
SEPAY_API_KEY=<api_key_ngẫu_nhiên_≥32_ký_tự>
ORDER_TTL_MINUTES=30

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<email@gmail.com>
SMTP_PASS=<app_password>
SMTP_FROM="CyberKnight Shield" <no-reply@<TEN_MIEN>>
FEEDBACK_TO=<email_nhận_phản_hồi>

# Privacy contact
PRIVACY_EMAIL=privacy@<TEN_MIEN>
```

### D.3. Tạo `.env.migrate` (cho update script)

```bash
nano backend/.env.migrate
chmod 600 backend/.env.migrate
```

```env
DB_USER=sigmabloom_migrate
DB_PASSWORD=<MIG_PW>   # Lấy từ bước bootstrap
```

### D.4. Cài dependencies + setup DB

```bash
# Cài production deps (không devDependencies, không Tailwind):
cd /opt/cyberknight/backend
npm ci --omit=dev

# Chạy migrations:
cd /opt/cyberknight
DB_USER=sigmabloom_migrate DB_PASSWORD=<MIG_PW> npm run setup-db
```

**Kết quả mong đợi:**
```
✅ Kết nối MySQL thành công!
✅ Đã tạo database gốc và bảng cơ bản!
✅ Đã áp dụng migration 002_*.sql!
...
🎉 Setup cơ sở dữ liệu hoàn tất!
✅ Đã khởi tạo tài khoản Admin mẫu!
```

### D.5. Khởi chạy PM2

```bash
cd /opt/cyberknight
pm2 start deploy/ecosystem.config.js
pm2 save
# Chạy lệnh mà PM2 in ra (sudo startup):
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u deployer --hp /home/deployer

# Logrotate
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### D.6. Kiểm tra backend

```bash
curl -fsS http://127.0.0.1:5000/api/health
# Phải thấy: {"status":"ok",...}
```

---

## Giai đoạn E — Nginx + HTTPS (Phase 7)

### E.1. Deploy Nginx config

```bash
# Trên VPS, as deployer:
sudo cp /opt/cyberknight/deploy/nginx-proxy-params.conf /etc/nginx/includes/
sudo cp /opt/cyberknight/deploy/nginx.conf.example /etc/nginx/sites-available/cyberknight
sudo ln -sf /etc/nginx/sites-available/cyberknight /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nano /etc/nginx/sites-available/cyberknight
# Thay <TEN_MIEN> bằng tên miền thật
sudo nginx -t && sudo systemctl reload nginx
```

### E.2. Cài Certbot + HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <TEN_MIEN> -d www.<TEN_MIEN> \
  -m <EMAIL> --agree-tos --redirect
```

### E.3. Thêm www→apex redirect (SAU certbot)

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

### E.4. Xác nhận SSL + certbot.timer

```bash
curl -fsS https://<TEN_MIEN>/api/health
# Phải thấy: {"status":"ok",...}

# Certbot gia hạn tự động qua systemd timer:
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

### E.5. Cấu hình SePay Webhook

1. Đăng nhập [my.sepay.vn](https://my.sepay.vn)
2. Vào **Cài đặt → Webhook**:
   - **URL:** `https://<TEN_MIEN>/api/payments/webhook/sepay`
   - **Authentication type:** API Key
   - **API Key:** giá trị bạn đã đặt trong `SEPAY_API_KEY` của `.env`
   - **Header:** `Authorization: Apikey <SEPAY_API_KEY>`
   - **Sự kiện:** Tiền vào (transferType=in)

### E.6. Test thanh toán thật

1. Mở trình duyệt → đăng ký tài khoản test
2. Vào trang thanh toán → tạo đơn hàng
3. Quét mã QR → chuyển khoản đúng số tiền + đúng nội dung (= mã đơn)
4. Kiểm tra sau vài giây: `pm2 logs cyberknight --lines 20`
5. Đơn hàng phải tự chuyển sang `paid`, quyền chơi được cấp

### E.7. Thiết lập backup

```bash
# Tạo file xác thật MySQL:
nano ~/.my.cnf
chmod 600 ~/.my.cnf
```

```ini
[mysqldump]
user=sigmabloom_backup
password=<BK_PW>   # Lấy từ bước bootstrap
```

```bash
# Test backup lần đầu:
bash /opt/cyberknight/deploy/backup-db.sh
ls -lh /var/backups/cyberknight/

# Test restore:
bash /opt/cyberknight/deploy/test-restore.sh
```

### E.8. Crontab cho deployer

```bash
crontab -e
```

Paste nội dung từ `deploy/crontab.example`:
```cron
# Backup hằng ngày 03:00
0 3 * * * /opt/cyberknight/deploy/backup-db.sh >> /home/deployer/cyberknight-backup.log 2>&1

# Test restore hằng tuần (Chủ nhật 04:00)
0 4 * * 0 /opt/cyberknight/deploy/test-restore.sh >> /home/deployer/cyberknight-restore-test.log 2>&1
```

---

## Giai đoạn F — Kiểm tra toàn diện (Phase 8)

```bash
# Chạy post-deploy check:
sudo bash /opt/cyberknight/deploy/postdeploy-check.sh \
  --domain <TEN_MIEN> \
  --db-password "<APP_PW>"
```

### Checklist nghiệm thu nhanh

```bash
# Backend:
curl -fsS https://<TEN_MIEN>/api/health
# → {"status":"ok",...} ✓

# Static files blocked:
curl -fsS https://<TEN_MIEN>/backend/.env
# → 404 ✓

curl -fsS https://<TEN_MIEN>/README.md
# → 404 ✓

# Health endpoint:
curl -fsS https://<TEN_MIEN>/api/health | grep '"status"'
# → "status":"ok" ✓

# Security headers:
curl -I https://<TEN_MIEN>/ 2>/dev/null | grep -iE 'strict-transport|x-content-type|content-security-policy'
# → HSTS, X-Content-Type-Options, CSP ✓

# PM2:
pm2 status
# → cyberknight online ✓

# SePay webhook (không có key → phải 401/403):
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<TEN_MIEN>/api/payments/webhook/sepay
# → 401 hoặc 403 ✓

# Certbot timer:
sudo systemctl status certbot.timer
# → active (running) ✓

# UFW:
sudo ufw status
# → Status: active ✓
```

---

## Giai đoạn G — Vận hành dài hạn

### G.1. Cập nhật code

```bash
cd /opt/cyberknight
bash deploy/update.sh

# Rollback nếu cần:
bash deploy/update.sh --rollback <commit_sha>
```

### G.2. Theo dõi

```bash
# Log:
pm2 logs cyberknight --lines 50

# Trạng thái:
pm2 status

# Backup gần nhất:
ls -lht /var/backups/cyberknight/*.sql.gz | head -3

# Certbot:
sudo systemctl status certbot.timer
```

### G.3. Troubleshooting nhanh

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| 502 Bad Gateway | PM2 chưa chạy | `pm2 status` → `pm2 restart cyberknight` |
| Cookie không lưu | Thiếu HTTPS secure flag | Kiểm tra Nginx proxy headers & `trust proxy` |
| Webhook 401/403 | Sai `SEPAY_API_KEY` | Đối chiếu với cấu hình SePay dashboard |
| QR sai thông tin | Sai `BANK_BIN`/`BANK_ACCOUNT`/`BANK_NAME` | Kiểm tra `.env` |
| Email không gửi | Sai App Password Gmail | Tạo App Password mới tại myaccount.google.com |
| Trang trắng | Thiếu biến `.env` hoặc DB lỗi | `pm2 logs` → kiểm tra `.env` |
| Certbot lỗi | Port 80 bị chặn | `sudo ufw status` + `sudo certbot renew --dry-run` |
| Bị khóa SSH | Lỗi cấu hình | Dùng console/VNC của VPS provider để sửa `/etc/ssh/sshd_config.d/00-hardening.conf` |

---

## Phụ lục A — Biến `.env` đầy đủ

| Biến | Bắt buộc | Mô tả |
|------|-----------|--------|
| `NODE_ENV` | Có | `production` |
| `PORT` | Không | Mặc định `5000` |
| `DB_HOST` | Có | `127.0.0.1` |
| `DB_PORT` | Có | `3306` |
| `DB_USER` | Có | `sigmabloom_app` |
| `DB_PASSWORD` | Có | Mật khẩu app user |
| `DB_NAME` | Có | `sigmabloom` |
| `JWT_SECRET` | Có | ≥ 32 ký tự ngẫu nhiên |
| `JWT_EXPIRES_IN` | Không | `15m` |
| `JWT_REFRESH_SECRET` | Có | ≥ 32 ký tự, **khác** JWT_SECRET |
| `JWT_REFRESH_EXPIRES_IN` | Không | `7d` |
| `LEVEL_ACCESS_SECRET` | Có | ≥ 32 ký tự, **khác** 2 secret trên |
| `FRONTEND_URL` | Có | `https://<TEN_MIEN>` |
| `CORS_ORIGINS` | Không | Thêm origin phụ (phân tách dấu phẩy) |
| `SEED_ADMIN_USERNAME` | Có | `admin` |
| `SEED_ADMIN_PASSWORD` | Có* | ≥ 12 ký tự. **Sau setup: XÓA khỏi .env** |
| `SEED_ADMIN_EMAIL` | Có | `admin@<TEN_MIEN>` |
| `BANK_ACCOUNT` | Có | Số tài khoản |
| `BANK_NAME` | Có | Tên chủ TK (IN HOA KHÔNG DẤU) |
| `BANK_BIN` | Có | Mã BIN |
| `SEPAY_API_KEY` | Có | ≥ 32 ký tự ngẫu nhiên |
| `ORDER_TTL_MINUTES` | Không | Mặc định `30` |
| `SMTP_HOST` | Không | `smtp.gmail.com` |
| `SMTP_PORT` | Không | `587` |
| `SMTP_USER` | Không | Email gửi |
| `SMTP_PASS` | Không | Gmail App Password |
| `SMTP_FROM` | Không | Địa chỉ gửi |
| `FEEDBACK_TO` | Không | Email nhận phản hồi |
| `PRIVACY_EMAIL` | Không (khuyến nghị) | `privacy@<TEN_MIEN>` |

**Sinh secret:**
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# Chạy 3 lần cho 3 secret JWT khác nhau
```

---

*Tài liệu thuộc dự án CyberKnight / Sigmabloom.*
*Cập nhật: 2026-10-18 — Phiên bản chính xác, đã fix 8 nhóm drift.*
