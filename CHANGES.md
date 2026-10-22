# 📋 Nhật Ký Thay Đổi Kiến Trúc & Bảo Mật (CHANGES.md)

Dự án: **CyberKnight / Sigmabloom**  
Mục tiêu: Hoàn thiện kiến trúc an ninh, thanh toán tự động VietQR SePay, bảo vệ màn chơi và trải nghiệm người dùng từ P0 đến P5.

---

## [Phase 8] — Theo Dõi Thời Gian Online (Activity Tracking)

### Bối cảnh
Ghi nhận **tổng thời gian người dùng sử dụng trang web** và hiển thị trong trang Quản trị (`admin.html`).
Nguyên tắc bảo mật: **client KHÔNG bao giờ gửi thời lượng** — client chỉ báo "tôi còn sống" (heartbeat),
máy chủ tự tính `delta = NOW() - last_heartbeat_at` rồi mới cộng.

### 1. File ĐÃ TẠO MỚI
| File | Mô tả |
|---|---|
| `backend/migrations/008_user_activity.sql` | Tạo `user_activity` + `user_activity_daily` (idempotent, InnoDB/utf8mb4) |
| `backend/src/controllers/activityController.js` | Logic tính delta, transaction `SELECT ... FOR UPDATE`, cộng tổng + bảng daily trong **cùng** transaction |
| `backend/src/routes/activity.js` | Router `POST /heartbeat` (+ `GET /me`), rate limit riêng 6 req/phút |
| `assets/activity.js` | IIFE phía client, expose `window.CyberActivity = { start, stop, isRunning, idleSeconds }` |
| `backend/scripts/test-activity.js` | 56 assertion, chạy trong `npm test` và `npm run test:all` |

### 2. File ĐÃ SỬA
| File | Thay đổi |
|---|---|
| `backend/src/server.js` | Mount `app.use('/api/me/activity', activityRoutes)` **trước** handler 404 `/api/*` |
| `backend/src/controllers/adminController.js` | `listUsers` LEFT JOIN `user_activity` → `onlineSeconds`, `isOnlineNow`, `lastHeartbeatAt`, `firstSeenAt`; thêm `?sort=` whitelist (`newest`, `oldest`, `online_desc`, `online_asc`); `getUserDetail` trả thêm 4 trường thống kê |
| `assets/api.js` | Thêm `CyberAPI.activity.heartbeat()` + `CyberAPI.activity.getMyActivity()` |
| `assets/activity.js` | (mới) |
| `index.html` | Nạp `/assets/activity.js`; gọi `CyberActivity.start()` trong `showUserState()` và sau refresh token; gọi `stop()` trong `showGuestState()` và `logout()` |
| `admin.html` | Thêm `<th>Thời gian online</th>` + `<td>`; `colspan` 7 → **8** cho bảng users; thêm `formatDuration()`; chấm xanh `isOnlineNow` |
| `privacy.html` | Bổ sung câu trong mục 2.3 "Dữ liệu sử dụng dịch vụ" về thời gian sử dụng tổng hợp |
| `backend/database.sql` | Thêm 2 bảng activity (idempotent) cho DB mới |
| `backend/scripts/check-migrations.js` | Đăng ký `008_user_activity.sql` |
| `backend/src/config/setupDb.js` | Cập nhật chú thích danh sách migration 002 → 008 |
| `backend/package.json` | `test:activity` + thêm `scripts/test-activity.js` vào `test` và `test:all` |
| `README.md` | Mục tính năng + cấu trúc thư mục + ghi chú vận hành |

### 3. Quy tắc tính thời gian (anti-cheat)
```
delta = NOW() - last_heartbeat_at

delta <  20s        → BỎ QUA (chống spam / mở nhiều tab), chỉ chốt mốc thời gian
20s ≤ delta ≤ 90s   → cộng min(delta, 60s)          → reason 'counted'
delta >  90s        → PHIÊN MỚI: cộng tối đa 30s   → reason 'new_session'
last_heartbeat NULL → nhịp đầu: KHÔNG cộng          → reason 'first_seen'
```
- Toàn bộ thao tác nằm trong **1 transaction** với `SELECT ... FOR UPDATE` (pessimistic locking, cùng style `paymentController.js`) → không race condition, không deadlock.
- Bảng daily được cộng trong **cùng transaction** → `SUM(daily.seconds) == user_activity.total_seconds` luôn đúng.

### 4. Quyết định thiết kế & lý do
1. **Tính thời gian cho MỌI tài khoản, kể cả admin** (đề xuất của spec, chọn để đơn giản & nhất quán).
   `user_activity` là bảng phụ của `users`, không có logic loại trừ role — nếu sau này muốn loại admin chỉ cần thêm điều kiện ở tầng query đọc.
