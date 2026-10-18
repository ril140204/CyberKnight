# PROMPT CHO AI — SỬA LỖI "TẤT CẢ NÚT BẤM KHÔNG HOẠT ĐỘNG" + VÁ TỒN ĐỌNG + HOÀN THÀNH PHASE 7 & 8

> Cách dùng: đặt file này ở thư mục gốc dự án, mở Claude Code tại đó và gõ:
> `Đọc file PROMPT_FIX_NUT_BAM_VA_HOAN_THANH_PHASE_7_8.md và làm lần lượt PHASE A → B → C → D. Sau mỗi phase dừng lại, báo cáo (file đã sửa, cách đã kiểm chứng, kết quả thật) rồi chờ tôi xác nhận.`

---

## 0. BỐI CẢNH & QUY TẮC

Dự án **CyberKnight / Sigmabloom**: web game giáo dục an toàn mạng cho trẻ em Việt Nam. Node 20 + Express 4 + MySQL 8, `helmet@^7.1.0`, frontend `index.html` / `payment.html` / `admin.html` + `assets/{api.js,safe.js}`, game trong iframe `level0..level4`, thanh toán VietQR + webhook SePay, khóa level bằng cookie `levelAccess`.

Các phase 1–6 của lần hardening trước đã được AI khác thực hiện. Bản rà soát mới nhất phát hiện:
- **Lỗi nghiêm trọng khiến tất cả nút bấm không hoạt động** (Phase A).
- Một số lỗi bảo mật/logic còn tồn đọng ở webhook, seed admin, cấu hình env, level guard (Phase B).
- Hai phase cuối chưa làm: **Phase 7** (file triển khai & tài liệu) và **Phase 8** (kiểm thử & nghiệm thu) (Phase C, D).

**Quy tắc bắt buộc:**
1. Đọc kỹ file liên quan trước khi sửa. Mọi kết luận "đã đúng" phải dẫn chứng `file:dòng`. Không đoán.
2. **Không tuyên bố "đã sửa" nếu chưa chạy kiểm chứng thật.** Báo cáo phải dán output lệnh thật (không tự viết "pass 239/239" nếu chưa chạy).
3. Không làm hỏng tính năng đang có (auth, quên mật khẩu, feedback, mua gói, khóa level, admin). Không đổi nội dung game trong `levelN/`.
4. Thông báo/comment bằng **tiếng Việt**; tên biến/bảng tiếng Anh.
5. Bí mật chỉ nằm trong `.env`; không hard-code, không log ra console.
6. Cập nhật `README.md`, `CHANGES.md`, `backend/.env.example` ở cuối.
7. Gặp mâu thuẫn hoặc quyết định chưa rõ → **hỏi tôi**.

---

## PHASE A — SỬA LỖI "TẤT CẢ NÚT BẤM KHÔNG HOẠT ĐỘNG" (P0, LÀM TRƯỚC TIÊN)

### A.1 Nguyên nhân gốc (đã xác định bằng đọc code)
`backend/src/server.js` gọi `helmet({ contentSecurityPolicy: { directives: {...} } })`. Với **helmet 7**, `useDefaults` mặc định là `true`, nên các directive mặc định vẫn được trộn vào, **trong đó có**:
- `script-src-attr 'none'` → **chặn mọi inline event handler** (`onclick="..."`, `onchange`, `oninput`, …). Dự án có **63 handler inline trong `index.html`, 20 trong `admin.html`, 2 trong `payment.html`**. Việc thêm `'unsafe-inline'` vào `scriptSrc` **không** mở khóa được thuộc tính `onclick` — phải khai báo riêng `scriptSrcAttr`.
- `upgrade-insecure-requests` → trên `http://localhost:5000` trình duyệt có thể cố nâng các tài nguyên phụ lên `https://localhost:5000` và thất bại (css/js/ảnh/api không tải được).

Triệu chứng: trang hiển thị bình thường nhưng bấm nút nào cũng không phản ứng; Console DevTools có dòng kiểu
`Refused to execute inline event handler because it violates the following Content Security Policy directive: "script-src-attr 'none'"`.

### A.2 Tái hiện & xác nhận (bắt buộc làm trước khi sửa)
1. Chạy server, chạy `curl -sI http://localhost:5000/ | grep -i content-security-policy` và dán nguyên header. Xác nhận có `script-src-attr 'none'` và `upgrade-insecure-requests`.
2. Liệt kê số handler inline: `grep -c -E ' on(click|change|input|submit|keydown|keyup)=' index.html payment.html admin.html`.
3. Kiểm tra Console không còn lỗi nào khác (ví dụ lỗi 404 `/assets/api.js`, lỗi `apiFetch is not defined`, lỗi CORS 403 `CORS_DENIED`, lỗi tải `cdn.tailwindcss.com`). Ghi lại tất cả lỗi tìm thấy.

