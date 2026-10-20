# CyberKnight – Level 2: Kết Bạn Online — Người Bạn Mới ("Ghép Cửa Bảo Vệ Căn Cứ")

> Tài liệu kỹ thuật cho Level 2: Mini-game ghép cửa bảo vệ căn cứ (Drag & Drop Assembly) với 2 nhánh hậu quả.

---

## 1. Architecture & Luồng Chuyển Cảnh

```
┌──────────────────────────────────────────────────────────────────┐
│                      LEVEL 2: 4-STAGE FLOW                       │
│                                                                  │
│  ┌──────────────┐     ┌──────────────────┐     ┌──────────────┐ │
│  │ STAGE INTRO  │ ──▶ │   STAGE GAME     │ ──▶ │ STAGE OUTRO  │ │
│  │  Video mở   │     │ Door Puzzle Mini- │     │ 2 Nhánh:    │ │
│  │    đầu     │     │    game (Drag &   │     │ open /      │ │
│  │             │     │    Drop Assembly) │     │ closed      │ │
│  └──────────────┘     └──────────────────┘     └──────────────┘ │
│         │                     │                        │         │
│         │                     │                        ▼         │
│         │                     │              ┌──────────────────┐│
│         │                     │              │  STAGE SUMMARY  ││
│         │                     │              │  2 Nhánh:       ││
│         │                     │              │  open / closed  ││
│         │                     │              │  (branch-open /  ││
│         │                     │              │   branch-closed) ││
│         │                     │              └──────────────────┘│
│         ▼                     ▼                                     │
│  ┌──────────────────┐  ┌─────────────────────────────┐              │
│  │  DECISION SCREEN │  │ VICTORY OVERLAY (2.5s)     │              │
│  │  2 Nút:         │  │ → Confetti + Door Glow     │              │
│  │  🔓 MỞ CỬA      │  │ → Transition sang OUTRO    │              │
│  │  🔒 GIỮ ĐÓNG    │  └─────────────────────────────┘              │
│  └──────────────────┘                                               │
└──────────────────────────────────────────────────────────────────┘
```

### 1.1 Nguyên tắc cốt lõi

- **Freeze-Frame Crossfade**: Không bao giờ để màn hình đen khi chuyển cảnh
- **Video qua `CKVideo`** (HLS thích ứng → MP4 fallback); 2 nhánh `bad`/`good` chỉ prefetch playlist
- **`stopAllVideos()`**: Gọi ở mọi chuyển stage + replay — tránh chồng tiếng
- **Synthesized Audio (AudioSynth)**: 100% offline, không tải file MP3 bên ngoài
- **Chống vỡ nét video 720p**: `object-fit: contain` + `ambient backdrop`
- **Thanh điều khiển `.level2-top-bar`**: Flexbox góc trên bên phải — chống đè nút
- **Skip button tách riêng**: Fixed bottom-right, không chồng nút THOÁT

### 1.2 Điểm khác biệt với Level 0 & Level 1

| Tính năng | Level 0 | Level 1 | Level 2 |
|---|---|---|---|
| **Mini-game mechanism** | Kính lúp cạo lớp phủ | Hứng/phân loại rơi | Drag & Drop Assembly |
| **Số nhánh hậu quả** | 2 (bad/good) | 3 (A/B/C) | 2 (open/closed) |
| **Countdown timer** | Có | Có (28s) | Không (không áp lực) |
| **Magnetic Snap-in** | Không | Không | Có (50–55px) |
| **Sin Wave Bobbing** | Không | Có (falling items) | Có (puzzle pieces) |
| **Độ khó** | Thấp | Trung bình | Thấp (accessibility) |

### 1.3 [MỚI] Magnetic Snap-in (50–55px)

Khi kéo mảnh ghép đúng gần tâm ổ khóa trong bán kính 50px, mảnh sẽ tự động hút nhẹ về tâm (magnet pull animation) rồi snap-in bounce khi thả trong khoảng 55px. Điều này giúp trẻ nhỏ tay chưa khéo vẫn ghép chính xác được — **bài học về accessibility cho game giáo dục trẻ em**.