2. **Không dùng `INSERT ... ON DUPLICATE KEY UPDATE` thuần** vì cần đọc `last_heartbeat_at` để quyết định cộng bao nhiêu → buộc phải đọc-rồi-ghi. Đã dùng `INSERT IGNORE` (đảm bảo dòng tồn tại) + `SELECT ... FOR UPDATE` + `UPDATE` trong transaction. Đây cũng là style đã dùng ở payments.
3. **Endpoint không nhận body** → tương thích giới hạn `express.json({limit:'10kb'})`, không nguy cơ payload lớn.
4. **`window.__accessToken` là nguồn token duy nhất** của `assets/activity.js`. `index.html` định nghĩa `apiFetch()` bên trong thẻ `<script>` (không global) nên file này **không thể** gọi `apiFetch()` của trang nhà. Nó tự implement vòng refresh riêng: ưu tiên `CyberAPI.fetch` (nếu trang có nạp `api.js`) → fallback `fetch` + `POST /api/auth/refresh`. **Đã kiểm chứng runtime**: `hasCyberAPI: false` trên `index.html` và heartbeat vẫn trả **200**.
5. **Flush khi đóng tab dùng `fetch(..., {keepalive:true})` + header `Authorization`**, KHÔNG dùng `navigator.sendBeacon` vì beacon không gửi được header Authorization (yêu cầu Bearer).
6. **Không thêm file nào vào level1..level5** — `index.html` mở game bằng **iframe** (`<iframe id="gameFrame" src="/level0/level0.html">`), nên heartbeat ở trang cha đã đủ và không phá Level Guard.

### 5. Đối chiếu deploy
`deploy/DEPLOY.md` cấp quyền theo dạng `GRANT ... ON sigmabloom.*` (toàn database) cho `sigmabloom_app` / `sigmabloom_migrate` / `sigmabloom_backup`, nên **KHÔNG cần** thêm GRANT cho `user_activity` / `user_activity_daily`. Nếu sau này chuyển sang cấp quyền **theo từng bảng**, phải thêm:
```sql
GRANT SELECT, INSERT, UPDATE ON sigmabloom.user_activity          TO 'sigmabloom_app'@'localhost';
GRANT SELECT, INSERT, UPDATE ON sigmabloom.user_activity_daily    TO 'sigmabloom_app'@'localhost';
```

### 6. Hạn chế đã biết
- **Sai số ±30 giây / nhịp**: heartbeat chạy mỗi 30s nên tổng thời gian có sai số cộng dồn. Ngưỡng `<20s` bị bỏ qua nên các nhịp hơi sớm không cộng; cap 60s/nhịp khi delta vượt 60s (network chậm, máy ngủ).
- **Không có dữ liệu trước thời điểm triển khai** — `user_activity` mới tạo nên mọi user cũ hiển thị "Chưa có".
- **Idle detection phía client**: ngừng gửi sau 5 phút không tương tác (mouse/key/touch/scroll/wheel). Máy tính bật nhưng không ai dùng sẽ không được tính — đây là chủ ý.
- **Chống gian lận chỉ ở mức cơ bản**: không chống được trường hợp user sửa mã nguồn client gửi heartbeat dày đặc (rate limit 6/phút là trần); không có cơ chế xác thực thiết bị.
- `user_activity_daily` hiện chỉ ghi để dự phòng — chưa có API/UI đọc thống kê theo ngày.

---

## [Phase 3] — Post-Deploy Verification, Legal Pages & Operations Playbook

### Đã triển khai:

1. **`deploy/postdeploy-check.sh` — Script kiểm tra end-to-end sau deploy:**
   - 22 checks tự động, chạy `sudo bash deploy/postdeploy-check.sh [--domain <TEN_MIEN>] [--db-password <pw>] [--skip-public] [--skip-db]`.
   - Bao gồm: System info, PM2 status, port 5000 listening, loopback health (`/api/health`), public HTTPS health, security headers (HSTS, CSP, X-Content-Type, Referrer-Policy, frame-ancestors), HTTP→HTTPS redirect, www→apex redirect, MySQL connection + table count + 3 user accounts, MySQL bind-address, UFW rules, fail2ban sshd jail, SSH hardening file, `.env` permissions, `SEED_ADMIN_PASSWORD` leak check, backup freshness (warn > 36h), test-restore log, SSL cert expiry.
   - `set -uo pipefail` (KHÔNG `-e` — keep going để user thấy full picture).
   - `--self-test` flag để test logic script với mock commands.
   - Final summary: bảng ✅/❌/⚠️ per check, exit 0 chỉ khi 0 ❌.

2. **`privacy.html` (~300 dòng) — Chính sách bảo mật:**
   - 10 sections: Giới thiệu, Dữ liệu thu thập (account/payment/usage/children), Mục đích sử dụng, Cơ sở pháp lý (NĐ 13/2023, Luật ATTTM 2015, GDPR), Lưu trữ & bảo mật (nơi, thời gian, ai truy cập, biện pháp), Quyền người dùng (access/sửa/xóa/rút consent + liên kết `/api/privacy/request`), Trẻ em (NĐ 13/2023 Điều 9), Cookies (session + CSRF + levelAccess HttpOnly), Thay đổi chính sách (30 ngày notice), Liên hệ.
   - Email contact: `privacy@<TEN_MIEN>`.
   - Style: Tailwind tĩnh, responsive, footer với 3 link.

3. **`terms.html` (~300 dòng) — Điều khoản sử dụng:**
   - 10 sections: Chấp nhận điều khoản, Tài khoản (điều kiện, bảo mật mật khẩu, cấm chia sẻ), Sử dụng dịch vụ (cấm cheat/spam/scraping/DDoS, hậu quả = khóa vĩnh viễn), Thanh toán (VNĐ, VietQR/SePay, VAT, TTL 30 phút), **Chính sách hoàn tiền** (7 ngày + < 20% nội dung, 5–10 ngày hoàn qua SePay ngược), Sở hữu trí tuệ, Giới hạn trách nhiệm, Luật áp dụng (VN), Giải quyết tranh chấp (TAND TP.HCM/HN), Thay đổi điều khoản.
   - Style: Tailwind tĩnh, highlight box vàng cho refund policy, footer với 3 link.