### A.3 Cách sửa — làm theo 2 bước

**Bước 1 — Sửa nhanh để trang chạy lại ngay (bắt buộc):** trong `server.js`, cấu hình CSP tường minh, KHÔNG dựa vào default:
```js
const isProd = process.env.NODE_ENV === 'production';
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'",
                  'https://cdn.tailwindcss.com', 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
      scriptSrcAttr: ["'unsafe-inline'"],            // TẠM THỜI cho phép onclick inline, xem Bước 2
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://img.vietqr.io', 'https://api.vietqr.io'],
      mediaSrc: ["'self'", 'blob:', 'data:'],
      workerSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'"],
      frameSrc: ["'self'"],
      frameAncestors: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      ...(isProd ? { upgradeInsecureRequests: [] } : {}),   // chỉ bật ở production (HTTPS)
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  frameguard: { action: 'sameorigin' },
}));
```
Lưu ý: kiểm tra mọi tài nguyên mà game level thực sự nạp (ảnh, âm thanh, video, mô hình 3D `.glb`, font) để không bị CSP chặn; nếu game dùng `fetch` tới đường dẫn tương đối thì `connectSrc 'self'` là đủ. Nếu có nguồn ngoài khác, thêm đúng nguồn đó (không dùng `*`).

**Bước 2 — Làm đúng (khuyến nghị mạnh, làm sau khi Bước 1 đã chạy ổn):** chuyển toàn bộ inline handler sang `addEventListener`/event delegation (dùng `data-action="..."` + một listener ở `document`), sau đó **bỏ** `scriptSrcAttr: 'unsafe-inline'` (đặt `["'none'"]`) và dần bỏ `'unsafe-inline'` ở `scriptSrc` bằng cách chuyển `<script>` inline ra file `.js` hoặc dùng nonce. Đặc biệt `admin.html` dòng ~669 đang dựng `onclick="openReconcileModal(${safeTxId}, ${safeAmount}, '${safeContent...}')"` bằng nối chuỗi — **phải đổi sang `data-tx-id`, `data-amount`, `data-content` + listener** (nối chuỗi vào inline handler là điểm XSS dễ vỡ). Làm theo từng trang (payment → admin → index) và test lại từng trang. Nếu Bước 2 quá lớn so với phạm vi, hỏi tôi và để lại danh sách TODO rõ ràng; **Bước 1 là bắt buộc**.

### A.4 Kiểm chứng sau khi sửa (dán output thật)
- `curl -sI http://localhost:5000/` thấy `script-src-attr 'unsafe-inline'` (Bước 1) và KHÔNG có `upgrade-insecure-requests` khi `NODE_ENV=development`.
- Viết `backend/scripts/test-csp.js` (không cần trình duyệt): gọi server, đọc header CSP và HTML của `index.html`, `payment.html`, `admin.html`; **nếu HTML còn thuộc tính `on*=` thì header phải cho phép** (`script-src-attr` chứa `'unsafe-inline'`); nếu không có handler inline thì `script-src-attr` phải là `'none'`. Test fail khi hai điều này mâu thuẫn. Thêm vào `npm run test:all`.
- Kiểm tra thủ công và ghi lại từng bước (hoặc dùng Playwright/Puppeteer nếu có thể, không bắt buộc): mở `/` → bấm "Chơi ngay", "Đăng nhập", mở modal chọn level, bấm Level 0 (vào game), bấm Level 1 khi chưa đăng nhập (hiện modal khóa), mở bảng giá, tạo đơn (hiện QR), đóng modal bằng ESC; mở `/admin.html` (đăng nhập admin) → đổi tab, bấm đối soát; mở `/payment.html`. Console **không còn** lỗi CSP.
- Đảm bảo level 0 vẫn chạy trong iframe (frameguard `sameorigin`).

