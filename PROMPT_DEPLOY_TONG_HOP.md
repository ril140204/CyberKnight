# PROMPT TỔNG HỢP — AI THỰC HIỆN DEPLOY CyberKnight / Sigmabloom LÊN VPS + TÊN MIỀN

> Cách dùng: đặt file này ở thư mục gốc dự án rồi mở AI coding agent (Claude Code, Cursor, …) và gõ:
> `Đọc file PROMPT_DEPLOY_TONG_HOP.md. Thực hiện lần lượt từng PHASE. Sau mỗi phase dừng lại, báo cáo kèm output lệnh thật và chờ tôi xác nhận. Không làm bước nào không có trong file.`
>
> **Hai chế độ chạy (AI phải hỏi tôi chọn ở đầu phiên):**
> - **Chế độ 1 — "Trợ lý hướng dẫn" (mặc định, an toàn nhất):** AI chạy trên máy local của tôi, **sửa code/viết script trong repo (Phase 1–3)**, rồi ở Phase 4–7 **đưa từng lệnh cho tôi tự gõ trên VPS**, đọc output tôi dán lại và chẩn đoán.
> - **Chế độ 2 — "Agent chạy trên VPS":** tôi cài AI agent **trực tiếp trên VPS** (đã đăng nhập bằng user `deployer`), AI tự chạy lệnh tại đó. Ở chế độ này vẫn áp dụng toàn bộ quy tắc an toàn ở mục 0.3.

---

## 0. BỐI CẢNH, PHẠM VI & QUY TẮC

### 0.1 Dự án
**CyberKnight / Sigmabloom** — web game giáo dục an toàn mạng cho **trẻ em** Việt Nam. Stack: Node.js + Express 4 + MySQL 8, helmet 7, JWT (access 15m + refresh cookie httpOnly), cookie `levelAccess` (JWT httpOnly) để mở level trả phí, thanh toán VietQR + webhook **SePay**, frontend `index.html` / `payment.html` / `admin.html` / `reset-password.html` (nếu có) + `assets/{api.js,safe.js,tailwind.css}`, game trong iframe `level0..level4`. Backend ở `backend/src/server.js`; server phục vụ cả giao diện web lẫn API trên **cùng một origin**. Đã có thư mục `deploy/` (bản nháp) cần được rà lại và hoàn thiện.

Các phase bảo mật 1–8 trước đó đã sửa: khóa webhook dự phòng hard-code, startup fail-fast, seed admin an toàn, level guard fail-closed, CSP chạy được, Tailwind build tĩnh. **Vẫn còn lỗi** trong chính các file deploy và vài chỗ trong code (Phase 1).

### 0.2 Mục tiêu
Sau khi xong, website chạy tại `https://<TEN_MIEN>` trên VPS Ubuntu: HTTPS, Nginx → Node (PM2, chạy bằng user thường), MySQL chỉ nội bộ, thanh toán SePay tự duyệt, sao lưu hằng ngày, có script kiểm tra trước/sau deploy, có quy trình cập nhật & rollback.

### 0.3 QUY TẮC AN TOÀN (bắt buộc, áp dụng cả hai chế độ)
1. **Bí mật:** KHÔNG đọc, in, sao chép, commit hay gửi đi nội dung `backend/.env` thật, mật khẩu VPS/MySQL/admin, khóa SSH riêng (`id_ed25519`, không đuôi `.pub`), API key SePay, Gmail App Password. Chỉ làm việc với `.env.example`. Khi cần giá trị bí mật, **tôi tự nhập** vào file bằng editor (`nano`) hoặc prompt ẩn (`read -s`); AI chỉ hướng dẫn và kiểm tra bằng `predeploy-check.js` (script không in giá trị).
2. **Không đoán:** đọc kỹ file trước khi sửa; mọi nhận định dẫn chứng `file:dòng`. Không tuyên bố "đã sửa/đã pass" nếu chưa chạy; dán output lệnh thật. Phần nào chưa kiểm chứng được phải ghi rõ "chưa kiểm chứng" và lý do.
3. **Xác nhận trước khi làm việc nguy hiểm:** mỗi lệnh có thể xóa dữ liệu, đổi quyền SSH/tường lửa, ghi đè file cấu hình, `rm -rf`, `DROP`, `reset --hard`, `chmod -R`, hay tạm dừng dịch vụ — AI phải **nêu rõ lệnh, tác dụng, rủi ro rồi chờ tôi trả lời "đồng ý"**. Không bao giờ dùng `curl ... | sudo bash` với script không phải của nhà cung cấp chính thức (NodeSource là ngoại lệ đã ghi trong tài liệu).
4. **Chống tự khóa mình:** thay đổi SSH/UFW phải theo đúng quy trình ở Phase 4 (thử đăng nhập bằng user mới ở cửa sổ khác **trước** khi tắt root/mật khẩu; `ufw allow OpenSSH` **trước** `ufw enable`; luôn `sshd -t` trước khi reload).
5. **Idempotent & không ghi đè:** script phải chạy lại an toàn; không bao giờ ghi đè `.env` đã tồn tại, không xóa dữ liệu thật.
6. Thông báo/comment tiếng Việt; tên biến/bảng/script tiếng Anh. Dùng placeholder `<TEN_MIEN>`, `<IP_VPS>`, `<EMAIL>` — **không** hard-code `tenmiencuaban.vn`.
7. Không làm hỏng chức năng hiện có (auth, quên mật khẩu, feedback, mua gói, khóa level, admin). Không đổi nội dung game trong `levelN/`.
8. Không thêm thư viện nặng không cần thiết; script shell chỉ dùng công cụ có sẵn trên Ubuntu.
9. Gặp mâu thuẫn hoặc quyết định chưa rõ → **hỏi tôi**. Các quyết định còn mở ở mục cuối file.
10. Cuối cùng cập nhật `README.md`, `CHANGES.md`, `backend/.env.example` cho khớp thực tế.