4. **`refund.html` (~80 dòng) — Trang hoàn tiền:**
   - Tóm tắt điều kiện hoàn tiền (checklist ✅/❌).
   - Form POST tới `/api/privacy/request` với `type: 'refund'`, các trường: email, orderCode, reason, details.
   - Xử lý response với message cho user.
   - Footer 3 link.
   - Liên kết `/api/privacy/request` — stub route đã tạo.

5. **`backend/src/routes/privacy.js` — Stub route cho privacy API:**
   - `POST /api/privacy/request` → 501 `{ ok: false, error: 'privacy_request_endpoint_not_implemented' }` với TODO comment.
   - Đăng ký trong `server.js` (`app.use('/api/privacy', privacyRoutes)`).
   - 6 routes mới trong `server.js` (`/privacy`, `/privacy.html`, `/terms`, `/terms.html`, `/refund`, `/refund.html`) → `res.sendFile(rootDir + '*.html')`.

6. **`deploy/MONITORING.md` (~500 dòng) — Sổ tay vận hành dài hạn:**
   - Mermaid diagram kiến trúc hệ thống, 3 lớp monitoring.
   - Infrastructure: `htop`, `iotop`, `nethogs`, disk check, logrotate, SSL renewal.
   - Application: PM2 logs, MySQL slow query log (bật `slow_query_log=1`, `long_query_time=2`), 6 loại log + đường dẫn.
   - Business: healthchecks.io cron `*/5 * * * *`, UptimeRobot, Telegram bot setup.
   - Backup & DR: bảng tổng hợp (DB/git/env), RTO=30 phút, RPO=24h, kịch bản VPS mất, quy trình restore.
   - Update: git push → `update.sh`, breaking change → migration, rollback, major upgrade.
   - Scaling: dấu hiệu cần scale, vertical → horizontal → CDN.
   - Security ops: unattended-upgrades, fail2ban, manual monthly review, SSL Labs.
   - Pháp lý VN: NĐ 13/2023 đăng ký BCT, lưu trữ tại VN, VAT, thuế TNCN, báo cáo định kỳ, bảo vệ trẻ em (Điều 9).
   - Incident response runbook: 5 kịch bản (site down/DB down/payment/spam/DDoS).
   - Checklist định kỳ: hằng ngày / tuần / tháng / quý.

7. **`deploy/POSTMORTEM_TEMPLATE.md` — Template báo cáo sự cố:**
   - 10 phần: Tóm tắt, Timeline, Tác động, Root Cause, Actions done, Early detection gap, Action items (ưu tiên), Lessons learned, Files attached, Sign-off.

8. **Footer links trên mọi trang HTML:**
   - `index.html`: footer `bg-indigo-900` thêm 3 policy links.
   - `payment.html`: footer `bg-slate-100` thêm 3 policy links.
   - `admin.html`: footer `bg-slate-900` thêm 3 policy links.
   - Mỗi footer: Chính sách bảo mật · Điều khoản sử dụng · Chính sách hoàn tiền · © 2026 CyberKnight.

---

## [Phase 1] — Security Baseline, Static File Blocker & Audit Logging

### Đã triển khai:
1. **Kiểm soát truy cập tài nguyên tĩnh (Static File Blocker):**
   - Chặn đứng các truy cập trái phép vào các file nhạy cảm: `.env`, `.sql`, `.log`, `.md`, thư mục `backend/`, `node_modules/`, và các file ẩn (`.*`).
   - Chặn file `.json` tự do và thiết lập whitelist an toàn riêng cho `/assets/quests.json`.
   - Kết quả: Không còn nguy cơ rò rỉ mã nguồn máy chủ hay thông tin kết nối cơ sở dữ liệu.
2. **Cấu hình biến môi trường đồng bộ:**
   - Cập nhật `backend/src/config/db.js` và `backend/src/server.js` tự động phát hiện và nạp đúng file `.env` ở cả thư mục `backend/` và thư mục gốc project.
   - Thêm cảnh báo khi `JWT_SECRET` quá ngắn (< 32 ký tự) hoặc còn mang giá trị mặc định.
3. **Database Migration chuẩn hóa:**
   - Xóa bỏ câu lệnh phụ thuộc cứng `USE sigmabloom;` khỏi tất cả các file migration (`005_payments.sql`, `006_user_role.sql`, `007_admin_audit_log.sql`).
   - Thêm script kiểm thử `check-migrations.js` bảo đảm tất cả 6 migration files luôn đồng bộ và hợp lệ.

---

## [Phase 2] — Stored XSS & DOM XSS Defense-in-Depth