### A.5 Các lỗi liên quan khiến "chức năng không chạy" cần kiểm tra thêm
- `index.html` hiện chỉ nạp `/assets/safe.js` (dòng ~2362) rồi mới tới script chính (dòng ~2363); `admin.html` nạp thêm `/assets/api.js`. Xác nhận trang nào gọi hàm từ `api.js` (`apiFetch`…) thì đã nạp `api.js` **trước** script sử dụng nó; `payment.html` cũng vậy.
- Mở từng file HTML, chạy kiểm tra cú pháp từng khối `<script>` (đã kiểm tra cú pháp hiện OK — chỉ cần giữ nguyên sau khi sửa).
- Middleware chặn file nhạy cảm không được vô tình chặn `/assets/*.js`, `/assets/*.glb`… (chỉ chặn `.env|.sql|.log|.md|.json` trừ `/assets/quests.json`). **Lưu ý:** nếu game hay frontend cần `.json` khác (ví dụ `manifest`, dữ liệu cấp độ) thì tìm bằng grep và whitelist đúng đường dẫn đó.
- `GET /api/catalog` và `/api/me/entitlements` trả đúng; nút "Chơi" gọi `POST /api/levels/:id/launch` và nhận cookie `levelAccess` (kiểm tra trong DevTools → Application → Cookies).
- Chạy `NODE_ENV=development`; kiểm tra `FRONTEND_URL`/`CORS_ORIGINS` khớp với địa chỉ bạn mở trình duyệt (`http://localhost:5000` ≠ `http://127.0.0.1:5000`; middleware CORS hiện trả `403 CORS_DENIED` khi Origin lạ — hãy thêm cả hai vào `CORS_ORIGINS` khi dev, và **không** chặn request cùng origin).

**Kết thúc Phase A:** báo cáo nguyên nhân + diff + output kiểm chứng, dừng chờ xác nhận.

---

## PHASE B — VÁ CÁC LỖI TỒN ĐỌNG TỪ PHASE 1–6

### B.1 🔴 Webhook SePay (`backend/src/payments/providers/sepay.js`, `controllers/paymentController.js`)
1. **Khóa dự phòng bị hard-code:** `verifyRequest` dùng `process.env.SEPAY_API_KEY || process.env.PAYMENT_WEBHOOK_SECRET || 'sepay_webhook_secret_key_sigmabloom_2026'`. Khi thiếu biến, **ai biết chuỗi này đều giả mạo được thanh toán** để mở khóa miễn phí. Xóa giá trị dự phòng; nếu không có khóa → từ chối mọi webhook (503) và log cảnh báo. Chỉ dùng **một** biến: `SEPAY_API_KEY` (bỏ `PAYMENT_WEBHOOK_SECRET` hoặc coi là alias rõ ràng, đồng bộ `.env.example`). `.env` hiện đang chứa `PAYMENT_WEBHOOK_SECRET=sep…` (giá trị đoán được) — đổi sang chuỗi ngẫu nhiên.
2. **Log lộ khóa:** khi sai key, code `console.warn` in cả `providedKey` lẫn `expectedKey`. Xóa; chỉ log "Webhook key không hợp lệ" kèm IP.
3. Chấp nhận quá nhiều nguồn khóa (`Authorization` trần, `Bearer`, `x-api-key`, `x-webhook-secret`): chỉ giữ `Authorization: Apikey <KEY>` đúng chuẩn SePay (tra docs.sepay.vn để xác minh; ghi `TODO: xác minh` nếu không truy cập được).
4. **`parseTransaction`:** `transferType` mặc định `'in'` khi thiếu, `isMoneyIn = transferType==='in' || amountIn>0`, `Number(...)||0`. Sửa: bắt buộc `transferType === 'in'`; `amountIn` phải thỏa `Number.isInteger(x) && x > 0 && x <= 1_000_000_000` (ép kiểu từ `transferAmount`); thiếu/sai → 400, không xử lý; dùng thêm trường `code` của SePay (nếu có) để trích mã đơn; `id` bắt buộc 1–100 ký tự.
5. **Webhook có thể làm sập tiến trình:** trong `webhook()`, `await db.getConnection()` nằm ngoài `try` và khối `catch` ở cuối `throw txErr`. Express 4 không bắt lỗi từ hàm async → `unhandledRejection` → Node 20 **thoát tiến trình**. Hai webhook trùng đến song song (SePay hay retry) cùng pass bước "kiểm tra trùng" rồi cùng INSERT → cái thứ hai lỗi `ER_DUP_ENTRY` → sập server. Sửa: bọc toàn bộ trong `try/catch/finally`; `ER_DUP_ENTRY` → rollback, trả 200 `{success:true, duplicate:true}`; lỗi khác → 500 (để nhà cung cấp retry) và **không** throw ra ngoài; thêm `process.on('unhandledRejection')` ghi log nhưng không để nuốt lỗi. Đưa `INSERT` giao dịch lên **trước** (idempotency-first), hoặc dùng `INSERT ... ON DUPLICATE KEY` rồi kiểm tra `affectedRows`.
6. **Đơn đã `paid` nhận thêm một giao dịch khác (cùng mã đơn):** hiện vẫn `UPDATE paid_at = NOW()` và upsert entitlement lần nữa. Sửa: nếu `order.status === 'paid'` → ghi giao dịch `match_status='duplicate'` (hoặc `overpaid`), **không** đổi `paid_at`, không cấp lại, cảnh báo admin. Quyết định với đơn `cancelled`: giữ chính sách "tiền thật đã vào thì vẫn mở khóa" nhưng ghi log cảnh báo rõ ràng.
7. **Tài liệu nói sai so với code:** `CHANGES.md` (Phase 3) khẳng định "tự động kích hoạt `paid` khi nhận đủ số tiền **tích lũy**" nhưng webhook hiện **không** cộng dồn (chỉ `reconcile` thủ công của admin có). Hoặc (khuyến nghị) triển khai: trong cùng transaction, tính `SUM(amount_in)` của các giao dịch gắn với đơn (kèm giao dịch hiện tại); nếu tổng ≥ `order.amount` → `paid` + cấp quyền; hoặc sửa tài liệu cho đúng thực tế. Hỏi tôi chọn cách nào (mặc định: **cộng dồn**).
8. Ghi thời gian: dùng `NOW()` của MySQL thay `new Date(...)` JS khi ghi `expires_at`/`transaction_date` để tránh lệch múi giờ; chuẩn hóa timezone kết nối (`timezone: '+07:00'` hoặc lưu UTC nhất quán).
9. Email xác nhận chạy ở `setImmediate` với `try/catch` — giữ nguyên.

