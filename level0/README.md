# CyberKnight – Level 0: Hộp Quà Bí Ẩn ("Máy Soi Kim Cương")

> Tài liệu kỹ thuật chi tiết dành cho Developer / AI khác tiếp tục phát triển và tích hợp Level 0 vào hệ thống CyberKnight / Sigmabloom.

---

## 1. Architecture & Luồng Chuyển Cảnh

Level 0 là một trải nghiệm 4 stages nối tiếp, liền mạch, full viewport:

```
┌──────────────────────┐    crossfade     ┌────────────────────┐    crossfade    ┌─────────────────────┐
│ STAGE 1              │   freeze-frame   │ STAGE 2            │   scratch snap  │ STAGE 3             │
│ Video mở đầu         │ ───────────────► │ MINI-GAME          │ ──────────────► │ Video hậu quả       │
│ "Vd tinh huong.mp4"  │   500ms ease-in  │ "Máy Soi Kim Cương"│   500ms ease    │ (rẽ nhánh 2 file)   │
└──────────────────────┘                  └────────────────────┘                 └─────────────────────┘
                                                                                          │
                                                                                          │ video ended
                                                                                          ▼
                                                                                  ┌──────────────────┐
                                                                                  │ STAGE 4          │
                                                                                  │ SUMMARY          │
                                                                                  │ XP + Huy hiệu    │
                                                                                  └──────────────────┘
```

### 1.1 Nguyên tắc cốt lõi
- **Không bao giờ để màn hình đen giữa các stage:** Mọi chuyển cảnh đều dùng **Freeze-Frame Crossfade**: chụp frame của thẻ `<video>` / game lên `<canvas id="freeze-canvas">`, set `opacity: 1`, đợi 60ms cho render ổn định, chuyển DOM stage, rồi fade out freeze-frame canvas (120ms).
- **Video qua `CKVideo` (`/assets/video-loader.js`):** HLS thích ứng (hls.js, 360p/480p/720p theo băng thông) → HLS native (Safari) → MP4 720p. Intro được gắn nguồn ngay khi mở trang; 2 nhánh hậu quả chỉ được **prefetch playlist** (vài KB, không tải segment) để không tranh băng thông với intro trên mạng yếu.
- **Synthesized Audio:** Tích hợp bộ phát âm thanh Web Audio API (`AudioSynth`) tự động tổng hợp sóng âm cho tiếng tick, scanner hum, warning siren, glitch explosion và victory chime — không phụ thuộc vào file âm thanh rời bên ngoài, không lo lỗi 404 mạng.

---

## 2. Cấu trúc File (File Map)

```
EXEWEB/
├── video/
│   └── level0/
│       ├── intro.mp4, bad.mp4, good.mp4        (720p ~1.2 Mbps, faststart — fallback)
│       └── hls/{intro,bad,good}/master.m3u8    (HLS 720p/480p/360p, segment 4s)
│       (nguồn gốc nằm ở video-src/level0/, encode bằng scripts/encode-videos.sh)
└── level0/
    ├── level0.html            ← DOM 4 stages, canvas overlay & responsive layout
    ├── level0.css             ← Cyberpunk + Neo-Brutalism tokens & 60fps animations
    ├── level0.js              ← State machine, Web Audio synth, touch drag & transitions
    └── README.md              ← File hướng dẫn kỹ thuật này
```

---

## 3. Cơ chế Mini-game "Máy Soi Kim Cương" (Stage 2)

| Hành vi người chơi | Kết quả rẽ nhánh | Phần thưởng |
|---|---|---|
| Bấm "🎁 NHẬN NGAY!" trước khi soi (vội vàng dính bẫy) | Video hậu quả xấu (`bad.mp4`) | ⭐ +5 XP, Huy hiệu "Cần Luyện Tập Thêm" |
| Kéo kính lúp soi 100% → Chọn 🟥 "NHẬN QUÀ NÀY" (biết có mã độc nhưng vẫn ham quà) | Video hậu quả xấu (`bad.mp4`) | ⭐ +5 XP, Huy hiệu "Cần Luyện Tập Thêm" |
| Kéo kính lúp soi 100% → Chọn 🟢 "KHÔNG NHẬN QUÀ NÀY" (cảnh giác từ chối quà độc hại) | Video hậu quả tốt (`good.mp4`) | ⭐ +20 XP, Huy hiệu "Hiệp Sĩ Cảnh Giác" |
| Hết 15 giây đếm ngược lần đầu | Tạm dừng, hiện bong bóng gợi ý và gia hạn 5s | Dành cho trẻ nhỏ có thời gian suy nghĩ |
| Hết thời gian đếm ngược lần hai | Tự động tính như nhận ngay (nhánh xấu) | Bài học: Lưỡng lự trước cám dỗ vẫn dẫn đến nguy hiểm |

> **Nguyên tắc quyết định không định hướng:** Khi soi đạt 100% và phát hiện mã độc, giao diện cung cấp song song 2 nút (🟥 "NHẬN QUÀ NÀY" và 🟢 "KHÔNG NHẬN QUÀ NÀY") với kích thước, độ nổi bật và trọng số hoàn toàn bằng nhau, không dùng hiệu ứng pulse hay glow ưu tiên để trẻ tự lập cân nhắc và chịu trách nhiệm với quyết định của mình.

---

## 4. Tích hợp & Sự kiện Hoàn thành

### 4.1 Mở độc lập
Mở trực tiếp trên trình duyệt qua URL máy chủ:
```
http://localhost:5000/level0/level0.html
```

### 4.2 Nhúng vào Single Page App (SPA) / Iframe
```html
<iframe src="/level0/level0.html" allow="autoplay" style="width:100vw; height:100vh; border:0;"></iframe>
```

### 4.3 Lắng nghe sự kiện hoàn thành
Khi người chơi xem xong video và chuyển đến màn hình Tổng kết (Stage 4), ứng dụng phát ra một `CustomEvent`:
```javascript
window.addEventListener('level0:complete', (event) => {
    console.log('Level 0 hoàn tất! Nhánh:', event.detail.path);
    console.log('Điểm thưởng:', event.detail.xp);
    console.log('Huy hiệu:', event.detail.badge);
    // Ví dụ: Gọi API cập nhật tiến trình tài khoản lên Backend
});
```

### 4.4 Các cờ Debug URL để kiểm thử nhanh
- `?skip=intro` hoặc `?skip=game`: Bỏ qua video mở đầu, vào thẳng mini-game "Máy Soi Kim Cương".
- `?skip=summary-good`: Xem trực tiếp màn hình tổng kết nhánh Tốt (+20 XP, Hiệp Sĩ Cảnh Giác).
- `?skip=summary-bad`: Xem trực tiếp màn hình tổng kết nhánh Xấu (+5 XP, Cần Luyện Tập Thêm).
