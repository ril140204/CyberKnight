# 🛡️ CyberKnight — Nền Tảng Game Giáo Dục An Toàn Mạng Cho Trẻ Em

> **CyberKnight (Sigmabloom)** là nền tảng web game tương tác kết hợp giáo dục an toàn thông tin và kỹ năng số dành cho trẻ em Việt Nam. Nền tảng tích hợp hệ thống thanh toán tự động VietQR Napas 24/7 qua cổng SePay, phân quyền màn chơi theo thời gian thực và kiến trúc phòng vệ an ninh tầng sâu (Defense-in-Depth).

---

## 🌟 Tính Năng Nổi Bật

- **Hành Trình Màn Chơi (Level 0 – 4):**
  - **Level 0 (Miễn phí):** *Hộp Quà Bí Ẩn* — Nhận diện mã độc và đường link quà tặng khả nghi.
  - **Level 1 (Gói Trả Phí):** *Lớp Trưởng Gửi Link Nhận Quà* — Mini-game Lưới Lọc An Toàn và 3 nhánh kết cục độc lập.
  - **Level 2 (Gói Trả Phí):** *Kết Bạn Online* — Ghép cửa căn cứ, phân loại đối tượng lạ trên không gian mạng.
  - **Level 3 (Gói Trả Phí):** *Bốn Chìa Khóa Bí Mật* — Quản lý 4 quyền truy cập nhạy cảm (Camera, Micro, Vị trí, Thư viện ảnh).
  - **Level 4 (Gói Trả Phí):** *Bức Ảnh Có Quá Nhiều Bí Mật* — Công thức Nhìn – Che – Hỏi trước khi chia sẻ ảnh mạng xã hội.

- **Thanh Toán Tự Động VietQR & SePay:**
  - Sinh mã đơn hàng ngẫu nhiên 10 ký tự chuẩn **Crockford Base32** (`CK` + 8 ký tự an toàn, loại bỏ triệt để ký tự dễ nhầm lẫn `0, O, 1, I, L`).
  - Render mã VietQR chuẩn Napas với số tiền và nội dung chuyển khoản được định dạng sẵn.
  - Khóa bi quan (**Pessimistic Locking** với `SELECT ... FOR UPDATE`) chống race condition và duplicate webhook.
  - Xác thực webhook bằng so sánh thời gian hằng số `crypto.timingSafeEqual` loại trừ tấn công kênh phụ (timing attack).
  - Tự động kích hoạt quyền chơi vĩnh viễn (`expires_at = null`) và gửi email thông báo.

- **Quản Trị Hệ Thống & Đối Soát Giao Dịch (Admin Portal):**
  - **Kiểm tra quyền trực tiếp từ Database:** Middleware `requireAdmin` tra cứu dữ liệu thời gian thực (`users.role = 'admin'` và `is_active = 1`), vô hiệu hóa hoàn toàn nguy cơ giả mạo claim quyền trong JWT token.
  - **Đối soát giao dịch ngân hàng (Reconciliation):** Giao diện & API cho phép quản trị viên khớp các khoản chuyển khoản mồ côi hoặc trả thiếu với đơn hàng qua cơ chế ACID transaction (`SELECT ... FOR UPDATE`), tự động kích hoạt gói và cấp quyền vĩnh viễn.
  - **Nhật ký kiểm toán (Audit Logging):** Mọi hành động can thiệp đặc quyền (`grant_package`, `revoke_package`, `reconcile_transaction`) đều được ghi nhận trong bảng `admin_audit_log`. **Lưu ý:** `sigmabloom_app` user có quyền DML trên bảng này, nên tính bất biến chỉ được đảm bảo ở tầng ứng dụng (không phải tầng DB).
  - **Giao diện quản trị hiện đại (`admin.html`):** Theo dõi 6 chỉ số thời gian thực (doanh thu, đơn hàng, người dùng, giao dịch lỗi), quản lý phân quyền và modal đối soát giao dịch 1 chạm.