### B.2 🟠 Tạo đơn & truy cập đơn
- `createOrder`: TTL đang cứng 15 phút → dùng `ORDER_TTL_MINUTES` (mặc định 30). Thêm: 409 nếu user đã sở hữu gói đó hoặc Premium; nếu đang có đơn `pending` còn hạn cùng gói → trả lại đơn cũ; rate limit 10 đơn/giờ/user; `startOrderCleanupJob()` hiện tự chạy khi `require` — chuyển sang gọi tường minh từ `server.js` khi khởi động và cho phép tắt bằng env.
- Cấu hình ngân hàng thiếu: code dùng mặc định `BANK_BIN='970436'` (Vietcombank), `BANK_ACCOUNT=''`, `BANK_NAME='CyberKnight Shield'` → QR sai/rỗng. **Không dùng giá trị mặc định**; nếu thiếu `BANK_BIN/BANK_ACCOUNT/BANK_NAME` thì `createOrder` trả 503 và log rõ lý do; production fail-fast khi khởi động.
- `getOrder`/`cancelOrder`: đơn của người khác hiện trả **403** (lộ việc đơn tồn tại) → trả **404**. Vai trò admin lấy từ DB, không từ JWT.
- Thêm giới hạn tốc độ cho `/api/payments/webhook*` (vd 120/phút/IP) và cho `/api/auth/check-username` (30/phút).

### B.3 🔴 Seed admin & mật khẩu mặc định (`config/seed.js`, `.env.example`)
- `seed.js` dùng `process.env.ADMIN_PASSWORD || 'Admin@123456'`; `.env.example` có cả `SEED_ADMIN_PASSWORD=admin` lẫn `ADMIN_PASSWORD=Admin@123456`. Sửa: chỉ một biến `SEED_ADMIN_PASSWORD`; **bỏ giá trị dự phòng**; nếu thiếu → dừng, không tạo admin. Khi `NODE_ENV=production`: bắt buộc ≥ 12 ký tự, có chữ hoa/thường/số/ký tự đặc biệt, không nằm trong danh sách yếu (`admin`, `Admin@123456`, `password`…), nếu không `exit(1)`. Không in mật khẩu ra log.
- `seedAdmin` hiện **ghi đè mật khẩu admin mỗi lần chạy `setup-db`**. Sửa: chỉ tạo khi chưa có; đặt lại mật khẩu chỉ khi có cờ rõ ràng `--reset-admin-password`.
- `require('dotenv').config()` trong `seed.js` dùng đường dẫn mặc định (phụ thuộc cwd) — dùng cùng cách nạp `.env` như `server.js`.