### 1.4 [MỚI] Sin Wave Bobbing (10-15px, tốc độ chậm)

Mảnh ghép bay lượn nhẹ nhàng với biên độ 10-15px, tốc độ chậm — phù hợp với chủ đề "xây dựng từ từ, không vội vàng". Dùng `requestAnimationFrame` + `Math.sin(time * speed + phase) * amplitude`.

---

## 2. Cấu trúc File (File Map)

```
level2/
├── level2.html          # Cấu trúc DOM: 4 stages, top bar, skip button, door-puzzle-container, dual-decision-container
├── level2.css           # ~1770 dòng: CSS tokens, door-puzzle styles, dual-decision, summary cards, advice box
├── level2.js            # ~1490 dòng: State machine, AudioSynth, DoorPuzzleScene wrapper, VideoController, SummaryScene, OutroFallbackScene
├── door-puzzle.js       # ~880 dòng: Modular Data-Driven DoorPuzzleEngine class (UMD wrapper, expose window.DoorPuzzleGame)
├── README.md            # Tài liệu kỹ thuật này
│
└── ../video/level2/     # Video đã encode (scripts/encode-videos.sh từ video-src/level2/)
    ├── intro.mp4        # "gioi thieu.mp4" gốc → 720p fallback  (+ hls/intro/master.m3u8)
    ├── bad.mp4          # "hau qua xau.mp4" gốc — nhánh open    (+ hls/bad/master.m3u8)
    └── good.mp4         # "hau qua tot.mp4" gốc — nhánh closed  (+ hls/good/master.m3u8)
    #
    # Lưu ý: Tên file có thể là Tiếng Việt (gioi thieu, hau qua xau, hau qua tot)
    # hoặc Tiếng Anh (intro, bad, good) — game hỗ trợ cả 2 thông qua VIDEO_PATHS
    # fallback trong CONFIG. Tên Tiếng Việt được ưu tiên trước.
```

> **Kiến trúc module:** Tương tự `level1/safety-catch.js`, Level 2 tách riêng `door-puzzle.js` làm module UMD độc lập. Script load order: `door-puzzle.js` → `level2.js`. `level2.js` chỉ chứa wrapper `DoorPuzzleScene` (gọi `new window.DoorPuzzleGame(...)` với CSS class overrides khớp `level2.css`). Điều này giúp engine tái sử dụng được cho level khác nếu cần.

---

## 3. Cơ chế Mini-game "Ghép Cửa Bảo Vệ Căn Cứ" (Drag & Drop Assembly)

### 3.1 Mục tiêu sư phạm

- Trẻ em học cách bảo vệ căn cứ (thông tin cá nhân) bằng cách ghép 3 mảnh khóa đúng vị trí
- Không tạo áp lực thời gian (không countdown) — phù hợp với game giáo dục trẻ em
- Phản hồi tích cực khi ghép sai: shake + bay về vị trí cũ — không trừ điểm/mạng
- Magnetic snap-in 50–55px giúp trẻ nhỏ tay chưa khéo vẫn ghép được

### 3.2 Bảng 3 ô khóa + 3 mảnh ghép đúng

| Slot | Icon | Tên ô khóa | Mảnh ghép đúng | Mảnh mồi nhử |
|---|---|---|---|---|
| `slot-1` | 🔒 | Ổ khóa riêng tư | 🔒 Mat khau rieng tu | 🔓 Mat khau tam thoi, 🔐 Khoa phu |
| `slot-2` | 🛡️ | Khiên tin tưởng | 🛡️ Khiên bao ve | ⚔️ Khiên sat |
| `slot-3` | 🔑 | Chìa khóa người lớn | 🔑 Chia khoa chinh | 🗝️ Chia khoa du phong, ⚠️ Canh bao |

### 3.3 Cơ chế kéo-thả + Magnetic Snap

1. **Mousedown/Touchstart** trên mảnh → Bắt đầu drag, ẩn hint
2. **Mousemove/Touchmove** → Cập nhật vị trí mảnh, highlight slot gần nhất
3. **Mouseup/Touchend**:
   - Trong bán kính 50–55px → `tryDrop()` → snap-in bounce + `playLockSnap()` + lock slot
   - Ngoài bán kính → `rejectPiece()` → shake + bay về vị trí cũ + `playPieceReject()`