### 0.4 Những việc AI KHÔNG làm thay được (tôi tự làm — AI chỉ hướng dẫn)
Mua VPS & tên miền, trỏ DNS, tạo SSH key và giữ khóa riêng, thu hồi Gmail App Password cũ và tạo cái mới, đăng ký SePay + liên kết ngân hàng + cấu hình webhook, tạo repo private, nhập các giá trị bí mật vào `.env`, test chuyển khoản thật số tiền nhỏ, lưu bản sao lưu ra nơi khác.

---

## PHASE 1 — VÁ LỖI TỒN ĐỌNG TRONG CODE VÀ FILE DEPLOY (làm trong repo)

Đây là các lỗi đã được xác định khi rà soát. Với mỗi mục: đọc code → sửa → viết/ cập nhật test → báo cáo Trước/Sau.

### 1.1 🔴 `www` bị CORS chặn → đăng nhập hỏng
`server.js` (mục "4. CORS") chỉ cho phép `FRONTEND_URL` (+ `localhost:5000`, `127.0.0.1:5000`, `CORS_ORIGINS`) và trả **403 `CORS_DENIED`** cho Origin khác. Trình duyệt gửi `Origin` ở request POST cùng-origin, nên người dùng vào `https://www.<TEN_MIEN>` sẽ bị 403 ở đăng nhập/đăng ký/mua gói.
Sửa: (a) Nginx chuyển hướng `www` → tên miền chính (Phase 2.1) và `.env.example` ghi `CORS_ORIGINS=https://www.<TEN_MIEN>` như phương án dự phòng; (b) khi `NODE_ENV=production` **không** đưa `http://localhost:5000` / `http://127.0.0.1:5000` vào `allowedOrigins`; (c) test: Origin lạ → 403; Origin = `FRONTEND_URL` → OK; production không chấp nhận localhost.

### 1.2 🔴 Giới hạn tốc độ có thể khóa cả lớp học dùng chung IP
Học sinh cùng trường thường chung **một IP công khai (NAT)**. Hiện có:
- Nginx mẫu: `zone=auth` **10 request/phút** (burst 20) cho **toàn bộ** `/api/auth/` — kể cả `/refresh` và `/me` (gọi mỗi lần tải trang).
- Express: `loginLimiter` production 10 lần/15 phút/IP, đăng ký 5/giờ/IP, quên mật khẩu 3/giờ/IP.
Sửa (số liệu mặc định, hỏi tôi nếu muốn đổi):
- Nginx: tách zone. `/api/auth/(login|register|forgot-password|reset-password)` → `rate=30r/m burst=30`; các đường dẫn `/api/auth/` còn lại (refresh, me, check-username, logout) → `rate=120r/m burst=60`; `limit_req_status 429;`.
- Express: `loginLimiter` có `keyGenerator` = `IP + ':' + username chuẩn hóa (lowercase)`, tối đa 10/15 phút, **kèm trần theo IP** cao hơn (300/15 phút); đăng ký 30/giờ/IP; quên mật khẩu theo **email** 3/giờ + trần IP 30/giờ. Không lộ việc tài khoản có tồn tại.
- README ghi chú: nếu đặt sau Cloudflare phải cấu hình lấy IP thật, nếu không mọi người dùng chung một IP của Cloudflare.

### 1.3 🔴 `backup-db.sh` sẽ thất bại
Script dùng `sigmabloom_app` (chỉ `SELECT, INSERT, UPDATE, DELETE`) với `mysqldump --single-transaction --routines --triggers` → lỗi quyền trên MySQL 8.
Sửa: user riêng `sigmabloom_backup@localhost` với `SELECT, SHOW VIEW, TRIGGER, LOCK TABLES` trên `sigmabloom.*`; dùng `mysqldump --single-transaction --no-tablespaces` (bỏ `--routines/--events` nếu `migrations/` không có routine/event — kiểm tra rồi quyết định). `~/.my.cnf` mục `[mysqldump]` dùng user backup, quyền `600`; thư mục `/var/backups/cyberknight` quyền `700`, chủ sở hữu là user chạy cron. Script: `set -euo pipefail`, xóa file rỗng/hỏng, cảnh báo nếu file < 1 KB hoặc không thấy `CREATE TABLE`, ghi log, xóa bản cũ hơn 14 ngày; tùy chọn mã hóa (`gpg --symmetric`/`age`) và đẩy ra ngoài (`rclone`) mặc định tắt, có hướng dẫn. Thêm `deploy/restore-db.sh <file.sql.gz>` phục hồi vào DB thử `sigmabloom_restore_test`; **không** ghi đè DB thật trừ khi có tham số xác nhận rõ ràng.

### 1.4 🟠 `ecosystem.config.js` dùng đường dẫn tương đối
Sửa bằng đường dẫn tuyệt đối tính từ file:
```js
const path = require('node:path');
const root = path.resolve(__dirname, '..');
module.exports = { apps: [{
  name: 'cyberknight', script: 'src/server.js', cwd: path.join(root, 'backend'),
  exec_mode: 'fork', instances: 1, env: { NODE_ENV: 'production' },
  max_memory_restart: '300M',
  out_file: path.join(root, 'logs', 'out.log'), error_file: path.join(root, 'logs', 'error.log'),
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z', merge_logs: true,
  kill_timeout: 10000, max_restarts: 10, min_uptime: '10s', restart_delay: 3000, watch: false,
}]};
```
`logs/` được script bootstrap tạo, thêm vào `.gitignore`. Hướng dẫn `pm2 install pm2-logrotate`.