### B.4 🔴 Cấu hình env bị mâu thuẫn & lộ thông tin
- Còn **hai file mẫu env** (`backend/.env.example` và `_env.example` ở gốc) với **2 số tài khoản khác nhau** (108881471301/BIN 970415 và 0560199751924). `README.md` lại mô tả `SEPAY_ACCOUNT_NUMBER`/`SEPAY_BANK_CODE=VietinBank` — **hai biến này code không dùng** (code đọc `BANK_ACCOUNT/BANK_BIN/BANK_NAME`) → người làm theo README sẽ ra QR sai. Giữ **một** file `backend/.env.example`; mọi giá trị nhạy cảm để trống (`BANK_*`, `FEEDBACK_TO`, `SEED_ADMIN_PASSWORD`, `SEPAY_API_KEY`); sửa README cho khớp tên biến thật; xóa file env mẫu ở gốc.
- `README.md` mục cấu hình đang in các secret mẫu dài ≥ 32 ký tự (`cyberknight_production_super_secret_jwt_key_at_least_32_chars!`…) — **qua được kiểm tra độ dài** nên người dùng copy nguyên sẽ chạy production với secret công khai. Thay bằng `<chạy lệnh sinh secret ở dưới>`; startup check phải từ chối secret chứa các chuỗi như `change_this`, `secret_key`, `super_secret`, `cyberknight_`, hoặc hai secret trùng nhau.
- **Startup fail-fast (production):** thiếu/ngắn (<32)/mặc định/trùng nhau ở `JWT_SECRET`, `JWT_REFRESH_SECRET`, `LEVEL_ACCESS_SECRET`; thiếu `SEPAY_API_KEY`, `BANK_BIN`, `BANK_ACCOUNT`, `BANK_NAME`, `DB_PASSWORD`; `FRONTEND_URL` không phải `https://`; mật khẩu admin yếu → in lý do và `exit(1)`. Hiện server mới kiểm tra riêng `JWT_SECRET`.
- `backend/.env` thật vẫn nằm trong các file nén tôi gửi (có `SMTP_PASS`, tài khoản ngân hàng, secret). **Không tự đổi giúp**; hãy nhắc tôi rõ trong báo cáo: thu hồi Gmail App Password cũ, sinh secret mới, đổi `PAYMENT_WEBHOOK_SECRET`, không gửi `.env` cho bất kỳ ai. Đảm bảo `.gitignore` gốc có `.env`, `.env.*` (trừ `.env.example`), `*.zip`, `repomix-output.xml`, `_claude/`, `_cursor/`, `.claude/`, `.cursor/`, `*.log`; khuyên tôi xóa `_claude/` và `_cursor/` khỏi dự án.