4. **Sin wave bobbing**: Animation liên tục bằng `requestAnimationFrame` khi không drag

### 3.4 Ghép đúng vs sai (phản hồi tích cực)

| Trường hợp | Hành động | Âm thanh | Phản hồi |
|---|---|---|---|
| Mảnh đúng + Slot đúng | Snap-in bounce + lock | `playLockSnap()` | Slot glow xanh, light spread |
| Mảnh sai + Slot sai | Magnetic → reject | `playPieceReject()` | Shake 250ms, bay về vị trí cũ |
| Thả ngoài mọi ô | Reject | `playPieceReject()` | Shake 250ms, bay về vị trí cũ |

### 3.5 Khi đủ 3/3: Confetti + Light Spread + Chuyển cảnh

1. `sound.playVictoryChime()` — hợp âm chiến thắng C5-E5-G5-C6
2. Door frame chuyển sang `.unlocked` (glow xanh lá)
3. `confetti({ particleCount: 100, spread: 80 })`
4. Victory overlay hiện sau 400ms
5. setTimeout 2500ms → `showDecisionScreen()`

---

## 4. Tích hợp & Sự kiện Hoàn thành

### 4.1 Mở độc lập

Mở trực tiếp file `level2.html` trong trình duyệt (hoặc qua server):

```
file:///C:/Users/ASUS/OneDrive/M%C3%A1y%20t%C3%ADnh/EXEWEB/level2/level2.html
```

### 4.2 Iframe embed

```html
<iframe
  src="../level2/level2.html"
  width="100%"
  height="100%"
  frameborder="0"
  allow="autoplay; fullscreen"
></iframe>
```

### 4.3 Lắng nghe `level2:complete` event

```javascript
window.addEventListener('level2:complete', (event) => {
  const { path, xp, badge } = event.detail;
  console.log(`Level 2 completed! Path: ${path}, XP: ${xp}, Badge: ${badge}`);
  // Gửi lên server, cập nhật progress, v.v.
});
```

### 4.4 Cờ Debug URL

| URL Flag | Mô tả |
|---|---|
| `?skip=intro` hoặc `?skip=game` | Vào thẳng door puzzle |
| `?skip=decision` | Vào thẳng 2 nút quyết định |
| `?skip=summary-open` | Xem trực tiếp summary nhánh open |
| `?skip=summary-closed` | Xem trực tiếp summary nhánh closed |
| `?skip=outro-open` | Test video hậu quả nhánh open |
| `?skip=outro-closed` | Test video hậu quả nhánh closed |

---

## 5. Rút kinh nghiệm & Cải tiến kỹ thuật kế thừa từ Level 0 & Level 1

### 5.1 Khắc phục trùng lặp cơ chế

- **Level 0**: Kính lúp cạo lớp phủ (scratch card)
- **Level 1**: Hứng/phân loại vật phẩm rơi (catching game)
- **Level 2**: Drag & Drop Assembly (cơ chế HOÀN TOÀN MỚI) — ghép cửa

### 5.2 Khắc phục lỗi video outro không phát

- **Lỗi Level 1**: Video không phát do `autoplay` restriction hoặc file 404 không retry
- **Giải pháp Level 2**: 
  - `preload="metadata"` cho 3 video
  - `tryLoadWithFallback()` thử 4 đường dẫn dự phòng
  - `_outroFallbackTimer` 60s → fallback scene nếu video không load
  - `cancelFallbackOnReady()` huỷ timer khi video sẵn sàng phát

### 5.3 Khắc phục lỗi chồng nút

- **Lỗi Level 1**: Skip button nằm trong top bar → đè nút THOÁT
- **Giải pháp Level 2**: Skip button là `position: fixed; bottom: 22px; right: 22px;` — tách riêng hoàn toàn

### 5.4 Khắc phục lỗi chồng tiếng