### 1.5 🟠 `nginx.conf.example`
- `proxy_set_header Connection 'upgrade'` + `Upgrade $http_upgrade` ở `location /` làm mọi request bị đánh dấu upgrade → bỏ; dùng `proxy_http_version 1.1; proxy_set_header Connection "";`. Gom các `proxy_set_header` (Host, X-Real-IP, X-Forwarded-For, **X-Forwarded-Proto**) vào `deploy/nginx-proxy-params.conf` và `include`.
- Thêm `proxy_read_timeout 30s; proxy_connect_timeout 5s;`, `gzip on` cho css/js/json/svg; hướng dẫn `server_tokens off;` ở `nginx.conf` chính.
- Giữ khối chặn: file ẩn (trừ `.well-known`), thư mục `backend|node_modules|deploy|logs|.git|.claude|.cursor|_claude|_cursor`, đuôi `env|sql|log|md|yml|yaml|toml|lock|bak|sh`. Cho phép `location ^~ /.well-known/acme-challenge/` (certbot).
- Webhook: `limit_req zone=webhook` với `burst` đủ rộng (SePay có thể gửi dồn); không chặn theo User-Agent.
- Không để chuyển hướng `www` trong cấu hình ban đầu (xem Phase 2.1 về thứ tự).

### 1.6 🟠 `mysql-user.sql` chứa mật khẩu mẫu cố định
`mat_khau_manh_cua_ban`/`mat_khau_migration_cua_ban` → ai đọc repo cũng biết. Bỏ file này hoặc chỉ giữ dạng mẫu placeholder; việc tạo 3 user (`sigmabloom_app`, `sigmabloom_migrate`, `sigmabloom_backup`) + database `utf8mb4` chuyển vào bootstrap (Phase 2.2) với mật khẩu ngẫu nhiên `openssl rand -hex 24`, tạo bằng here-doc (không truyền mật khẩu qua tham số lệnh để khỏi vào history), **in một lần** để tôi lưu vào trình quản lý mật khẩu.

### 1.7 🟠 Trang chặn do server sinh ra vẫn tải Tailwind từ CDN
`middleware/levelGuard.js` (~dòng 87) và `middleware/checkLevelAccess.js` (~dòng 88) còn `<script src="https://cdn.tailwindcss.com">`; CSP đã không cho nguồn này → trang "Vui lòng đăng nhập / Cần mua gói" mất giao diện. Sửa: dùng `<link rel="stylesheet" href="/assets/tailwind.css">` (thêm class đang dùng vào safelist/`content`, chạy `npm run build:css`) hoặc CSS inline nhỏ; `escapeHtml` cho `${title}`/`${heading}`. Rà toàn bộ `src/` để không còn nguồn CDN nào khác. Thêm `./reset-password.html` vào `content` của `tailwind.config.js` rồi build lại; xác nhận file này **có tồn tại** (README nhắc tới nhưng bản tôi đưa chưa có — nếu thiếu, báo tôi).

### 1.8 🟠 Xử lý lỗi
`server.js` có `process.on('uncaughtException', …)` chỉ log rồi **tiếp tục chạy** → trạng thái không xác định. Sửa: log rồi `process.exit(1)` (PM2 khởi động lại). `unhandledRejection`: log + đếm; lặp quá ngưỡng/phút thì thoát. Xác nhận `errorHandler.js` không trả stack/SQL ở production.

### 1.9 🟠 Đổi mật khẩu admin (tài liệu hiện nói sai)
`DEPLOY.md` bảo "đăng nhập admin → Đổi mật khẩu" nhưng repo **không có** tính năng này. Chọn (hỏi tôi, mặc định **A**):
- **A:** thêm `POST /api/auth/change-password` (auth; mật khẩu cũ + mới ≥ 12 ký tự mạnh; bcrypt; thu hồi mọi refresh token + xóa cache quyền; rate limit; test) + form nhỏ trong khu vực tài khoản/admin.
- **B:** chỉ sửa tài liệu: đặt `SEED_ADMIN_PASSWORD` mạnh lúc setup đầu rồi **xóa dòng đó khỏi `.env`**; đổi sau này bằng `node src/config/seed.js --reset-admin-password`.
Dù chọn gì: `SEED_ADMIN_EMAIL` phải là hộp thư thật của tôi; tài liệu phải dặn xóa `SEED_ADMIN_PASSWORD` khỏi `.env` sau lần setup đầu.

### 1.10 🟠 Node.js 20 đã hết hạn hỗ trợ (EOL cuối 04/2026)
Hướng dẫn cài **Node 22 LTS** (`setup_22.x`); cập nhật README/DEPLOY; giữ `"engines": ">=20"` nhưng ghi khuyến nghị 22. Chạy toàn bộ test trên Node 22.