### Đã triển khai:
1. **Module mã hóa thực thể HTML (`assets/safe.js`):**
   - Xây dựng hàm `escapeHtml(str)` thay thế toàn bộ 6 ký tự nguy hiểm: `&`, `<`, `>`, `"`, `'`, `` ` ``.
   - Xây dựng hàm xác thực URL mã QR `isAllowedQrUrl(url)` chỉ chấp nhận giao thức HTTPS từ whitelist tên miền VietQR (`img.vietqr.io`, `api.vietqr.io`).
2. **Loại bỏ lỗ hổng DOM XSS trên toàn bộ giao diện:**
   - Rà soát và thay thế toàn bộ việc gán chuỗi động vào `innerHTML` bằng việc bọc `escapeHtml()` trong `admin.html`, `payment.html`, `index.html`.
   - Sửa lỗi typewriter trong các mini-game sử dụng `textContent` thay vì nối chuỗi HTML trực tiếp.
   - Thêm thuộc tính `rel="noopener noreferrer"` cho toàn bộ các thẻ `<a target="_blank">` để chống tabnabbing.
3. **Bộ kiểm thử tự động `backend/scripts/test-xss.js`:**
   - 23 test cases kiểm tra đơn vị hàm `escapeHtml()`, `isAllowedQrUrl()`, audit tĩnh trên file HTML, và kiểm tra backend validation từ chối payload XSS (HTTP 400).

---

## [Phase 3] — Payment Webhook & Order Engine Hardening

### Đã triển khai:
1. **Crockford Base32 Order Code System (`backend/src/utils/orderCode.js`):**
   - Format: `CK` + 8 ký tự an toàn (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`), loại bỏ hoàn toàn các ký tự dễ gây nhầm lẫn trên ứng dụng ngân hàng (`0, O, 1, I, L`).
   - Hàm `extractOrderCode()` trích xuất chính xác mã đơn từ nội dung chuyển khoản ngân hàng không dấu/có dấu.
   - Kiểm thử tự động `test-payments.js` đạt 22/22 tests pass với 1000 mã sinh ra unique 100%.
2. **Adapter SePay Webhook an toàn thời gian (`backend/src/payments/providers/sepay.js`):**
   - Xác thực tiêu đề `Authorization: Apikey <KEY>` bằng thuật toán `crypto.timingSafeEqual` nhằm loại bỏ hoàn toàn tấn công kênh phụ (timing side-channel attacks).
   - Chỉ tiếp nhận giao dịch tiền vào (`amountIn > 0`).
3. **Pessimistic Locking & Idempotency (`backend/src/controllers/paymentController.js`):**
   - Sử dụng transaction MySQL với `SELECT ... FOR UPDATE` trên bảng `orders` để ngăn chặn race condition khi nhiều webhook gửi tới cùng lúc.
   - Ghi nhận giao dịch vào `payment_transactions` với khóa chống trùng `(provider, provider_tx_id)`.
   - Hỗ trợ phục hồi đơn chuyển thiếu (chuyển trạng thái `underpaid` và tự động kích hoạt `paid` khi nhận đủ số tiền tích lũy).
   - Quyền chơi được ghi nhận vĩnh viễn (`expires_at = null`).
4. **Bộ kiểm thử `backend/scripts/test-payment-flow.js`:**
   - 16 test cases mô phỏng toàn diện vòng đời đơn hàng, xác thực webhook, thanh toán thiếu, thanh toán đủ, hủy đơn và cấp quyền.

---

## [Phase 4] — Frontend Level Gate, Token Memory Isolation & Game Launcher

### Đã triển khai:
1. **Bảo vệ màn chơi trả phí qua Level Guard (`backend/src/server.js`):**
   - Middleware regex `^\/level(\d+)\/` chặn bắt mọi truy cập tĩnh vào các thư mục game.
   - Cấp cookie HttpOnly `levelAccess` qua endpoint `POST /api/levels/:id/launch`.
   - Kiểm tra chữ ký JWT, kiểm tra `uid` và `levels`, tra cứu DB với in-memory cache $\le 60\text{s}$, chống path traversal và thiết lập header `Cache-Control: private, no-store`.
2. **Chuẩn hóa Modal Khóa Màn Chơi (`#levelGateModal`):**
   - Loại bỏ inline `style="display: none;"`, quản lý hoàn toàn bằng CSS `.modal-overlay` và `.active`.
   - Phân biệt trạng thái chưa đăng nhập vs đã đăng nhập nhưng chưa mua gói.
   - Hỗ trợ phím `Escape` đóng modal.
3. **Bộ chọn Dropdown Badge & Thẻ Level:**
   - Thêm thuộc tính `data-dd-level="0..4"` vào các nút trong `#playNowDropdownWrapper`.
   - Cập nhật hàm `applyLevelCardBadges()` gắn biểu tượng 🔒 chính xác cho các màn bị khóa trên cả modal và thanh điều hướng.
4. **Cô lập Access Token trong bộ nhớ:**
   - Xóa bỏ việc lưu JWT trong `localStorage` (`localStorage.removeItem('ck_access_token')`).
   - Quản lý token hoàn toàn trong bộ nhớ JavaScript (`accessToken`) kết hợp Refresh Token qua cookie HttpOnly.
5. **Bộ kiểm thử tự động:**
   - `test-level-guard.js`: 28 test cases.
   - `test-catalog.js`: 39 test cases.
   - `test-level-access.js`: 41 test cases.
   - `smoke-level-access.js`: 19 test cases.

---

## [Phase 5] — Dọn Dẹp, Tối Ưu Hóa Bảo Mật & Kiểm Thử Tổng Thể

### Đã triển khai:
1. **Xử lý CORS & Body Parser Chuyên Biệt:**
   - Khi nguồn truy cập (Origin) không hợp lệ, middleware trả về mã **HTTP 403 Forbidden** với JSON `{ success: false, error: 'CORS_DENIED' }` thay vì ném ngoại lệ 500.
   - Cấu hình body parser riêng biệt: Nâng lên **200kb** cho `/api/game` để hỗ trợ lưu tiến trình game lớn, trong khi giữ mức an toàn **10kb** cho toàn bộ các API còn lại để chống DoS.
