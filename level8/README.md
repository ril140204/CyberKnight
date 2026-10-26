# Level 8: "Trận Chiến An Toàn Số" — CyberKnight

> Tài liệu kỹ thuật cho Level 8: Video mở đầu → Bản đồ Thành Phố Số (3 Trạm Thử Thách) → Trận Đấu Trùm (Vua Độc Hại) → Video kết thúc → Tổng kết.  
> Thời lượng ~2 phút 30 giây · Video chính (`intro.mp4`, `outtro.mp4` / `outro.mp4`) · Ảnh AI quái vật Trạm 2 (`quai_vat_ai.jpg`) · XP tối đa 30 · Huy hiệu HIỆP SĨ AN TOÀN SỐ.

---

## 1. Cấu trúc file

```
level8/
├── level8.html            # Markup: TopBar (Thoát/Bỏ qua), Start Overlay, video stages, stage-map, 3 stages trạm, stage-boss, summary
├── level8.css             # Tokens + z-index + stages + tiền tố bt-* + responsive + reduced-motion + safe touch
├── level8.js              # Controller: SCENE_FLOW, ResourceSource, AudioSynth, FreezeFrame, State Machine, Boss battle, debug flags
└── README.md              # File tài liệu kỹ thuật này
```

---

## 2. Video & Asset Files

Thư mục asset: `video/level 8/` (có khoảng trắng).

| Loại | Tên file | Kích thước | Ghi chú |
|------|----------|------------|---------|
| Video giới thiệu | `intro.mp4` | 10.92 MB | 720p H.264 CRF 23 AAC, `-movflags +faststart` (Bản gốc lưu tại `intro_original.mp4` 68.57 MB) |
| Video kết thúc | `outtro.mp4` | 6.73 MB | 720p H.264 CRF 23 AAC, `-movflags +faststart` (Bản gốc lưu tại `outtro_original.mp4` 43.77 MB) |
| Video kết thúc (alias) | `outro.mp4` | 6.73 MB | File alias tương thích chuẩn `outro` |
| Ảnh AI Trạm 2 | `quai_vat_ai.jpg` | 132 KB | 1280×720 16:9, ảnh AI bờ biển với chi tiết lỗi (vuốt thừa, chữ vô nghĩa) |

**Thứ tự dò thư mục** (`ResourceSource.baseIdx`):

| # | Thư mục | Ghi chú |
|---|---------|---------|
| 1 | `../video/level 8/` | ← **vị trí thật** (có khoảng trắng) |
| 2 | `../video/level8/` | fallback không khoảng trắng |
| 3 | `video/level8/` | fallback khi nhúng trong thư mục khác |
| 4 | `./` | fallback cuối cùng |

**Thứ tự dò đuôi file video:** `.mp4` → `.webm` → `.mov`. Mọi URL được xử lý qua `encodeURI()` để mã hóa an toàn khoảng trắng.  
Dò video outro hỗ trợ cả 2 tên file: `outtro` và `outro`.

---

## 3. Luồng State Machine & Kiến trúc Màn chơi

```javascript
const SCENE_FLOW = {
  intro: { next: 'map' },
  outro: { next: 'summary' }
};
const ALL_STAGES = ['intro', 'map', 'st1', 'st2', 'st3', 'boss', 'outro', 'summary'];
```

```
[BẮT ĐẦU]
   │
   ▼
intro.mp4 ────────────────────────► [BẢN ĐỒ THÀNH PHỐ SỐ]
                                               │
                                               ├────────► [TRẠM 1: CÔNG VIÊN QR] ────► Nhận Mảnh Cầu 1 ──┐
                                               │                                                          │
                                               ├────────► [TRẠM 2: BỜ BIỂN TIN GIẢ] ──► Nhận Mảnh Cầu 2 ──┤
                                               │                                                          │
                                               ├────────► [TRẠM 3: CHỢ ỨNG DỤNG] ────► Nhận Mảnh Cầu 3 ──┤
                                               │                                                          │
                                               ▼                                                          │
                                       [TRẬN ĐẤU TRÙM] ◄──────────────────────────────────────────────────┘
                                       (Khiên Ánh Sáng)
                                               │
                                               ▼ (Đạt 20 lần bấm phong ấn vào lọ)
                                           outtro.mp4
                                               │
                                               ▼
                                         ★ TỔNG KẾT ★
                                   (Huy hiệu, Sao, XP, Bằng Khen)
```

---

## 4. Chi tiết 3 Trạm Thử Thách & Trận Đấu Trùm

### Trạm 1: Công Viên QR (`stage-st1`)
- Bảng tin công viên với mã QR SVG giả lập (tuyệt đối không mở camera thật `getUserMedia`).
- Nút "📷 QUÉT MÃ" kích hoạt hiệu ứng tia quét laser + âm thanh tone quét.
- Popup màn hình điện thoại hiển thị link văn bản `http://qua-tang-mien-phi.xyz` (không dùng thẻ `<a href>`).
- 3 nút hành động trung tính:
  - 🌐 MỞ LINK (Sai) → tính 1 slip, phát âm thanh cảnh báo, cho phép chọn lại.
  - 📤 GỬI LINK CHO BẠN (Sai) → tính 1 slip, phát âm thanh cảnh báo, cho phép chọn lại.
  - 🚫 TẮT VÀ XÓA MÃ QR (Đúng) → confetti, phát âm thanh thành công, nhận Mảnh Cầu 1, mở khóa Trạm 2.