### 1.11 🟡 Khác
- `backend/.env` thật nằm trong các file tôi từng gửi (đang `NODE_ENV=development`, `DB_USER=root`, có `SMTP_PASS`, thông tin ngân hàng, khóa webhook dạng cũ). **Không dùng nó cho production** — nhắc tôi: thu hồi Gmail App Password, sinh toàn bộ secret/khóa mới, tạo `.env` mới trên server. `.gitignore` gốc phải chặn: `.env`, `.env.*` (trừ `.env.example`), `*.zip`, `node_modules/`, `logs/`, `_claude/`, `_cursor/`, `.claude/`, `.cursor/`, `repomix-output.xml`, `*.sql.gz`, `*.bak`.
- README/DEPLOY nói "audit log bất biến" nhưng `sigmabloom_app` có `UPDATE/DELETE` mọi bảng → sửa cách diễn đạt.
- Còn ~57 + 17 + 2 handler `onclick=` inline (`index/admin/payment`) nên CSP vẫn `script-src-attr 'unsafe-inline'` và `script-src 'unsafe-inline'`. Ghi vào README mục "Rủi ro còn lại" + lộ trình chuyển sang `addEventListener` + nonce (ưu tiên `admin.html`); **không bắt buộc** cho lần deploy đầu.
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` — kiểm tra game (đặc biệt Level 3 dạy quyền Camera/Micro) có gọi API trình duyệt tương ứng thật không; nếu có, nới đúng phần cần.

**Kết thúc Phase 1:** bảng Trước/Sau cho 1.1–1.11 + output test; dừng chờ xác nhận.

---

## PHASE 2 — VIẾT BỘ FILE TRIỂN KHAI (`deploy/`)

Mọi file có comment tiếng Việt, chạy được trên Ubuntu 22.04/24.04, không chứa bí mật.

### 2.1 `deploy/nginx.conf.example` + thứ tự HTTPS đúng
1. Cấu hình ban đầu: `server { listen 80; server_name <TEN_MIEN> www.<TEN_MIEN>; … }` (chưa chuyển hướng `www`).
2. `certbot --nginx -d <TEN_MIEN> -d www.<TEN_MIEN> -m <EMAIL> --agree-tos --redirect`.
3. **Sau đó** thêm vào khối `server` có `listen 443 ssl`, ngay dưới `server_name`:
   `if ($host = www.<TEN_MIEN>) { return 301 https://<TEN_MIEN>$request_uri; }`
4. `nginx -t && systemctl reload nginx`.
(Chuyển hướng `www` ngay từ đầu sẽ làm certbot lỗi xác thực HTTP-01 cho tên `www`.)

### 2.2 `deploy/bootstrap-server.sh` — chạy **một lần** trên VPS mới, có `--dry-run`, xác nhận từng bước, idempotent
1. Kiểm tra Ubuntu 22.04/24.04 và quyền root; hỏi `<TEN_MIEN>`, email Let's Encrypt, tên user triển khai (mặc định `deployer`).
2. Tạo `deployer` (sudo), copy `authorized_keys`. **Chỉ khóa root/mật khẩu SSH sau khi tôi xác nhận đã đăng nhập thử bằng `deployer` ở cửa sổ khác.** File `/etc/ssh/sshd_config.d/00-hardening.conf` (tiền tố `00-` để thắng `50-cloud-init.conf`): `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `MaxAuthTries 3`, `X11Forwarding no`; `sshd -t` → `systemctl reload ssh`; in `sshd -T | grep -E 'passwordauthentication|permitrootlogin'`.
3. UFW: `allow OpenSSH`, `allow 'Nginx Full'`, rồi `enable`. `fail2ban` (jail sshd). `unattended-upgrades`.
4. Múi giờ `Asia/Ho_Chi_Minh`; swapfile 2 GB nếu RAM ≤ 2 GB; MySQL tiết kiệm RAM (`/etc/mysql/mysql.conf.d/zz-lowmem.cnf`: `bind-address=127.0.0.1`, `innodb_buffer_pool_size=128M`, `performance_schema=OFF`).
5. Cài `nginx mysql-server git curl rsync ufw fail2ban`, **Node 22 LTS** (NodeSource), `pm2`; `server_tokens off`.
6. MySQL: database `sigmabloom` (`utf8mb4`) + 3 user theo 1.3/1.6, mật khẩu ngẫu nhiên in **một lần**.
7. Tạo `/opt/cyberknight` (chủ `deployer`), `logs/`, `/var/backups/cyberknight` (`700`).
8. In "việc tiếp theo".

### 2.3 `deploy/update.sh` (chạy bằng `deployer`) — cập nhật có rollback
`git fetch` → kiểm tra không có thay đổi chưa commit → **sao lưu DB** → ghi commit hiện tại → `git pull --ff-only` → `cd backend && npm ci --omit=dev` → nếu có migration mới: chạy `setup-db` với thông tin `sigmabloom_migrate` lấy từ **`backend/.env.migrate` (quyền 600, không commit)** → `pm2 reload cyberknight` → `curl -fsS http://127.0.0.1:5000/api/health`; **thất bại thì tự rollback** về commit cũ + `npm ci` + `pm2 reload` rồi báo lỗi. Có `--rollback <commit>`.
Xác minh `setupDb.js`/`seed.js` nạp dotenv **không ghi đè** biến môi trường đã có (để `DB_USER=… npm run setup-db` hoạt động) và `setup-db` chạy lại nhiều lần vẫn an toàn.

### 2.4 Các file còn lại
`deploy/backup-db.sh`, `deploy/restore-db.sh`, `deploy/ecosystem.config.js`, `deploy/nginx-proxy-params.conf` (theo 1.3–1.5); `deploy/crontab.example` (sao lưu 03:00 hằng ngày dưới `deployer`; kiểm tra phục hồi hằng tuần vào DB thử).

### 2.5 `deploy/DEPLOY.md` viết lại theo thứ tự ở **Phase 4–7** của file này
Mỗi bước có lệnh, kết quả mong đợi, cách kiểm tra, lỗi thường gặp; dùng `<TEN_MIEN>`; có mục khắc phục sự cố (Phase 8) và lưu ý pháp lý.

---

## PHASE 3 — SCRIPT KIỂM TRA TRƯỚC & SAU DEPLOY

### 3.1 `backend/scripts/predeploy-check.js <đường_dẫn_.env>`
Không in giá trị bí mật; PASS/FAIL từng mục; thoát mã ≠ 0 nếu có FAIL:
- `NODE_ENV=production`; `FRONTEND_URL` bắt đầu `https://`, không có `/` cuối, không phải localhost.
- `DB_USER` ≠ `root`; `DB_PASSWORD` ≥ 20 ký tự; `DB_HOST` là `localhost`/`127.0.0.1`.
- 3 secret JWT/refresh/level: ≥ 48 ký tự, khác nhau, không chứa chuỗi yếu (tái dùng `validateConfig` ở `startupCheck.js`).
- `SEPAY_API_KEY` ≥ 32 ký tự, **không** bằng/khởi đầu như khóa cũ `sepay_webhook_secret_key_sigmabloom_2026` (`sepay_webhook_secret…`); còn biến `PAYMENT_WEBHOOK_SECRET` → cảnh báo nên xóa.
- `BANK_BIN` đúng 6 chữ số; `BANK_ACCOUNT` chỉ chữ số; `BANK_NAME` in hoa không dấu.
- SMTP đã cấu hình (cảnh báo nếu trống); `SEED_ADMIN_EMAIL` không phải `@sigmabloom.vn`/`@example.*`; còn `SEED_ADMIN_PASSWORD` sau setup → cảnh báo xóa.
- Quyền file `.env` = `600` (Linux).
- Repo: `git ls-files` không chứa `.env*` (trừ example), `*.zip`, `_claude`, `_cursor`; `assets/tailwind.css` tồn tại; `npm audit --omit=dev` (tóm tắt high/critical; không fail nếu offline).
- Kết nối DB thử (chỉ `SELECT 1`) và các bảng bắt buộc tồn tại (`users`, `orders`, `payment_transactions`, `user_entitlements`, `admin_audit_log`).

### 3.2 `deploy/postdeploy-check.sh https://<TEN_MIEN>` (chạy từ máy có `curl`)
PASS/FAIL cho:
- `/` = 200; `/api/health` = 200; `/assets/safe.js` = 200; `/assets/quests.json` = 200.
- Phải 403/404: `/backend/.env`, `/backend/src/server.js`, `/package.json`, `/backend/package.json`, `/README.md`, `/CHANGES.md`, `/deploy/DEPLOY.md`, `/.git/config`, `/node_modules/x`, `/%2e%2e/backend/.env`, `/assets/..%2fbackend/.env`, `/level1/README.md`.
- `/level0/level0.html` = 200; `/level1/level1.html` (không cookie) = 401/403; `/level99/x.html` = 404.
- `POST /api/payments/webhook/sepay` không key = 401/403; với khóa cũ `sepay_webhook_secret_key_sigmabloom_2026` = 401/403.
- Header: `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `frame-ancestors`/`X-Frame-Options`, `Referrer-Policy`; không có `X-Powered-By`; `Server` không lộ số phiên bản.
- `http://<TEN_MIEN>` → 301 `https://`; `https://www.<TEN_MIEN>` → 301 về tên miền chính; chứng chỉ còn hạn > 14 ngày.
- `POST /api/auth/login` sai mật khẩu nhiều lần với username giả → cuối cùng 429 (không dùng tài khoản thật).
- Tùy chọn cờ `--ssh user@host` để kiểm tra `ss -tlnp` (chỉ 22/80/443 công khai; 3306/5000 ở `127.0.0.1`); mặc định chỉ in lệnh để tôi tự chạy.

### 3.3 Test & báo cáo Phase 1–3
Thêm test (CORS production, rate limit IP+username, trang chặn dùng `/assets/tailwind.css`, `predeploy-check` với `.env` mẫu tốt/xấu, `change-password` nếu chọn A) vào `npm run test:all`. Chạy **thật** trên Node 22: `cd backend && npm ci && npm run setup-db && npm run test:all`. Thiếu MySQL → nói rõ test nào **chưa chạy**. Chạy `bash -n` và `shellcheck` (nếu có) cho mọi `.sh`; `nginx -t` nếu có Nginx (thay `<TEN_MIEN>` bằng `example.test`). Dừng chờ xác nhận.

---

## PHASE 4 — VPS: ĐĂNG NHẬP LẦN ĐẦU, USER RIÊNG, KHÓA SSH, TƯỜNG LỬA

*(Chế độ 1: AI đưa lệnh, tôi gõ và dán output. Chế độ 2: AI chạy theo đúng thứ tự dưới đây, mỗi bước nguy hiểm chờ tôi đồng ý.)*

**Việc tôi tự làm trước:** mua VPS Ubuntu 24.04 LTS (≥ 1 vCPU, khuyến nghị 2 GB RAM, SSD ≥ 25 GB, vị trí VN/Singapore); tạo SSH key trên Windows (`ssh-keygen -t ed25519 -C "cyberknight-vps"`, nên đặt passphrase, dán **khóa công khai `.pub`** vào VPS); mua tên miền; tạo bản ghi DNS `A` cho `@` và `www` → `<IP_VPS>` rồi kiểm tra `nslookup <TEN_MIEN>` / `nslookup www.<TEN_MIEN>` trả đúng IP (**chưa trỏ xong thì chưa làm HTTPS**); thu hồi Gmail App Password cũ.

1. `ssh root@<IP_VPS>` (lần đầu).
2. Tạo user: `adduser deployer`; `usermod -aG sudo deployer`; `rsync --archive --chown=deployer:deployer ~/.ssh /home/deployer` (nếu thiếu `~/.ssh`, dán khóa công khai vào `/home/deployer/.ssh/authorized_keys`, `chown`/`chmod 700/600`).
3. **Mở cửa sổ SSH MỚI**, `ssh deployer@<IP_VPS>` rồi `sudo whoami` phải in `root`. **Chưa thành công thì không làm bước 4.**
4. Khóa SSH: ghi `/etc/ssh/sshd_config.d/00-hardening.conf` (`PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `MaxAuthTries 3`, `X11Forwarding no`), `sudo sshd -t && sudo systemctl reload ssh`, kiểm tra `sudo sshd -T | grep -E "passwordauthentication|permitrootlogin"` → cả hai `no`; giữ cửa sổ cũ, mở cửa sổ mới thử lại.
5. `sudo apt update && sudo apt upgrade -y`; cài `ufw fail2ban unattended-upgrades`; `sudo ufw allow OpenSSH` → `sudo ufw allow 'Nginx Full'` (nếu chưa có profile, làm sau khi cài nginx) → `sudo ufw enable`; `sudo systemctl enable --now fail2ban`; `sudo dpkg-reconfigure -plow unattended-upgrades`; `sudo timedatectl set-timezone Asia/Ho_Chi_Minh`.
6. Swap nếu RAM ≤ 2 GB: `fallocate -l 2G /swapfile`, `chmod 600`, `mkswap`, `swapon`, thêm vào `/etc/fstab`.
(Có thể thay 5–6 + Phase 5 bằng `deploy/bootstrap-server.sh` sau khi tôi đã tự làm xong bước 1–4.)

---

## PHASE 5 — CÀI PHẦN MỀM & MYSQL

1. `sudo apt install -y nginx mysql-server git curl rsync`.
2. Node 22 LTS: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -` → `sudo apt install -y nodejs` → `node -v` (v22.x) → `sudo npm i -g pm2`.
3. `sudo mysql_secure_installation` (xóa anonymous users, cấm root từ xa, xóa DB test; root dùng socket nên không cần đặt mật khẩu root). Xác nhận `sudo ss -tlnp | grep 3306` chỉ thấy `127.0.0.1`. RAM ≤ 2 GB: ghi `zz-lowmem.cnf` rồi `sudo systemctl restart mysql`.
4. Tạo DB + 3 user với mật khẩu ngẫu nhiên (here-doc, không để mật khẩu trong tham số lệnh):
```bash
APP_PW=$(openssl rand -hex 24); MIG_PW=$(openssl rand -hex 24); BK_PW=$(openssl rand -hex 24)
sudo mysql <<SQL
CREATE DATABASE IF NOT EXISTS sigmabloom CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'sigmabloom_app'@'localhost'     IDENTIFIED BY '${APP_PW}';
GRANT SELECT, INSERT, UPDATE, DELETE ON sigmabloom.* TO 'sigmabloom_app'@'localhost';
CREATE USER IF NOT EXISTS 'sigmabloom_migrate'@'localhost' IDENTIFIED BY '${MIG_PW}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP ON sigmabloom.* TO 'sigmabloom_migrate'@'localhost';
CREATE USER IF NOT EXISTS 'sigmabloom_backup'@'localhost'  IDENTIFIED BY '${BK_PW}';
GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES ON sigmabloom.* TO 'sigmabloom_backup'@'localhost';
FLUSH PRIVILEGES;
SQL
echo "APP: $APP_PW"; echo "MIGRATE: $MIG_PW"; echo "BACKUP: $BK_PW"; unset APP_PW MIG_PW BK_PW
```
**Tôi chép 3 mật khẩu vào trình quản lý mật khẩu** rồi `clear && history -c`. Ở Chế độ 2, AI **không được đọc/ghi lại** các mật khẩu này vào file/log/chat.

---

## PHASE 6 — ĐƯA CODE, `.env`, DATABASE, PM2

1. `sudo mkdir -p /opt/cyberknight && sudo chown deployer:deployer /opt/cyberknight`.
2. **Đưa code (hỏi tôi chọn):**
   - **A (khuyến nghị) — git repo private + deploy key chỉ đọc:** trên máy tôi: kiểm tra `.gitignore`, `git init && git add . && git status` (**không được thấy** `.env`, `*.zip`, `node_modules`, `_claude`, `_cursor`; nếu thấy thì dừng, sửa `.gitignore`, `git rm -r --cached`), commit, push lên repo **Private**. Trên VPS: `ssh-keygen -t ed25519 -f ~/.ssh/cyberknight_deploy -N "" -C cyberknight-deploy`, dán `.pub` vào repo → Settings → Deploy keys (**tắt** "Allow write access"), thêm vào `~/.ssh/config` (`Host github.com`, `IdentityFile ~/.ssh/cyberknight_deploy`, `IdentitiesOnly yes`; `chmod 600`), `git clone git@github.com:<USER>/<REPO>.git /opt/cyberknight`.
   - **B — đóng gói tar:** Windows: `tar -czf ..\cyberknight.tar.gz --exclude=node_modules --exclude=.env --exclude=*.zip --exclude=_claude --exclude=_cursor --exclude=.claude --exclude=.cursor --exclude=.git --exclude=logs .` → `scp ..\cyberknight.tar.gz deployer@<IP_VPS>:/tmp/` → VPS: `tar -xzf /tmp/cyberknight.tar.gz -C /opt/cyberknight && rm /tmp/cyberknight.tar.gz`.
3. `cd /opt/cyberknight/backend && npm ci --omit=dev && mkdir -p /opt/cyberknight/logs`. Kiểm tra `ls -la /opt/cyberknight/assets/tailwind.css` (thiếu thì build trên máy local `npm run build:css` rồi đưa lên).
4. **Tạo `.env` production (tôi tự nhập):** `cp .env.example .env && chmod 600 .env`. Sinh 3 secret khác nhau và 1 khóa webhook: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` (3 lần) + `randomBytes(32)` cho `SEPAY_API_KEY`. Các biến cần có:
```env
NODE_ENV=production
PORT=5000
FRONTEND_URL=https://<TEN_MIEN>
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=sigmabloom_app
DB_PASSWORD=<APP_PW>
DB_NAME=sigmabloom
JWT_SECRET=<chuỗi 1>
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=<chuỗi 2>
JWT_REFRESH_EXPIRES_IN=7d
LEVEL_ACCESS_SECRET=<chuỗi 3>
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=<≥12 ký tự, hoa/thường/số/ký tự đặc biệt>
SEED_ADMIN_EMAIL=<hộp thư THẬT của tôi>
BANK_BIN=<6 chữ số>
BANK_ACCOUNT=<số tài khoản>
BANK_NAME=<TEN CHU TAI KHOAN IN HOA KHONG DAU>
SEPAY_API_KEY=<khóa webhook vừa sinh>
ORDER_TTL_MINUTES=30
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<gmail>
SMTP_PASS=<Gmail App Password MỚI>
SMTP_FROM="CyberKnight Shield" <no-reply@<TEN_MIEN>>
FEEDBACK_TO=<email nhận phản hồi>
```
   Không để `PAYMENT_WEBHOOK_SECRET`; không dùng chuỗi mẫu trong README/`.env.example`. BIN phổ biến: VietinBank 970415, Vietcombank 970436, MB 970422, BIDV 970418, Techcombank 970407, ACB 970416, TPBank 970423 — **xác minh lại ở bước quét QR (Phase 7.3)**. Chạy `node scripts/predeploy-check.js .env` → mọi dòng PASS mới đi tiếp.
5. **Khởi tạo DB bằng user migrate, không sửa `.env`:**
```bash
cd /opt/cyberknight/backend
read -s -p "Mật khẩu sigmabloom_migrate: " MIGPW; echo
DB_USER=sigmabloom_migrate DB_PASSWORD="$MIGPW" npm run setup-db
unset MIGPW
```
   Mong đợi: migration 002→007 chạy xong, tạo admin. **Ngay sau đó tôi xóa dòng `SEED_ADMIN_PASSWORD` khỏi `.env`.** Chạy thử `NODE_ENV=production node src/server.js` ~10 giây (Ctrl+C) để bắt lỗi cấu hình sớm (`LỖI BẢO MẬT KHỞI ĐỘNG` → sửa `.env`).
6. **PM2 (bằng `deployer`, không bằng root):** `cd /opt/cyberknight && pm2 start deploy/ecosystem.config.js && pm2 status && pm2 logs cyberknight --lines 30 && curl -fsS http://127.0.0.1:5000/api/health && pm2 save && pm2 startup systemd -u deployer --hp /home/deployer` (chạy đúng câu `sudo env PATH=…` PM2 in ra) `&& pm2 save && pm2 install pm2-logrotate`. **Không dùng `npm start`.** Kiểm tra sống lại sau reboot (`sudo reboot` → `pm2 status` = online).

---

## PHASE 7 — NGINX, HTTPS, SEPAY, THANH TOÁN THẬT, SAO LƯU

### 7.1 Nginx (chưa HTTPS)
`sudo cp /opt/cyberknight/deploy/nginx.conf.example /etc/nginx/sites-available/cyberknight` → thay `<TEN_MIEN>` bằng tên miền thật → `sudo ln -s … /etc/nginx/sites-enabled/` → `sudo rm -f /etc/nginx/sites-enabled/default` → `sudo nginx -t && sudo systemctl reload nginx` → `curl -I http://<TEN_MIEN>/` = 200. (Chạy lại `ufw allow 'Nginx Full'` nếu Phase 4 chưa làm được.)

### 7.2 HTTPS
`sudo apt install -y certbot python3-certbot-nginx` → `sudo certbot --nginx -d <TEN_MIEN> -d www.<TEN_MIEN> -m <EMAIL> --agree-tos --redirect` → `sudo certbot renew --dry-run` → `systemctl status certbot.timer`. **Sau đó** thêm chuyển hướng `www` (Phase 2.1 bước 3), `nginx -t && reload`, kiểm tra `curl -I https://www.<TEN_MIEN>/` = 301 và `curl -I https://<TEN_MIEN>/` = 200 có HSTS. Mở trình duyệt: có ổ khóa, bấm được mọi nút, vào được Level 0.

### 7.3 SePay + test thanh toán thật (tôi tự làm, AI hướng dẫn và đọc log)
1. Đăng ký **my.sepay.vn**, liên kết tài khoản ngân hàng theo hướng dẫn của SePay (điều kiện/phí theo **docs.sepay.vn** hiện hành).
2. Tích hợp Webhooks → thêm webhook: URL `https://<TEN_MIEN>/api/payments/webhook/sepay`; kiểu chứng thực **API Key** = đúng `SEPAY_API_KEY` (SePay gửi `Authorization: Apikey <KEY>`); chỉ sự kiện **tiền vào**. (Tên mục có thể khác; theo docs.) Khuyến nghị đặt tiền tố nhận diện `CK`.
3. Tạo tài khoản người chơi thường → tạo đơn gói rẻ nhất → **quét QR bằng app ngân hàng, kiểm tra bằng mắt**: đúng ngân hàng, số tài khoản, **tên chủ TK**, số tiền, nội dung = mã đơn `CK`+8 ký tự → chuyển khoản số tiền thật → trong vài giây đơn `paid`, level mở không cần tải lại, email xác nhận đến (`pm2 logs cyberknight --lines 50`). Thử thêm: chuyển thiếu tiền và chuyển sai nội dung → phải hiện ở tab **Giao dịch lỗi** của admin để duyệt tay.

### 7.4 Sao lưu
Tạo `~/.my.cnf` (`[mysqldump]`, user `sigmabloom_backup`, mật khẩu của user này — **tôi tự nhập**, `chmod 600`), `/var/backups/cyberknight` quyền 700; chạy thử `bash deploy/backup-db.sh` (phải `[OK]`, file > 1 KB); `crontab -e` thêm `0 3 * * * /opt/cyberknight/deploy/backup-db.sh >> ~/cyberknight-backup.log 2>&1`. Bản sao lưu cùng VPS thì mất VPS là mất hết → mỗi tuần tải ít nhất một bản về máy tôi (`scp deployer@<IP_VPS>:/var/backups/cyberknight/<file>.sql.gz D:\backup\`) hoặc bật đẩy ra ngoài (rclone). Thử phục hồi định kỳ vào DB thử bằng `restore-db.sh`.

---

## PHASE 8 — NGHIỆM THU, VẬN HÀNH, SỰ CỐ

### 8.1 Nghiệm thu (chạy `deploy/postdeploy-check.sh https://<TEN_MIEN>` + thủ công)
- [ ] Mọi nút trên trang chủ bấm được, Console (F12) không lỗi đỏ; Level 0 chơi được trong iframe.
- [ ] `/backend/.env`, `/package.json`, `/backend/src/server.js`, `/README.md` → 403/404; `/level1/level1.html` không cookie → 401/403.
- [ ] Đăng nhập admin bằng `admin/admin` hoặc `Admin@123456` → **thất bại**; mật khẩu thật → vào được `/admin.html`.
- [ ] Đăng ký username chứa `<script>` → bị từ chối; trang admin không chạy script từ dữ liệu người dùng.
- [ ] Cookie `refreshToken`, `levelAccess` có `HttpOnly; Secure; SameSite`.
- [ ] Webhook không key → 401/403; khóa cũ `sepay_webhook_secret_key_sigmabloom_2026` → bị từ chối.
- [ ] Mua gói thật số tiền nhỏ → tự mở khóa (7.3).
- [ ] VPS: `sudo ss -tlnp` chỉ 22/80/443 công khai, 3306/5000 ở `127.0.0.1`.
- [ ] Tạm dừng MySQL (`sudo systemctl stop mysql`) → level trả phí **không** vào được (fail-closed), trang chủ + Level 0 vẫn chạy; **bật lại ngay** (`sudo systemctl start mysql`).
- [ ] `pm2 status` online, reboot xong vẫn online; `certbot renew --dry-run` OK.

### 8.2 Vận hành
- **Cập nhật:** `bash deploy/update.sh` (tự sao lưu + rollback) hoặc thủ công: `bash deploy/backup-db.sh && git pull --ff-only && (cd backend && npm ci --omit=dev) && pm2 reload cyberknight && curl -fsS http://127.0.0.1:5000/api/health`; có migration mới thì chạy `setup-db` với user migrate trước `pm2 reload`.
- **Quay lại bản cũ:** `git checkout <commit-cũ>` → `npm ci --omit=dev` → `pm2 reload cyberknight`.
- **Giám sát:** UptimeRobot theo dõi `https://<TEN_MIEN>/api/health`; `pm2 logs cyberknight`; `sudo tail -f /var/log/nginx/error.log`; hằng tháng `apt upgrade` + `npm audit --omit=dev`.

### 8.3 Bảng khắc phục sự cố (AI dùng để chẩn đoán từ output tôi dán)
| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Không `ssh` được sau khi khóa mật khẩu | Chưa thêm đúng key cho `deployer` | Dùng console web của nhà cung cấp, tạm bật lại `PasswordAuthentication yes`, sửa key |
| 502 Bad Gateway | Node/PM2 không chạy | `pm2 status`, `pm2 logs`, `pm2 restart cyberknight` |
| Server thoát ngay khi khởi động | `.env` không đạt kiểm tra production | Đọc dòng `LỖI BẢO MẬT KHỞI ĐỘNG`, sửa `.env` |
| Certbot lỗi xác thực | DNS chưa trỏ, port 80 bị chặn, hoặc chuyển hướng `www` quá sớm | `nslookup`, `ufw status`, bỏ tạm chuyển hướng |
| `CORS_DENIED` khi đăng nhập | Vào bằng `www.` hoặc `http://`; `FRONTEND_URL` sai/có `/` cuối | Làm chuyển hướng `www`; sửa `FRONTEND_URL` |
| "Quá nhiều yêu cầu" khi cả lớp dùng | Giới hạn theo IP quá chặt | Mục 1.2 |
| Đăng nhập xong bị đăng xuất liên tục | Cookie `Secure` không lưu vì không có HTTPS / thiếu `X-Forwarded-Proto` | Truy cập bằng `https://`; kiểm tra `nginx-proxy-params.conf` |
| Webhook 401/403 | `SEPAY_API_KEY` khác giá trị trong SePay | Dán lại cho khớp; `pm2 restart cyberknight` |
| Chuyển khoản không tự duyệt | Sai/thiếu mã đơn, thiếu tiền, SePay chưa gọi được webhook | Admin → tab Giao dịch lỗi → đối soát tay; xem `pm2 logs` và lịch sử webhook trong SePay |
| QR sai thông tin | Sai `BANK_BIN/BANK_ACCOUNT/BANK_NAME` | Sửa `.env`, restart, quét lại |
| Email không gửi | App Password sai/chưa bật 2FA | Tạo lại App Password, cập nhật `SMTP_PASS`, restart |
| Trang trơ chữ, không giao diện | Thiếu `assets/tailwind.css` hoặc class mới chưa build | `npm run build:css` local rồi đưa lên |
| Nút bấm không phản ứng | CSP chặn script | F12 → Console, tìm lỗi CSP |
| MySQL tự tắt vì thiếu RAM | VPS 1 GB không swap | Tạo swap + `zz-lowmem.cnf` |
| Backup rỗng/lỗi | Sai quyền user backup | Kiểm tra `~/.my.cnf`, quyền `sigmabloom_backup`, `--no-tablespaces` |

### 8.4 Lưu ý pháp lý & vận hành (ghi vào `DEPLOY.md`, không phải tư vấn pháp lý)
Dự án thu thập dữ liệu **trẻ em** (tên, email, năm sinh): nên có **Chính sách bảo mật** + **Điều khoản sử dụng**, cơ chế phụ huynh đồng ý, cách yêu cầu xóa dữ liệu; tham khảo **Nghị định 13/2023/NĐ-CP**. Bán gói thường xuyên: hỏi kế toán/cơ quan thuế về đăng ký kinh doanh và nhận tiền vào tài khoản nào. Ghi rõ chính sách hoàn tiền và email hỗ trợ trên web.

---

## PHASE 9 — BÁO CÁO CUỐI (bắt buộc)

(a) Danh sách file tạo/sửa; (b) bảng Trước/Sau cho từng lỗi ở Phase 1; (c) **output thật** của test, `predeploy-check`, `postdeploy-check` (không tóm tắt tự viết); (d) mục **chưa kiểm chứng** và lý do; (e) danh sách **việc tôi còn phải tự làm** (mục 0.4) và việc nên làm sau: chuyển inline handler sang `addEventListener` + nonce để siết CSP, sao lưu ra ngoài, bật giám sát, soạn chính sách bảo mật/điều khoản.

---

## QUYẾT ĐỊNH CÒN MỞ — AI phải hỏi tôi ở đầu phiên (mặc định ghi trong ngoặc)
1. Chế độ chạy: Trợ lý hướng dẫn hay Agent chạy trên VPS? (**Trợ lý hướng dẫn**)
2. Tên miền chính thức, có dùng `www` không, email Let's Encrypt? (**hỏi tôi**)
3. Đổi mật khẩu admin: làm `change-password` (A) hay chỉ sửa tài liệu (B)? (**A**)
4. Số liệu rate limit ở 1.2 có ổn không? (**như đã ghi**)
5. Đưa code bằng git + deploy key hay tar? (**git, repo private**)
6. Có đặt sau Cloudflare không? (**không ở lần đầu**)
7. Có bật sao lưu ra ngoài (rclone/Google Drive/S3) ngay không? (**tài liệu hóa, tôi bật sau**)
8. Nhà cung cấp webhook: SePay hay Casso? (**SePay**)