### B.5 🟠 Level guard & khởi động
- Khối `.catch` của `getPlayableLevelsCached` trong `server.js` hiện **fail-open** (lỗi DB → vẫn `sendFile`). Đổi thành **fail-closed**: trả 503 JSON/HTML "Hệ thống đang bận, thử lại sau". Hỏi tôi nếu muốn cho phép cache ≤ 5 phút (mặc định: fail-closed).
- Cookie `levelAccess` đang 6 giờ: rút còn 2 giờ; quyền bị thu hồi hiệu lực ≤ 60s (đã có cache 60s — giữ). Xóa cache của user khi cấp/thu hồi/đối soát gói để quyền mới mua có hiệu lực **ngay** (không phải chờ 60s).
- Level guard chỉ khớp `^/level(\d+)/`: kiểm tra thêm các biến thể `/level1` (không có dấu `/` cuối), `/LEVEL1/...`, `//level1/...`, `/level1%2flevel1.html`, `/level1/..%2fbackend/.env`, và các route không được vô tình phục vụ level qua `express.static`. `isSafePath` giải mã URL một lần — thêm chặn `%`, `\`, `\0` còn sót sau khi giải mã và kiểm tra đường dẫn đã resolve nằm trong `rootDir/levelN` bằng `path.resolve` + `startsWith(levelDir + path.sep)`.
- `package.json` còn `prestart`/`predev` chạy `scripts/ensure-mysql.js` (có `freePort`, đường dẫn Windows). Sửa để script **không chạy và không kill tiến trình** khi `NODE_ENV=production` hoặc khi không phải `win32`; thêm `"start:prod": "node src/server.js"`, `"engines": {"node": ">=20"}`; README đang ghi Node ≥ 18 → sửa thành ≥ 20.
- `/admin.html` và `/payment.html` đang công khai: chấp nhận được nếu mọi API đã được bảo vệ phía server; thêm `<meta name="robots" content="noindex,nofollow">` và header `X-Robots-Tag: noindex` cho `/admin*`.

### B.6 🟡 Khác
- `README.md` nhắc `reset-password.html` và `game.html` (server có route) nhưng bản nộp chưa thấy các file này, cũng như `package.json` gốc: kiểm tra tồn tại; nếu thiếu, báo tôi.
- `README`/`CHANGES` ghi "239/239 test pass" — phải **chạy lại thật** (`cd backend && npm ci && npm run setup-db && npm run test:all`) và dán kết quả; các test hiện tại **không phát hiện** được lỗi CSP/nút bấm nên "pass" không đồng nghĩa web chạy được.
- Tailwind vẫn tải từ `cdn.tailwindcss.com` (dùng cả ở trang do server sinh trong `sendBlockedHtml`); thư viện confetti/gsap (jsdelivr/cdnjs) chưa có SRI → xử lý ở Phase C.5.
- `sendBlockedHtml` chèn `${title}`/`${heading}` thô vào HTML: hiện lấy từ `catalog.js` (tin cậy) nên chấp nhận được, nhưng vẫn `escapeHtml` cho chắc.

**Kết thúc Phase B:** bảng "Trước/Sau" cho từng mục B.1–B.6 + output test; dừng chờ xác nhận.

---

## PHASE C — (PHASE 7) FILE TRIỂN KHAI & TÀI LIỆU

Tạo thư mục `deploy/` gồm:

1. `deploy/nginx.conf.example`:
```nginx
limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/m;
server {
  listen 80;
  server_name tenmiencuaban.vn www.tenmiencuaban.vn;
  client_max_body_size 1m;
  location ~ /\.(?!well-known) { deny all; }
  location ~* ^/(backend|node_modules)/ { return 404; }
  location /api/auth/ {
    limit_req zone=auth burst=20 nodelay;
    proxy_pass http://127.0.0.1:5000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  location / {
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
(Certbot sẽ thêm khối 443 + chuyển hướng HTTP→HTTPS.)
2. `deploy/ecosystem.config.js` (PM2): `name: 'cyberknight'`, `script: 'src/server.js'`, `cwd: './backend'`, `env: { NODE_ENV: 'production' }`, `max_memory_restart: '300M'`, file log riêng.
3. `deploy/backup-db.sh`: `mysqldump --single-transaction sigmabloom | gzip > /var/backups/sigmabloom-$(date +%F).sql.gz`, xóa bản cũ hơn 14 ngày; hướng dẫn cron hằng ngày và copy ra nơi khác; không để mật khẩu trong dòng lệnh (dùng `~/.my.cnf` quyền 600).
4. `deploy/mysql-user.sql`: tạo user riêng `sigmabloom_app` chỉ có `SELECT, INSERT, UPDATE, DELETE` trên `sigmabloom.*`; user migration riêng có thêm `CREATE, ALTER, INDEX, REFERENCES`. Không dùng `root` trong `.env`; MySQL chỉ bind `127.0.0.1`.
5. `deploy/DEPLOY.md` (tiếng Việt, từng bước):
   1. Mua tên miền; DNS: bản ghi `A` cho `@` và `www` → IP VPS.
   2. VPS Ubuntu 22.04/24.04: `apt update && apt upgrade -y`; cài `nginx mysql-server git ufw`; Node 20 qua NodeSource; `npm i -g pm2`; `ufw allow OpenSSH` + `ufw allow 'Nginx Full'` + `ufw enable`. **Không mở cổng 3306 và 5000.**
   3. `mysql_secure_installation`; tạo user ứng dụng từ `mysql-user.sql`.
   4. Đưa code lên (git/scp); `cd backend && npm ci --omit=dev`.
   5. Tạo `backend/.env`: `NODE_ENV=production`, `PORT=5000`, `FRONTEND_URL=https://tenmiencuaban.vn`, 3 secret mới (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` cho `JWT_SECRET`, `JWT_REFRESH_SECRET`, `LEVEL_ACCESS_SECRET`), `SEED_ADMIN_PASSWORD` mạnh, `SEPAY_API_KEY`, `BANK_BIN/BANK_ACCOUNT/BANK_NAME`, SMTP mới, `ORDER_TTL_MINUTES`. `chmod 600 backend/.env`.
   6. `npm run setup-db` (migration 002→007 + seed admin).
   7. `pm2 start deploy/ecosystem.config.js && pm2 save && pm2 startup` (**không** dùng `npm start` vì có `prestart`).
   8. Nginx: copy file mẫu vào `sites-available`, `ln -s` sang `sites-enabled`, `nginx -t && systemctl reload nginx`.
   9. HTTPS: `apt install certbot python3-certbot-nginx`; `certbot --nginx -d tenmiencuaban.vn -d www.tenmiencuaban.vn`; bật chuyển hướng HTTP→HTTPS; kiểm tra `systemctl status certbot.timer`.
   10. SePay: webhook `https://tenmiencuaban.vn/api/payments/webhook/sepay`, API key trùng `SEPAY_API_KEY`, header `Authorization: Apikey <KEY>`; test bằng 1 giao dịch thật số tiền nhỏ.
   11. Đổi mật khẩu admin ngay lần đăng nhập đầu; bật `unattended-upgrades`; cài cron backup.
   12. Checklist nghiệm thu (mục D.3).
   13. Khắc phục sự cố: 502 (PM2 chưa chạy), cookie không lưu (thiếu `X-Forwarded-Proto`/`trust proxy`/HTTPS), webhook 401/403 (sai key), QR sai (sai BIN/tài khoản), email không gửi (App Password), **nút bấm không chạy (CSP chặn inline handler — xem Console)**.
6. Cập nhật `README.md` (mục "Bảo mật & Triển khai", bảng biến môi trường **đúng tên biến thật**, cách thêm level mới vào `catalog.js`, cách cấp quyền thủ công, cách test webhook bằng `scripts/simulate-webhook.js`, Node ≥ 20) và `CHANGES.md`.

### C.5 Gia cố frontend khi lên production
- Tailwind: build CSS tĩnh (`tailwindcss` ở devDependencies gốc, `tailwind.config.js` quét `index.html payment.html admin.html level*/**/*.html assets/*.js`, output `assets/tailwind.css` minify, script `npm run build:css`), thay `<script src="https://cdn.tailwindcss.com">` ở 3 trang + `sendBlockedHtml`; safelist các class động. Commit file CSS đã build. Sau đó **bỏ `'unsafe-eval'` và `cdn.tailwindcss.com`** khỏi `scriptSrc`.
- confetti/gsap: tự host trong `assets/vendor/` (ưu tiên) hoặc gắn `integrity` + `crossorigin`.
- HSTS (`max-age=15552000; includeSubDomains`) ở production, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` tắt camera/mic/geolocation nếu game không dùng. Chạy CSP ở `reportOnly` trước rồi mới enforce khi đã loại bỏ inline handler (Phase A Bước 2).

---

## PHASE D — (PHASE 8) KIỂM THỬ & NGHIỆM THU

### D.1 Test tự động (chạy bằng `node scripts/<tên>.js`, thoát mã ≠ 0 nếu fail; tích hợp vào `npm run test:all`)
- `test-csp.js` (xem A.4).
- `test-static-block.js`: các URL phải 403/404: `/backend/.env`, `/backend/src/server.js`, `/package.json`, `/backend/package.json`, `/.git/config`, `/node_modules/x`, `/README.md`, `/CHANGES.md`, `/level1/README.md`, `/%2e%2e/backend/.env`, `/assets/..%2fbackend/.env`, chữ hoa/`//`; `/assets/quests.json` = 200; `/assets/safe.js` = 200.
- `test-level-guard.js`: khách → `/level1/level1.html` = 401/403, `/level0/level0.html` = 200; user chưa mua → 403 `LEVEL_LOCKED`; mua `pack_1_4` → level 1–4 = 200, level 5 khóa; Premium mở mọi level trong `LEVELS`; path traversal các biến thể → 403/404; **mô phỏng lỗi DB → fail-closed (503)**; cấp gói xong vào level được ngay (không chờ cache).
- `test-payment-flow.js` (dùng `simulate-webhook.js`):
  1. không có key / sai key / `SEPAY_API_KEY` rỗng → từ chối, **và khóa dự phòng cũ `sepay_webhook_secret_key_sigmabloom_2026` bị từ chối**;
  2. tiền ra (`transferType:'out'`) → bỏ qua;
  3. thiếu / NaN / âm / số thực `amount` → 400, không cấp quyền;
  4. đủ tiền, nội dung chứa mã (chữ thường, thêm chữ, thêm khoảng trắng) → `paid`, mở đúng level;
  5. gửi lại cùng giao dịch → không cấp trùng, vẫn 200;
  6. gửi `no_order` hai lần → không lỗi 500, không sập server;
  7. **hai webhook song song cùng `id`** → chỉ một cấp quyền, server vẫn sống;
  8. thiếu tiền → `underpaid`, không cấp; chuyển bù phần còn lại → `paid` (nếu chọn cộng dồn);
  9. đơn `expired` nhưng tiền vào trễ → vẫn mở khóa;
  10. đơn đã `paid` nhận giao dịch thứ hai → không đổi `paid_at`, không cấp lại;
  11. user A không đọc/hủy được đơn của user B (**404**);
  12. user đã sở hữu gói → tạo đơn 409; đang có đơn `pending` → trả lại đơn cũ; thiếu `BANK_*` → 503.
- `test-admin-authz.js`: user thường gọi mọi `/api/admin/*` → 403; admin bị hạ role trong DB → mất quyền ngay dù JWT còn hạn; `grant`/`revoke`/`reconcile` ghi `admin_audit_log`.
- `test-xss.js`: giữ các test hiện có; thêm kiểm tra không còn nối chuỗi vào inline `onclick` ở `admin.html`.
- `test-auth-hardening.js`: rate limit login/forgot hoạt động; đăng nhập sai không lộ user tồn tại; refresh token cũ bị thu hồi sau reset mật khẩu.
- `test-env-failfast.js`: khởi động với `NODE_ENV=production` và secret thiếu/ngắn/mặc định/trùng nhau, thiếu `SEPAY_API_KEY`/`BANK_*`, mật khẩu admin yếu → thoát lỗi mã ≠ 0.

### D.2 Báo cáo cuối (bắt buộc)
(a) file tạo/sửa; (b) bảng Trước/Sau từng lỗi; (c) **output thật** của `npm run test:all` (không tóm tắt tự viết); (d) các mục còn `TODO: xác minh`; (e) việc **tôi phải tự làm**: thu hồi Gmail App Password cũ, sinh secret mới, đổi key webhook, đăng ký SePay + cấu hình webhook, mua tên miền/VPS, test một giao dịch thật số tiền nhỏ.

### D.3 Checklist nghiệm thu SAU KHI deploy (ghi vào `deploy/DEPLOY.md`)
- Mở trang chủ: **bấm được mọi nút**, Console không có lỗi CSP; vào được Level 0.
- `https://tenmiencuaban.vn/backend/.env`, `/package.json`, `/backend/src/server.js`, `/README.md` → 403/404.
- `/level1/level1.html` khi chưa đăng nhập hoặc chưa mua → bị chặn; sau khi mua → vào được.
- Đăng nhập admin bằng `admin/admin` hoặc `Admin@123456` → **thất bại**.
- Tạo user tên chứa `<script>` → bị từ chối; trang admin không chạy script.
- Gọi webhook không key → 401/403; dùng khóa cũ `sepay_webhook_secret_key_sigmabloom_2026` → bị từ chối.
- `curl -I https://…` thấy HSTS, CSP, `X-Content-Type-Options`; cookie `refreshToken` và `levelAccess` có `HttpOnly; Secure; SameSite`.
- Quét QR thử: đúng ngân hàng/số tài khoản/tên chủ TK/số tiền/nội dung = mã đơn.
- Mua gói thật số tiền nhỏ → đơn tự `paid` trong vài giây, email xác nhận đến, level mở không cần tải lại trang.
- Tắt MySQL tạm thời → level trả phí **không** phục vụ (fail-closed), trang chủ và level 0 vẫn chạy.
- `ss -tlnp` trên VPS: chỉ 22/80/443 công khai; 3306 và 5000 chỉ ở `127.0.0.1`.

---

## RÀNG BUỘC CHUNG
- Không thêm thư viện nặng không cần thiết (không ORM, không framework test; `tailwindcss` làm devDependency được).
- Chạy được bằng đúng các lệnh: `cd backend && npm ci && npm run setup-db && npm run dev` (dev) và `pm2 start deploy/ecosystem.config.js` (production).
- **Quyết định còn mở — hỏi tôi, mặc định ghi trong ngoặc:**
  1. Phase A Bước 2 (chuyển hết inline handler sang `addEventListener`) làm ngay hay để sau? (**làm sau Bước 1, trước khi public**)
  2. Chuyển khoản thiếu: cộng dồn tự động hay chỉ admin đối soát? (**cộng dồn**)
  3. Lỗi DB ở level guard: fail-closed hay cho cache ≤ 5 phút? (**fail-closed**)
  4. Gói vĩnh viễn (đã áp dụng) — giữ nguyên? (**giữ**)
  5. Tên miền chính thức & có dùng `www` không? (**hỏi tôi**)