- **Bảo Mật Tầng Sâu (Defense-in-Depth):**
  - **Level Guard Middleware:** Bảo vệ static game files (`/level1/`, `/level2/`,...) bằng cookie HttpOnly `levelAccess` (thời hạn 2h), cache quyền $\le 60\text{s}$, chống Path Traversal (`..%2f`), gắn cờ `Cache-Control: private, no-store`.
  - **Phòng chống XSS:** Thư viện `assets/safe.js` mã hóa toàn bộ 6 ký tự nguy hiểm (`&`, `<`, `>`, `"`, `'`, `` ` ``), chỉ chấp nhận ảnh QR từ tên miền VietQR hợp lệ (`img.vietqr.io`, `api.vietqr.io`).
  - **Cô lập Access Token trong bộ nhớ:** Không lưu JWT vào `localStorage` (`localStorage.removeItem('ck_access_token')`), chỉ lưu trong bộ nhớ JavaScript (`accessToken`) kết hợp Refresh Token trong cookie HttpOnly.
  - **Kiểm soát Truy cập Static Files:** Chặn cứng các file nhạy cảm (`.env`, `.sql`, `.log`, `.md`, mã nguồn `backend/`, `.json` ngoại trừ `quests.json`).

---

## 🏗️ Kiến Trúc Hệ Thống

```
EXEWEB/
├── assets/                     # Assets dùng chung (audio, 3D models, safe.js, quests.json)
├── backend/                    # Backend RESTful API & Server
│   ├── migrations/             # Database migrations (002 đến 007)
│   ├── scripts/                # Automated test suites & utilities
│   ├── src/
│   │   ├── config/             # Cấu hình Database, Catalog, Setup
│   │   ├── controllers/        # Điều hướng nghiệp vụ (Auth, Admin, Game, Payments, Level)
│   │   ├── middleware/         # Auth, RequireAdmin, LevelGuard, ErrorHandler
│   │   ├── payments/           # Webhook Providers (SePay Adapter, Casso)
│   │   ├── routes/             # Định tuyến API
│   │   ├── utils/              # OrderCode generator, Mailer, Validators
│   │   └── server.js           # Khởi động Express, Helmet, CORS, Level Guard
│   └── .env                    # Biến môi trường backend
├── level0/                     # Màn chơi Level 0 (Public)
├── level1/                     # Màn chơi Level 1 (Protected)
├── level2/                     # Màn chơi Level 2 (Protected)
├── level3/                     # Màn chơi Level 3 (Protected)
├── level4/                     # Màn chơi Level 4 (Protected)
├── deploy/                     # File triển khai production (Nginx, PM2, backup, SQL)
├── admin.html                  # Giao diện Quản trị viên (Audit log, Orders, Grant)
├── payment.html                # Trang thanh toán dự phòng
├── reset-password.html         # Trang đặt lại mật khẩu an toàn
└── index.html                  # Trang chủ SPA chính, Game Launcher & Modals
```

---

## 🚀 Hướng Dẫn Cài Đặt & Chạy Dự Án

### Yêu Cầu Tiên Quyết
- **Node.js:** v22 LTS ([cài đặt qua NodeSource](https://github.com/nodesource/distributions)):
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
- **MySQL Server:** v8.0 hoặc v8.4 (InnoDB, utf8mb4).

### 1. Cấu hình Biến Môi Trường (`backend/.env`)
Sao chép file mẫu và điền giá trị thật:
```bash
cp backend/.env.example backend/.env
nano backend/.env    # hoặc editor bạn quen dùng
```

**Bảng biến môi trường chính:**

| Biến | Bắt buộc | Mô tả |
|------|----------|-------|
| `PORT` | Không | Cổng server (mặc định 5000) |
| `NODE_ENV` | Có (prod) | `development` hoặc `production` |
| `FRONTEND_URL` | Có | URL trang chủ (production phải `https://`) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Có | Kết nối MySQL |
| `JWT_SECRET` | Có | Secret JWT access token (≥ 32 ký tự, sinh bằng `node -e "..."`) |
| `JWT_REFRESH_SECRET` | Có | Secret JWT refresh token (≥ 32 ký tự, **khác** JWT_SECRET) |
| `LEVEL_ACCESS_SECRET` | Có | Secret cookie levelAccess (≥ 32 ký tự, **khác** 2 secret trên) |
| `SEED_ADMIN_USERNAME` | Có | Username admin ban đầu |
| `SEED_ADMIN_PASSWORD` | Có | Mật khẩu admin (prod: ≥ 12 ký tự, đủ hoa/thường/số/đặc biệt). **Sau khi setup xong, HÃY XÓA giá trị này khỏi `.env` để tránh lưu plaintext secret trong file.** |
| `BANK_ACCOUNT` | Có | Số tài khoản ngân hàng nhận tiền |
| `BANK_NAME` | Có | Tên chủ tài khoản (in hoa không dấu) |
| `BANK_BIN` | Có | Mã BIN ngân hàng (VietinBank=970415, VCB=970436, MBBank=970422) |
| `SEPAY_API_KEY` | Có | API key webhook SePay |
| `ORDER_TTL_MINUTES` | Không | TTL đơn hàng (mặc định 30 phút) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Không | SMTP gửi email (dev: in link ra console) |
| `FEEDBACK_TO` | Không | Email nhận phản hồi |

**Sinh secret ngẫu nhiên:**
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# Chạy 3 lần, mỗi lần dán vào JWT_SECRET, JWT_REFRESH_SECRET, LEVEL_ACCESS_SECRET
```

> ⚠️ **KHÔNG** copy secret mẫu từ tài liệu vào production. Startup check sẽ từ chối khởi động nếu phát hiện secret yếu/mặc định/trùng nhau.

### 2. Thiết lập Cơ Sở Dữ Liệu
```bash
cd backend
npm run setup-db
```

### 3. Khởi Chạy Máy Chủ
```bash
# Chạy ở chế độ phát triển (auto-reload với nodemon)
npm run dev

# Hoặc khởi chạy production
npm start
```
Truy cập trang web tại: `http://localhost:5000`

---

## 🧪 Hệ Thống Kiểm Thử Tự Động (Test Suites)

```bash
# Chạy toàn bộ unit tests và smoke tests
npm test

# Hoặc chạy kiểm thử tích hợp đầy đủ mọi phase
npm run test:all
```

---

## 🔐 Bảo Mật & Triển khai

### Thêm level mới
1. Thêm object vào mảng `LEVELS` trong `backend/src/config/catalog.js`:
   ```js
   { id: 5, url: '/level5/level5.html', title: 'Tên Level Mới' },
   ```
2. Tạo thư mục `level5/` với file `level5.html` trong thư mục gốc.
3. Nếu cần build lại Tailwind CSS: `npm run build:css`

### Cấp quyền thủ công
- Đăng nhập admin → Tab "Quản lý" → Tìm user → "Cấp gói"
- Hoặc dùng endpoint: `POST /api/admin/grant` (cần JWT admin)

### Test webhook SePay
```bash
node backend/scripts/simulate-webhook.js
```

### Triển khai production
Xem hướng dẫn chi tiết tại [`deploy/DEPLOY.md`](deploy/DEPLOY.md).

### Ghi chú bảo mật thêm
- **Cloudflare + Rate Limit:** Nếu server đặt sau Cloudflare Proxy, `$remote_addr` trong Nginx luôn là IP của Cloudflare, khiến rate limit IP-based không hoạt động. Cần forward real IP:
  ```nginx
  # Trong /etc/nginx/nginx.conf, khối http {}
  set_real_ip_from 103.21.244.0/22;
  set_real_ip_from 103.22.200.0/22;
  set_real_ip_from 103.31.4.0/22;
  set_real_ip_from 104.16.0.0/13;
  set_real_ip_from 104.24.0.0/14;
  set_real_ip_from 108.162.192.0/18;
  set_real_ip_from 131.0.72.0/22;
  set_real_ip_from 141.101.64.0/18;
  set_real_ip_from 162.158.0.0/15;
  set_real_ip_from 172.64.0.0/13;
  set_real_ip_from 173.245.48.0/20;
  set_real_ip_from 188.114.96.0/20;
  set_real_ip_from 190.93.240.0/20;
  set_real_ip_from 197.234.240.0/22;
  set_real_ip_from 198.41.128.0/17;
  set_real_ip_from 2400:cb00::/32;
  set_real_ip_from 2405:8100::/32;
  set_real_ip_from 2405:b500::/32;
  set_real_ip_from 2606:4700::/32;
  set_real_ip_from 2803:f800::/32;
  real_ip_header CF-Connecting-IP;
  ```
- **Rủi ro còn lại:** `admin.html` chưa có giao diện đổi mật khẩu admin; cần hoàn thiện form `POST /api/auth/change-password`. Inline `onclick=` handlers trong `index.html` chưa được chuyển sang `addEventListener` — nên thực hiện trong phase tiếp theo.

---

## 📋 Hướng Dẫn Vận Hành

Sau khi deploy thành công, tham khảo các tài liệu sau để vận hành dài hạn:

| Tài liệu | Mô tả |
|-----------|--------|
| [`deploy/DEPLOY.md`](./deploy/DEPLOY.md) | Hướng dẫn deploy chi tiết từ đầu, Phase 4–8 |
| [`deploy/MONITORING.md`](./deploy/MONITORING.md) | Sổ tay vận hành dài hạn: monitoring, backup, scaling, pháp lý |
| [`deploy/POSTMORTEM_TEMPLATE.md`](./deploy/POSTMORTEM_TEMPLATE.md) | Template báo cáo sự cố (post-incident) |
| [`deploy/postdeploy-check.sh`](./deploy/postdeploy-check.sh) | Script kiểm tra end-to-end sau mỗi deploy |
| [`privacy.html`](./privacy.html) | Chính sách bảo mật (pháp lý) |
| [`terms.html`](./terms.html) | Điều khoản sử dụng (pháp lý) |
| [`refund.html`](./refund.html) | Chính sách hoàn tiền + form yêu cầu |

**Quick checklist sau mỗi deploy:**
```bash
bash deploy/postdeploy-check.sh --domain <TEN_MIEN> --db-password "$DB_PASSWORD"
```

---

## 🔒 Quy Định Bản Quyền & Giấy Phép
Dự án được phát triển phục vụ mục đích giáo dục an toàn số cho trẻ em. Mọi quyền sở hữu thuộc về đội ngũ phát triển **CyberKnight / Sigmabloom**.