### Trạm 2: Bờ Biển Tin Giả & Bút Thử AI (`stage-st2`)
- Bài đăng mạng xã hội giật gân về quái vật xuất hiện ở bờ biển kèm ảnh AI.
- Công cụ **Bút Thử AI 🔍**: Kích hoạt chế độ kính lúp phóng to 2.5× tại điểm chạm để soi các chi tiết bất thường (quái vật có 7 ngón vuốt, chữ trên bờ biển méo mó vô nghĩa).
- 3 nút hành động trung tính:
  - ❤️ THẢ TIM (Sai) → tính 1 slip, cho phép chọn lại.
  - 🔁 CHIA SẺ CHO BẠN BÈ (Sai) → tính 1 slip, cho phép chọn lại.
  - 📢 BÁO CÁO TIN GIẢ (Đúng) → confetti, phát âm thanh thành công, nhận Mảnh Cầu 2, mở khóa Trạm 3.

### Trạm 3: Chợ Ứng Dụng (`stage-st3`)
- 4 thẻ app: 1 app an toàn ("Trường Học Số" có tích xanh, quyền hợp lý) + 3 app nhái độc hại ("Đua Xe Siêu Cấp", "Đổi Giọng Nói Vui", "Tải Nhạc Siêu Tốc").
- Hỗ trợ 2 phương thức tương tác Touch-First:
  1. **Chạm 2 bước (Chính):** Chạm thẻ app để chọn (viền vàng) → Chạm thùng rác 🗑️ để dọn.
  2. **Kéo thả:** Kéo thả thẻ app vào vùng thùng rác.
- **Xử lý chống nuốt cảm ứng:** Ngưỡng kéo `DRAG_THRESHOLD_PX = 8`. Cú chạm có rung lắc ≤ 3px vẫn được tính là click/chọn. Cờ chặn click tự gỡ sau 50ms.
- Ném nhầm app an toàn: thẻ app rung lắc, trở về vị trí cũ, tính 1 slip.
- Ném đúng app nhái: app biến mất, tăng bộ đếm rác `0/3 -> 3/3`, phát âm thanh pop. Khi đủ 3 app nhái → nhận Mảnh Cầu 3, mở khóa Tháp Vua Độc Hại.

### Trận Đấu Trùm: Tháp Vua Độc Hại (`stage-boss`)
- 3 Mảnh Cầu hợp nhất thành **Khiên Ánh Sáng** bảo vệ Thành Phố Số.
- Tương tác: Bấm liên tục vào Khiên Ánh Sáng (`pointerdown` hoặc phím `Space`/`Enter`) ~20 lần (`CONFIG.BOSS_CLICKS_NEEDED = 20`) để phóng chùm sáng phong ấn Vua Độc Hại.
- An toàn quang học (WCAG 2.1 - 2.3.1): Điều tiết chùm sáng tối đa 1 lần / 80ms (`CONFIG.THROTTLE_BEAM_MS = 80`), không nhấp nháy vượt quá 3 lần/giây, tắt hiệu ứng khi người dùng bật `prefers-reduced-motion`.
- Thanh năng lượng Boss giảm từ 100% về 0%, hình quái vật thu nhỏ dần và rơi xuống đáy lọ thủy tinh. Nắp lọ đóng chặt 🔒.
- Không có cơ chế thua hoặc đếm ngược thời gian thua. Nếu trẻ dừng tay > 10s, Bip hiển thị gợi ý nhắc nhở.

---

## 5. Tổng kết & Đánh giá (stage-summary)

### Đánh giá Sao & XP
- **3 Sao (30 XP):** Slips = 0 hoặc 1.
- **2 Sao (20 XP):** Slips = 2 hoặc 3.
- **1 Sao (10 XP):** Slips ≥ 4.
- Không bao giờ có 0 sao hoặc thất bại.

### 4 Bí Kíp Hiệp Sĩ Số (Mỗi ý ≤ 8 từ, 1 emoji)
1. 🔗 Không bấm link lạ
2. 📱 Không tải app rởm
3. 🖼️ Không tin ảnh AI
4. 👨‍👩‍👧 Luôn hỏi ý kiến Bố Mẹ

### Bằng Khen Danh Dự
- Thẻ Bằng Khen gọn gàng chứng nhận danh hiệu **HIỆP SĨ AN TOÀN SỐ**.
- Không hiển thị trường nhập tên hay hỏi thông tin cá nhân của trẻ.

---

## 6. URL Debug Flags

Hỗ trợ kiểm thử trực tiếp các màn qua tham số URL:

| Query Param | Mô tả |
|-------------|-------|
| `?skip=intro` | Vào thẳng video mở đầu |
| `?skip=map` | Vào thẳng Bản đồ Thành Phố Số |
| `?skip=st1` | Vào thẳng Trạm 1 (Công Viên QR) |
| `?skip=st2` | Vào thẳng Trạm 2 (Bờ Biển Tin Giả) |
| `?skip=st3` | Vào thẳng Trạm 3 (Chợ Ứng Dụng) |
| `?skip=boss` | Vào thẳng Trận Đấu Trùm |
| `?skip=outro` | Vào thẳng video kết thúc |
| `?skip=summary` | Vào thẳng màn Tổng kết (3 sao) |
| `?skip=summary-retry` | Vào thẳng màn Tổng kết (2 sao) |
| `?debug=1` | Bật console debug log chi tiết |
