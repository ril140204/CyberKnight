# Level 7: "Biệt Đội Chống Bẫy Lừa" — CyberKnight/Sigmabloom

> Tài liệu kỹ thuật cho Level 7: Video giới thiệu → Màn tương tác "Phá Bọt Cạm Bẫy" → Video kết quả (Good / Bad) → Tổng kết.  
> Thời lượng ~1 phút 30 giây · Video chính (intro ~45s, good ~30s, bad ~30s) · XP tối đa 30 · Huy hiệu HIỆP SĨ CHỐNG BẪY LỪA.

---

## 1. Cấu trúc file

```
level7/
├── level7.html            # Markup: TopBar (Thoát/Bỏ qua), Start Overlay, 3 stage video, stage-game, result overlay, summary
├── level7.css             # Tokens + z-index + stage/video/game + tiền tố tr-* + responsive + reduced-motion
├── level7.js              # Controller: SCENE_FLOW, ResourceSource, AudioSynth, FreezeFrame, game loop rAF, debug flags
└── README.md              # File tài liệu kỹ thuật này
```

---

## 2. Video/asset files

Thư mục asset thật **có khoảng trắng**: `video/level 7/`.

| Loại | Tên file thật | Kích thước | Ghi chú |
|------|---------------|------------|---------|
| Video giới thiệu | `intro.mp4` | 29.1 MB | ~45s, có tiếng (playsinline, preload="auto") |
| Video đúng | `good.mp4` | 27.5 MB | ~30s, có tiếng (playsinline, preload="auto") |
| Video sai | `bad.mp4` | 29.0 MB | ~30s, có tiếng (playsinline, preload="auto") |

**Thứ tự dò thư mục** (`ResourceSource.baseIdx`):

| # | Thư mục | Ghi chú |
|---|---------|---------|
| 1 | `../video/level 7/` | ← **vị trí thật** (có khoảng trắng) |
| 2 | `../video/level7/` | fallback không khoảng trắng |
| 3 | `video/level7/` | fallback khi nhúng trong thư mục khác |
| 4 | `./` | fallback cuối cùng |

**Thứ tự dò đuôi file video:** `.mp4` → `.webm` → `.mov`. Mọi URL được xử lý qua `encodeURI()` để mã hóa an toàn khoảng trắng.

---

## 3. Luồng State Machine (SCENE_FLOW)

```javascript
const SCENE_FLOW = {
  intro: { question: 'game' },   // → stage-game (Phá Bọt Cạm Bẫy)
  good:  { next: 'summary' },    // → stage-summary
  bad:   { question: 'retry' }   // → result-overlay (Thử lại / Xem lại)
};
const ALL_STAGES = ['intro', 'game', 'good', 'bad', 'summary'];
```

```
START
  │
  ▼
intro.mp4 ────────────────────────► [TRÒ CHƠI: PHÁ BỌT CẠM BẪY]
                                              │
                    ┌──── Đập đủ 4 bọt + Bọt An Toàn ────┴──── 1 bọt chạm đáy ────┐
                    ▼                                                              ▼
               good.mp4                                                         bad.mp4
                    │                                                              │
                    ▼                                                              ▼
              ★ SUMMARY ★                                                    MÀN THỬ LẠI
                                                                        ┌──────────┴──────────┐
                                                                   🔄 Thử lại       🎬 Xem lại intro
                                                                        │                     │
                                                                        ▼                     ▼
                                                                  [CHƠI LẠI GAME]        intro.mp4
```

---

## 4. Gameplay: "Phá Bọt Cạm Bẫy" (stage-game)

### Bối cảnh & Giao diện
- Khung "màn hình điện thoại giả lập" của Sóc (`#tr-phone-frame`) với viền đỏ cảnh báo nhấp nháy chậm (< 3 lần/giây, tắt hẳn khi `prefers-reduced-motion`).
- Công cụ: **Búa An Toàn 🔨** (`#tr-hammer-cursor`), gõ đập tại vị trí chạm/click.
- 4 làn rơi riêng biệt (`.tr-lane[data-lane="0..3"]`) không bị chồng chéo.
- Thanh tiến độ: `0/4` → `4/4`.