- **Lỗi**: `playIntro()` gọi khi video intro đã đang play
- **Giải pháp**: `stopAllVideos()` bắt buộc ở mọi chuyển stage + replay

### 5.5 [MỚI] Magnetic Snap-in 50–55px

- Giúp trẻ nhỏ tay chưa khéo ghép chính xác — bài học về accessibility cho game giáo dục trẻ em
- Không ảnh hưởng đến trải nghiệm của trẻ lớn hơn (vẫn phải kéo đến gần)

### 5.6 [MỚI] Không đếm ngược

- Mini-game giáo dục không nên tạo áp lực thời gian
- Trẻ em học tốt hơn khi không bị催促

### 5.7 [MỚI] 2 Nhánh thay vì 3

- Level 1 có 3 nhánh (A/B/C) — có thể gây nhầm lẫn cho trẻ em nhỏ
- Level 2 chỉ có 2 nhánh (MỞ CỬA / GIỮ ĐÓNG) — đơn giản hóa quyết định

---

## 6. AudioSynth — Chi tiết kỹ thuật

### 6.1 Các method có sẵn (kế thừa từ Level 1)

| Method | Mô tả | Đặc điểm |
|---|---|---|
| `playTick()` | Tiếng click nhẹ | Sine 800→400Hz, 50ms |
| `playCorrectCatch(combo)` | Tiếng ting tăng cao độ | C5→E5, volume 0.18 |
| `playIncorrectCatch()` | Tiếng bụp nhẹ | Triangle 220→110Hz, 160ms |
| `playVictoryChime()` | Hợp âm chiến thắng | C5-E5-G5-C6 arpeggio |
| `playGlitchExplosion()` | Tiếng nổ glitch | Noise buffer + lowpass sweep |

### 6.2 [MỚI] Method Level 2

| Method | Mô tả | Đặc điểm |
|---|---|---|
| `playLockSnap()` | Tiếng chốt khóa chắc chắn | 2× Sawtooth (110Hz+165Hz) + Sine click (800Hz), 80ms |
| `playPieceReject()` | Tiếng từ chối (decoy/sai ô) | Square 220→110Hz, 150ms, volume 0.10 |
| `playLockBounce()` *(alias)* | Tiếng bật nhẹ (backward-compat) | Triangle 300→180Hz, 120ms, volume 0.08 |

### 6.3 AudioContext unlock

`AudioSynth.init()` phải được gọi sau sự kiện tương tác người dùng (click/touch) — được gọi tự động trong tất cả các nút bấm.

---

## 7. Summary Scene — Chi tiết kỹ thuật

### 7.1 Nhánh OPEN (Xấu)

```javascript
{
  badgeIcon: '😮',
  title: 'CẦN CẨN THẬN HƠN!',
  xp: 5,
  badge: 'Người Mới Học',
  sound: playGlitchExplosion()
}
```

### 7.2 Nhánh CLOSED (Tốt)

```javascript
{
  badgeIcon: '🛡️',
  title: 'LEVEL 2 COMPLETED!',
  xp: 20,
  badge: 'HIỆP SĨ KẾT BẠN THÔNG MINH',
  sound: playVictoryChime(),
  confetti: true
}
```

### 7.3 4 Bài học LUÔN hiển thị (bất kể nhánh nào)

1. 🧠 Người quen online chưa chắc là người mình biết ngoài đời
2. 🎁 Đừng tin chỉ vì người đó tặng quà
3. 🤫 Không giữ bí mật với bố mẹ
4. 🚫 Không tự gặp người quen online

---

## 8. CSS Tokens (Copy từ Level 1)

```css
:root {
    /* Color Palette */
    --ck-blue-50: #EBF5FF;
    --ck-blue-500: #0066FF;
    --ck-sky: #00D4FF;
    --ck-mint: #4ECDC4;
    --ck-green: #22C55E;
    --ck-yellow: #FFD700;
    --ck-red: #FF4757;
    --ck-purple: #8B5CF6;

    /* Shadows */
    --ck-shadow-soft: 0 4px 20px rgba(0, 102, 255, 0.12);
    --ck-shadow-card: 0 8px 32px rgba(0, 102, 255, 0.15), 0 2px 8px rgba(0, 0, 0, 0.06);
    --ck-shadow-button: 0 4px 16px rgba(0, 102, 255, 0.3);

    /* Fonts */
    --font-heading: 'Poppins', 'Space Grotesk', sans-serif;
    --font-body: 'Poppins', 'Inter', -apple-system, sans-serif;
}
```