2. **Dọn dẹp Cấu trúc & Bảo vệ Kho Mã Nguồn (`.gitignore`):**
   - Bổ sung các mẫu bảo vệ tệp tin nhạy cảm: `*.log`, `npm-debug.log*`, `yarn-error.log*`, `*.sql.gz`, `*.bak`, `*.tmp`.
   - Đảm bảo các thư mục IDE/Editor (`.claude/`, `.cursor/`, `.vscode/`) không bị đưa nhầm vào kho mã nguồn.
3. **Chuẩn hóa Bộ Lệnh Kiểm Thử (`package.json`):**
   - Thêm lệnh `npm test` chạy toàn bộ unit tests và smoke tests nhanh chóng.
   - Thêm lệnh `npm run test:all` chạy toàn bộ các bộ kiểm thử tích hợp liên thông của cả hệ thống.
4. **Tài Liệu Hóa Toàn Diện:**
   - Viết mới [README.md](README.md) hướng dẫn thiết lập dự án, biến môi trường, kiến trúc hệ thống và danh mục kiểm thử.
   - Lập [CHANGES.md](CHANGES.md) tổng kết toàn bộ nhật ký thay đổi qua từng giai đoạn phát triển.

---

## [Phase 6] — Admin Portal, Transaction Reconciliation & Immutable Audit Logging

### Đã triển khai:
1. **Kiểm Tra Quyền Quản Trị Trực Tiếp Từ Cơ Sở Dữ Liệu (Anti-Privilege Escalation):**
   - Nâng cấp middleware `requireAdmin` (`backend/src/middleware/requireAdmin.js`): Kiểm tra trực tiếp bản ghi người dùng trong cơ sở dữ liệu (`SELECT id, role, is_active FROM users WHERE id = ?`).
   - Chống giả mạo đặc quyền (Token Forgery): Ngay cả khi JWT token bị sửa payload mang claim `role = 'admin'`, hệ thống vẫn đối chiếu DB thực tế và chặn mã **403 Forbidden**.
   - Chặn tài khoản bị vô hiệu hóa (`is_active = 0`) với mã **401 ACCOUNT_DISABLED**.
2. **Cơ Chế Đối Soát & Khớp Giao Dịch Ngân Hàng (Pessimistic Locking & ACID Reconciliation):**
   - Endpoint `POST /api/admin/payments/reconcile`: Cho phép quản trị viên khớp giao dịch ngân hàng mồ côi (`no_order`) hoặc chuyển thiếu (`underpaid`) vào đơn hàng.
   - Sử dụng MySQL transaction với `SELECT ... FOR UPDATE` đồng thời trên cả hai bảng `payment_transactions` và `orders`.
   - Tính toán tổng tiền tích lũy của đơn hàng; khi đã đủ tiền, tự động cập nhật đơn hàng thành `paid`, gắn `match_status = 'matched'`, cấp quyền vĩnh viễn (`user_entitlements`, `expires_at = null`) và ghi nhật ký kiểm toán.
   - Endpoint `GET /api/admin/payments/mismatches`: Liệt kê các giao dịch phát sinh lỗi (`no_order`, `underpaid`, `error`) để đối soát kịp thời.
3. **Nhật Ký Kiểm Toán Bất Biến (Immutable Audit Logging - `admin_audit_log`):**
   - Bảng cơ sở dữ liệu `admin_audit_log` ghi nhận đầy đủ mọi thao tác nhạy cảm của quản trị viên:
     - `grant_package`: Cấp gói thủ công từ màn hình Quản trị viên.
     - `revoke_package`: Thu hồi quyền truy cập màn chơi của người dùng.
     - `reconcile_transaction`: Khớp giao dịch ngân hàng và duyệt đơn thủ công.
   - Endpoint `GET /api/admin/audit-logs`: Hỗ trợ phân trang, lọc theo `action`, `admin_id`, `target_user_id` và nối bảng hiển thị thông tin quản trị viên cùng người dùng mục tiêu.
4. **Giao Diện Quản Trị Viên Hiện Đại (`admin.html` & `assets/api.js`):**
   - Mở rộng lưới thống kê tổng quan lên **6 chỉ số**: Tổng người dùng, Đơn đã thanh toán, Tổng quyền sở hữu, Người dùng mới hôm nay, **Giao dịch cần xử lý**, và **Tổng doanh thu thực tế**.
   - Bổ sung 2 tab điều hướng mới: **⚠️ Giao dịch lỗi (Mismatches)** kèm huy hiệu đếm động và **📜 Nhật ký hoạt động (Audit Logs)**.
   - Tích hợp Modal đối soát nhanh (`#reconcileModal`): Điền tự động ID giao dịch, mã đơn, cho phép nhập ghi chú kiểm toán và thực hiện khớp 1 chạm.
   - Phòng vệ Stored & DOM XSS tầng sâu bằng cách bọc hàm `escapeHtml()` cho toàn bộ dữ liệu động hiển thị.
5. **Bộ Kiểm Thử Tích Hợp Tự Động `backend/scripts/test-admin.js`:**
   - 48 kịch bản kiểm thử toàn diện: Chặn unauthenticated, chặn token giả mạo, chặn user thường, chặn tài khoản bị khóa, chặn token leo thang đặc quyền, kiểm tra 6 chỉ số stats, phân trang user, chi tiết user, cấp gói thủ công + audit log, cấp & thu hồi entitlement, danh sách đơn hàng & giao dịch, đối soát giao dịch thành công (cập nhật tx, order, entitlement vĩnh viễn, audit log) và dọn dẹp dữ liệu kiểm thử (Clean-up).
   - Tích hợp vào `npm run test:all`.