### 4 Bọt Cạm Bẫy
1. `gift` (Làn 0): `🎁 Quà miễn phí! Nhận ngay 1.000 Robux`
2. `link` (Làn 1): `🔗 hack-game-mien-phi.xyz/nhan-qua`
3. `timer` (Làn 2): `⏰ CÒN 30 GIÂY! Tài khoản sắp bị khóa!`
4. `otp` (Làn 3): `🔑 Nhập mật khẩu / mã OTP để nhận quà`

*Xuất hiện so le:* cách nhau 2 giây (0.4s, 2.4s, 4.4s, 6.4s). Thời gian rơi: 14 giây.

### Bọt ✖ An Toàn (Bọt thứ 5)
Chỉ xuất hiện ở giữa màn hình sau khi đã đập tan 4 bọt bẫy:
- Biểu tượng: `🛡️ ✖ ĐÓNG CỬA SỔ / BÁO BỐ MẸ`.
- Chạm vào bọt an toàn → kích hoạt âm thanh lá chắn `playSafeShield()` → chiến thắng → chuyển tiếp video `good.mp4`.

### Ranh giới nguy hiểm (Đáy màn hình)
Nếu bất kỳ bọt nào chạm đáy:
- Màn hình điện thoại rung giật (`.tr-shake`).
- Âm thanh dính bẫy `playTrapHit()`.
- Chuyển tiếp video `bad.mp4`. Khi video kết thúc, hiển thị `#result-overlay` hướng dẫn con thử lại.

---

## 5. An toàn & Bảo mật DOM
- Toàn bộ nội dung bọt bẫy được chèn bằng `textContent`.
- Tuyệt đối **không** tạo thẻ `<a href>`, không tạo `<input>`, không tạo `<form>`.
- Sự kiện gán bằng `pointerdown` trực tiếp, đảm bảo tương tác mượt mà trên cảm ứng (chịu rung ngón tay ≤ 8px).

---

## 6. Tính Sao & Phần thưởng
- **3 ⭐ & 30 XP**: Thắng ngay lần đầu (không bọt nào chạm đáy).
- **2 ⭐ & 20 XP**: Dính bẫy 1 lần và thử lại thành công.
- **1 ⭐ & 10 XP**: Thử lại từ 2 lần trở lên.
- **Huy hiệu**: 🏅 `HIỆP SĨ CHỐNG BẪY LỪA`.

---

## 7. Màn Tổng Kết (Summary)
Thiết kế gọn gàng, tự co giãn theo tỷ lệ viewport (`clamp`), đảm bảo hiển thị trọn vẹn cả 2 nút hành động mà không cần cuộn trên cả desktop 1280×720 và điện thoại 390×760:
- Logo CyberKnight + Huy hiệu 🛡️
- Sao ⭐ + XP
- **3 Ý Nhớ Nhanh:**
  - 🎁 Quà miễn phí thường là bẫy lừa đảo
  - 🔗 Không bao giờ bấm vào đường link lạ
  - 👨‍👩‍👧 Thấy lạ thì đóng lại và báo ngay bố mẹ
- Hành trình ngắn gọn của con
- Nút `[🔄 Chơi lại]` và `[Tiếp tục hành trình ▶]`

---

## 8. Debug Flags trong URL

| Tham số | Chức năng |
|---------|-----------|
| `?skip=intro` | Nhảy thẳng vào video giới thiệu |
| `?skip=game` | Nhảy thẳng vào trò chơi đập bọt |
| `?skip=good` | Nhảy thẳng vào video đúng |
| `?skip=bad` | Nhảy thẳng vào video sai |
| `?skip=result-wrong` | Nhảy thẳng vào màn kết quả dính bẫy |
| `?skip=summary-first` | Xem màn tổng kết 3 ⭐, 30 XP |
| `?skip=summary-retry` | Xem màn tổng kết 2 ⭐, 20 XP |
| `?skip=summary` | Xem màn tổng kết mặc định |
| `?debug=1` | Bật nhật ký chẩn đoán trong Console |