---

## 9. Checklist triển khai

- [x] Copy CSS tokens NGUYÊN từ level1.css
- [x] `object-fit: contain` cho mọi video player
- [x] Mọi nút góc màn hình trong flex container hoặc tách fixed vị trí rõ ràng
- [x] `stopAllVideos()` gọi ở mọi chuyển stage + replay
- [x] AudioSynth có 3 method MỚI: `playLockSnap`, `playPieceReject`, `playLockBounce` (alias)
- [x] Magnetic snap-in khi mảnh đúng trong bán kính 50–55px
- [x] Sin wave bobbing animation (10-15px, tốc độ chậm)
- [x] Confetti CDN load
- [x] CustomEvent `level2:complete` với detail { path, xp, badge }
- [x] Comment "NGUYÊN TẮC QUYẾT ĐỊNH KHÔNG ĐỊNH HƯỚNG" trong CSS cho 2 nút
- [x] 4 bài học luôn hiển thị trong summary dù chọn nhánh nào
- [x] Cờ debug: skip=intro/game/decision/summary-open/summary-closed/outro-open/outro-closed
- [x] **Tách module `door-puzzle.js`** (UMD wrapper) — pattern giống level1/safety-catch.js

---

## 10. Video Assets (Cần tạo)

> ✅ Các video đã có trong `video/level2/` (MP4 720p + HLS). Tên gốc tiếng Việt nằm ở `video-src/level2/`:

| File | Mô tả | Thời lượng | Nhánh |
|---|---|---|---|
| `intro.mp4` | Video mở đầu Level 2: người bạn mới làm quen online | ~30s | — |
| `bad.mp4` | Hậu quả mở cửa (tin người lạ) | ~45s | `open` |
| `good.mp4` | Hậu quả giữ đóng (cẩn thận) | ~45s | `closed` |

### Đường dẫn tìm kiếm video (fallback order):

```javascript
VIDEO_PATHS = {
    intro: [
        '../video/level 2/intro.mp4',
        '../../video/level 2/intro.mp4',
        'video/level 2/intro.mp4',
        '/video/level 2/intro.mp4'
    ],
    bad: [
        '../video/level 2/bad.mp4',
        '../../video/level 2/bad.mp4',
        'video/level 2/bad.mp4',
        '/video/level 2/bad.mp4'
    ],
    good: [
        '../video/level 2/good.mp4',
        '../../video/level 2/good.mp4',
        'video/level 2/good.mp4',
        '/video/level 2/good.mp4'
    ]
}
```

---

## 11. Hướng dẫn test nhanh

### Test từng stage:

1. **Test Stage Intro (Video)**: Mở `level2.html` → Click BẮT ĐẦU
2. **Test Stage Game (Door Puzzle)**: Thêm `?skip=game` vào URL
3. **Test Decision Screen**: Thêm `?skip=decision`
4. **Test Summary Open**: Thêm `?skip=summary-open`
5. **Test Summary Closed**: Thêm `?skip=summary-closed`
6. **Test Outro Open**: Thêm `?skip=outro-open`
7. **Test Outro Closed**: Thêm `?skip=outro-closed`

### Test mini-game:

1. Kéo mảnh 🔒 (Mật khẩu riêng tư) vào slot 🔒 (Ổ khóa riêng tư) → phải snap + glow xanh
2. Kéo mảnh 🔓 (Mật khẩu tạm thời) vào slot 🔒 → phải shake + bay về
3. Kéo đúng 3 mảnh → phải thấy confetti + victory overlay
4. Click 🔒 GIỮ CỬA ĐÓNG → phải chuyển sang video good.mp4 hoặc fallback scene

---

*Document version: 1.0 | Last updated: 2026-10-06*