---

## [Phase A] — Khắc Phục Lỗi Chặn Nút Bấm & Cấu Hình CSP Chuẩn Hóa

### Đã triển khai:
1. **Khắc phục lỗi tê liệt nút bấm do Helmet 7 CSP:**
   - Phân tích nguyên nhân gốc rễ: Helmet v7 tự động inject directive `script-src-attr 'none'`, khiến trình duyệt chặn đứng toàn bộ các thuộc tính `onclick`, `onchange`, `onsubmit` inline trên `index.html`, `payment.html` và `admin.html`. Đồng thời directive `upgrade-insecure-requests` tự động nâng HTTP lên HTTPS trên môi trường development (`http://localhost:5000`) gây chặn tải tài nguyên.
   - Bổ sung directive `script-src-attr: ["'unsafe-inline'"]` vào cấu hình Helmet CSP trong `backend/src/server.js`.
   - Giới hạn `upgradeInsecureRequests` chỉ kích hoạt khi `NODE_ENV === 'production'`.
2. **Tái cấu trúc DOM Event Delegation trên `admin.html`:**
   - Thay thế việc nối chuỗi onclick `onclick="openReconcileModal('${t.id}', ...)"` bằng thuộc tính `data-*` (`data-action="open-reconcile"`, `data-tx-id`, `data-order-code`) và bắt sự kiện qua Event Delegation, triệt tiêu nguy cơ DOM XSS và lỗi cú pháp chuỗi.
3. **Bộ kiểm thử tự động `backend/scripts/test-csp.js`:**
   - 19 test cases kiểm tra tương thích CSP với mã nguồn HTML, xác thực header CSP từ server thật, kiểm tra frameguard cho mini-game iframe và kiểm tra các trang con.

---

## [Phase B] — Vá Các Lỗ Hổng Tồn Đọng Từ Phase 1–6 (Security, Orders, Startup & Level Guard)

### Đã triển khai:
1. **Gia cố bảo mật Webhook SePay (`backend/src/payments/providers/sepay.js` & `paymentController.js`):**
   - **Xóa bỏ hoàn toàn khóa dự phòng hard-coded:** Loại bỏ chuỗi fallback bí mật; nếu thiếu `SEPAY_API_KEY` sẽ trả về mã HTTP 503 và log cảnh báo.
   - **Chống lộ thông tin:** Tuyệt đối không log expected/provided API key ra console khi xác thực thất bại.
   - **Chuẩn hóa Header:** Chỉ chấp nhận duy nhất format `Authorization: Apikey <KEY>`.
   - **Xác thực dữ liệu giao dịch chặt chẽ:** Bắt buộc `transferType === 'in'`, `amountIn` phải là số nguyên dương hợp lệ từ 1đ đến 1 tỷ đ, trích xuất mã đơn từ trường `code` hoặc nội dung chuyển khoản.
   - **Chống race condition & sập server:** Bọc toàn bộ transaction trong `try/catch/finally`, bắt lỗi `ER_DUP_ENTRY` và rollback an toàn mà không throw ra ngoài.
   - **Xử lý đơn hàng đã thanh toán (`paid`):** Giao dịch trùng đến sau được gắn `match_status = 'duplicate'` mà không ghi đè `paid_at` hay cấp lại quyền.
   - **Tích lũy tiền chuyển khoản (Accumulative payments):** Tự động tính tổng tiền các giao dịch hợp lệ của đơn hàng dưới pessimistic lock `SELECT ... FOR UPDATE`; khi đủ tiền sẽ tự động chuyển trạng thái đơn sang `paid` và kích hoạt quyền học tập.
2. **Quy trình tạo đơn & Giới hạn tần suất:**
   - TTL đơn hàng cấu hình động qua biến `ORDER_TTL_MINUTES` (mặc định 30 phút).
   - Kiểm tra quyền sở hữu trước khi tạo đơn: Trả về **HTTP 409 Conflict** nếu người dùng đã sở hữu gói hoặc Premium.
   - Tái sử dụng đơn hàng đang chờ: Nếu đang có đơn `pending` còn hạn cùng gói, trả lại thông tin đơn cũ kèm mã VietQR.
   - **Fail-closed cấu hình ngân hàng:** Nếu thiếu `BANK_BIN`, `BANK_ACCOUNT`, `BANK_NAME`, `createOrder` trả về HTTP 503 thay vì dùng giá trị mặc định sai lệch.
   - Trả về **HTTP 404 Not Found** (thay vì 403) khi truy cập hoặc hủy đơn của người khác để không làm lộ sự tồn tại của đơn hàng.
   - Bổ sung Rate Limiter: 10 đơn/giờ/user cho tạo đơn, 120 req/phút/IP cho webhook, 30 req/phút cho kiểm tra username.
3. **An toàn Khởi tạo Admin (`backend/src/config/seed.js`):**
   - Chỉ sử dụng biến `SEED_ADMIN_PASSWORD`, không dùng mật khẩu mặc định dự phòng.
   - Trong production: Kiểm tra bắt buộc $\ge 12$ ký tự, đủ chữ hoa/thường/số/ký tự đặc biệt, không thuộc danh sách mật khẩu yếu phổ biến.
   - Không ghi đè mật khẩu admin đã có trừ khi truyền cờ tường minh `--reset-admin-password`.
4. **Kiểm tra Khởi động Fail-Fast (`backend/src/config/startupCheck.js`):**
   - Từ chối khởi động (thoát `exit(1)`) trong production nếu các khóa `JWT_SECRET`, `JWT_REFRESH_SECRET`, `LEVEL_ACCESS_SECRET` thiếu, ngắn $< 32$ ký tự, chứa chuỗi mẫu yếu, hoặc trùng nhau.
   - Kiểm tra bắt buộc các biến `SEPAY_API_KEY`, `BANK_*`, `DB_PASSWORD` và `FRONTEND_URL` phải dùng giao thức `https://`.
   - Bộ kiểm thử tự động `backend/scripts/test-env-failfast.js` với 12 test cases kiểm tra nghiêm ngặt.
5. **Level Guard Fail-Closed & Canonical Path Protection:**
   - Khối `.catch` khi kiểm tra quyền trong level guard chuyển thành **Fail-Closed** (trả về HTTP 503 Service Unavailable), tuyệt đối không bao giờ phục vụ file game khi cơ sở dữ liệu gặp sự cố.
   - Rút ngắn thời hạn cookie HttpOnly `levelAccess` từ 6 giờ xuống **2 giờ**.
   - Chuẩn hóa đường dẫn level qua `canonicalizeLevelPath`, chặn null bytes (`\0`), backslash (`\`), percent (`%`), kiểm tra đường dẫn resolved strictly thuộc `rootDir/levelN` và bắt mọi biến thể `/levelN`, `/LEVELN/`, `/levelN/`.
   - Xóa cache quyền chơi (`invalidateEntitlementCache`) ngay lập tức khi người dùng thanh toán thành công hoặc khi quản trị viên cấp/thu hồi quyền.
   - Tự động gắn header `X-Robots-Tag: noindex, nofollow` và thẻ meta tương ứng cho `/admin*` và `/payment*`.
6. **Tổng kết Kiểm Thử Toàn Diện Hệ Thống (`npm run test:all`):**
   - Chạy thành công 11 bộ kiểm thử liên thông: **284/284 tests passed (100% PASS, 0 FAILED)**.

---

## [Phase D] — Phase 2 Bootstrap: One-Shot VPS Setup & Deploy Scripts

### Đã triển khai:

1. **`deploy/nginx.conf.example` — thứ tự HTTPS đúng:**
   - Thêm comment đầu file giải thích 4 bước: (1) deploy port 80 → (2) certbot → (3) thêm `www→apex redirect` SAU certbot → (4) `nginx -t && reload`.
   - Khối HTTPS đã có sẵn (comment), trong đó dòng `if ($host = www.<TEN_MIEN>)` được comment sẵn để thêm vào sau certbot — không làm hỏng HTTP-01 challenge.

2. **`deploy/bootstrap-server.sh` — one-shot VPS setup:**
   - Idempotent: kiểm tra user tồn tại, DB tồn tại, UFW active, Node 22 cài rồi → skip.
   - Header checks: `set -euo pipefail`, root-only, phát hiện `jammy`/`noble`, refuse others.
   - Flags: `--dry-run`, `--domain`, `--email`, `--deploy-user`.
   - Tạo deployer, copy SSH keys, UFW (OpenSSH + Nginx Full), fail2ban, unattended-upgrades, timezone, swap 2GB nếu RAM ≤ 2GB.
   - **Node 22 LTS qua NodeSource** (`curl | sudo bash` duy nhất được phép).
   - MySQL low-mem config (`zz-lowmem.cnf`) nếu RAM ≤ 2GB.
   - Hướng dẫn `mysql_secure_installation` (interactive, in ra màn hình).
   - **Tạo DB + 3 user với mật khẩu ngẫu nhiên (here-doc, không qua command-line args):** `sigmabloom_app` (CRUD), `sigmabloom_migrate` (DDL+DML), `sigmabloom_backup` (SELECT+triggers).
   - In 3 mật khẩu ra màn hình để lưu vào trình quản lý mật khẩu trước khi unset.
   - `server_tokens off` ghi vào `/etc/nginx/conf.d/00-server-tokens.conf`.
   - **Không làm SSH hardening** — chỉ in hướng dẫn và chạy `finish-ssh-hardening.sh` riêng.

3. **`deploy/finish-ssh-hardening.sh` — SSH hardening riêng:**
   - Tạo `/etc/ssh/sshd_config.d/00-hardening.conf`: `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `MaxAuthTries 3`, `X11Forwarding no`.
   - `sshd -t` kiểm tra trước reload.
   - **Hỏi xác nhận** trước khi reload: "Bạn đã thử `ssh deployer@...` ở cửa sổ khác và thành công? (yes/no)".
   - Nếu `no`: in rollback instructions + exit.
   - Nếu `yes`: `systemctl reload ssh` + in `sshd -T` expected output.

4. **`deploy/update.sh` — update/rollback script (chạy as deployer):**
   - `set -euo pipefail`, `--repo <path>`, `--rollback <commit>`, `--dry-run`.
   - Abort nếu `git status --porcelain` có uncommitted changes.
   - Backup DB trước (`backup-db.sh`) — abort nếu backup fail.
   - Lưu commit cũ → `git fetch + pull --ff-only`.
   - `npm ci --omit=dev`.
   - Migration: đọc `.env.migrate` (mode 600), chạy `setup-db` với inline `DB_USER/DB_PASSWORD`.
   - PM2 reload → health check → rollback on failure (`git checkout "$OLD"`, npm ci, pm2 reload).
   - **Xác nhận:** `setupDb.js` dùng `dotenv.config({ path })` KHÔNG có `override: true` → env vars inline win.
   - **Xác nhận:** tất cả migrations dùng `CREATE TABLE IF NOT EXISTS` / `INFORMATION_SCHEMA` PREPARE → idempotent.

5. **`deploy/backup-db.sh` — cập nhật rclone:**
   - Thêm block rclone ở đầu file, commented, OFF by default: `REMOTE_BACKUP=1 RCLONE_REMOTE="myremote" RCLONE_PATH="path" bash deploy/backup-db.sh`.
   - Dùng `${VAR:?error}` để fail rõ ràng nếu thiếu biến.
   - Giữ nguyên: `set -euo pipefail`, `--single-transaction`, validate >1KB + `CREATE TABLE`, prune 14 ngày.

6. **`deploy/restore-db.sh` — verify (đã có từ Phase 1):**
   - Mặc định restore vào `sigmabloom_restore_test`, `--force` cho production.
   - 5 giây countdown trước khi overwrite production.

7. **`deploy/crontab.example` (mới):**
   - Backup hằng ngày 03:00.
   - Test restore hằng tuần Chủ nhật 04:00 (gọi `test-restore.sh`).

8. **`deploy/test-restore.sh` (mới):**
   - Chọn file `.sql.gz` mới nhất trong `$BACKUP_DIR` nếu không truyền argument.
   - Restore vào `sigmabloom_restore_test`.
   - Verify bằng đếm số bảng.
   - In "OK" / "FAIL" rõ ràng.

9. **`deploy/DEPLOY.md` — viết lại theo thứ tự Phase 4–9:**
   - Phase 4: SSH hardening, deployer, UFW, fail2ban.
   - Phase 5: apt, Node 22, MySQL 3 users, swap, low-mem.
   - Phase 6: code, `.env`, setup-db, PM2.
   - Phase 7: Nginx, HTTPS certbot, www→apex, SePay, backup + rclone.
   - Phase 8: acceptance checklist, vận hành, troubleshooting table, Cloudflare config, rclone variables table, pháp lý (GDPR/NĐ13, refund, accounting).
   - Phase 9: checklist báo cáo cuối cùng (markdown).

---

## [Phase C] — (Phase 7) File Triển Khai, Tài Liệu & Gia Cố Frontend Production

### Đã triển khai:
1. **Thư mục `deploy/` — Hạ tầng triển khai production:**
   - `deploy/nginx.conf.example`: Cấu hình Nginx mẫu với rate-limit cho API xác thực (10r/m) và webhook (30r/m), chặn thư mục/file nhạy cảm, proxy pass tới Node.js.
   - `deploy/ecosystem.config.js`: Cấu hình PM2 với `max_memory_restart: 300M`, log file riêng, tự động restart khi crash (tối đa 10 lần/60s).
   - `deploy/backup-db.sh`: Script sao lưu MySQL tự động qua `mysqldump --single-transaction`, giữ 14 ngày, dùng `~/.my.cnf` (quyền 600) thay vì truyền mật khẩu trên dòng lệnh.
   - `deploy/mysql-user.sql`: Tạo user MySQL riêng — `sigmabloom_app` (chỉ CRUD) cho ứng dụng, `sigmabloom_migrate` (thêm CREATE/ALTER/INDEX) cho migration. Không dùng root.
   - `deploy/DEPLOY.md`: Hướng dẫn triển khai từng bước bằng tiếng Việt (13 mục + checklist nghiệm thu + khắc phục sự cố).

2. **Gia cố frontend production (C.5):**
   - **Build Tailwind CSS tĩnh:** Cài `tailwindcss@3` (devDependency), tạo `tailwind.config.js` quét 3 trang HTML + assets JS + safelist class cho `sendBlockedHtml`. Thay thế `<script src="https://cdn.tailwindcss.com">` bằng `<link rel="stylesheet" href="/assets/tailwind.css">` trên `index.html`, `payment.html`, `admin.html` và hàm `sendBlockedHtml` (server.js). Script build: `npm run build:css`.
   - **Loại bỏ `'unsafe-eval'` và `cdn.tailwindcss.com` khỏi CSP `scriptSrc`:** Tailwind Play CDN cần `eval()` để chạy JIT — sau khi build CSS tĩnh, không còn cần cả hai.
   - **HSTS (production):** `Strict-Transport-Security: max-age=15552000; includeSubDomains` (chỉ bật khi `NODE_ENV=production`).
   - **Referrer-Policy:** `strict-origin-when-cross-origin` (thay thế Helmet default `no-referrer`).
   - **Permissions-Policy:** Tắt `camera`, `microphone`, `geolocation` (game không sử dụng).
   - **confetti/gsap trong game levels:** Giữ nguyên CDN (`cdn.jsdelivr.net`, `cdnjs.cloudflare.com`) đã được CSP cho phép — không sửa nội dung game theo quy tắc #3. **TODO:** Tự host vào `assets/vendor/` khi refactor level HTML.

3. **Cập nhật tài liệu:**
   - `README.md`: Sửa Node ≥ 18 → ≥ 20, bảng biến môi trường đúng tên biến thật (bỏ `SEPAY_ACCOUNT_NUMBER`/`SEPAY_BANK_CODE` sai, thay bằng `BANK_ACCOUNT`/`BANK_NAME`/`BANK_BIN`), bỏ secret mẫu copy-paste được, hướng dẫn thêm level mới, test webhook, link `deploy/DEPLOY.md`.
   - `CHANGES.md`: Ghi nhận toàn bộ Phase C.

