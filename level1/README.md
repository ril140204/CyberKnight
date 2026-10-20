# CyberKnight – Level 1: Lớp Trưởng Gửi Link Nhận Quà ("Lưới Lọc An Toàn" — Safety Catch)

> Tài liệu kỹ thuật chi tiết dành cho Developer / AI khác tiếp tục phát triển và tích hợp Level 1 vào hệ thống CyberKnight / Sigmabloom.

---

## 1. Architecture & Luồng Chuyển Cảnh

Level 1 là một trải nghiệm tương tác 4 stages nối tiếp, liền mạch, full viewport với hệ thống **3 nhánh kết quả rẽ nhánh cân bằng**:

```
┌──────────────────────┐    crossfade     ┌────────────────────────┐    crossfade    ┌──────────────────────────┐
│ STAGE 1              │   freeze-frame   │ STAGE 2                │   action snap   │ STAGE 3                  │
│ Video mở đầu         │ ───────────────► │ MINI-GAME              │ ──────────────► │ Video hậu quả            │
│ "intro.mp4"          │   500ms ease-in  │ "Lưới Lọc An Toàn"     │   500ms ease    │ (Rẽ 3 nhánh độc lập):    │
│ (Tình huống chat lớp)│                  │ (Phân loại vật phẩm)   │                 │ • A: "bad.mp4" (Xấu)     │
└──────────────────────┘                  └────────────────────────┘                 │ • B: "middle.mp4" (Trung)│
                                                                                     │ • C: "good.mp4" (Tốt)    │
                                                                                     └──────────────────────────┘
                                                                                                   │
                                                                                                   │ video ended
                                                                                                   ▼
                                                                                           ┌──────────────────────┐
                                                                                           │ STAGE 4              │
                                                                                           │ SUMMARY CARD         │
                                                                                           │ • Nhánh A: +10 XP    │
                                                                                           │ • Nhánh B: +25 XP    │
                                                                                           │ • Nhánh C: +40 XP    │
                                                                                           │ 3 Kỹ năng cốt lõi    │
                                                                                           └──────────────────────┘
```

### 1.1 Nguyên tắc cốt lõi
- **Không bao giờ để màn hình đen giữa các stage:** Mọi chuyển cảnh đều dùng **Freeze-Frame Crossfade**: chụp khung hình của thẻ `<video>` hoặc giao diện game lên `<canvas id="freeze-canvas">`, bật `opacity: 1`, đợi 60ms cho DOM chuyển đổi ngầm ổn định, rồi fade out freeze-frame canvas (120ms).
- **Video qua `CKVideo` (`/assets/video-loader.js`):** HLS thích ứng (hls.js, 360p/480p/720p theo băng thông) → HLS native (Safari) → MP4 720p. 3 nhánh hậu quả chỉ được **prefetch playlist** (không tải segment) để không tranh băng thông với intro; `tryLoadWithFallback` resolve ngay khi có metadata (timeout 45s) thay vì chờ tải cả file.
- **Dừng triệt để video & audio (`stopAllVideos()`):** Khắc phục lỗi trùng tiếng ở Level 0 bằng cách gọi hàm `stopAllVideos()` tại mọi điểm chuyển stage và khi bấm "Chơi lại", dừng toàn bộ `<video>` đang chạy và đặt lại `currentTime = 0`.
- **Synthesized Audio (`AudioSynth`):** Tích hợp bộ phát âm thanh Web Audio API tự động tổng hợp sóng âm cho tiếng tick, ting bắt đúng (tăng cao độ theo combo), bụp nhẹ khi bắt sai, còi cảnh báo siren, glitch explosion (Nhánh A), thoughtful chord (Nhánh B) và victory arpeggio (Nhánh C) — hoạt động 100% offline, không phụ thuộc file mp3 rời.
- **Chống vỡ nét video 720p:** Sử dụng container chuẩn tỷ lệ 16:9 (`max-width: 1280px; max-height: 720px; aspect-ratio: 16/9;`) kết hợp thuộc tính `object-fit: contain` và nền mờ khuếch tán **Ambient Blurred Backdrop**, giữ độ sắc nét nguyên bản trên màn hình 1080p, 2K và 4K.
- **Thanh điều khiển góc trên bên phải đồng nhất (`.level1-top-bar`):** Gom nút "BỎ QUA ⏩" và nút "THOÁT" vào 1 flex container cố định với `gap: 14px`, loại bỏ hiện tượng đè nút ở mọi độ phân giải.

---

## 2. Cấu trúc File (File Map)

```
EXEWEB/
├── video/
│   └── level1/
│       ├── intro.mp4, bad.mp4, middle.mp4, good.mp4      (720p ~1.2 Mbps — fallback)
│       └── hls/{intro,bad,middle,good}/master.m3u8       (HLS 720p/480p/360p)
│       (nguồn gốc: video-src/level1/, encode bằng scripts/encode-videos.sh)
├── level0/
│   ├── level0.html
│   ├── level0.css
│   ├── level0.js
│   └── README.md
└── level1/
    ├── level1.html            ← DOM 4 stages, Safety Catch Container & 3 Decision buttons
    ├── level1.css             ← Đồng bộ Design Tokens, Arena, Baskets, Item Sway & Animations
    ├── safety-catch.js        ← Modular Data-Driven Engine cho game hứng & phân loại vật phẩm
    ├── level1.js              ← State machine, Web Audio synth, Freeze-Frame & 3 Branches
    └── README.md              ← File tài liệu kỹ thuật này
```

---

## 3. Cơ chế Mini-game "Lưới Lọc An Toàn" (Safety Catch — Stage 2)

### 3.1 Mục tiêu sư phạm & Thiết kế tương tác
Khác biệt hoàn toàn với Level 0 (kính lúp cạo lớp bọc tĩnh), Stage 2 Level 1 áp dụng cơ chế **vận động phản xạ nhanh**:
- Các vật phẩm mô phỏng tin nhắn, link và lời mời xuất hiện từ trên và rơi xuống tự nhiên kết hợp chuyển động lắc lư hình sin (`Sine-Wave Horizontal Sway`).
- Trẻ tương tác phân loại các vật phẩm này vào 2 chiếc giỏ ở hai bên đáy:
  - 🛡️ **Giỏ Trái: "AN TOÀN – GIỮ LẠI"** (Màu xanh lá `#22C55E`)
  - 🛑 **Giỏ Phải: "DỪNG LẠI – KHÔNG LÀM"** (Màu đỏ `#FF3366`)

### 3.2 Bảng 8 vật phẩm huấn luyện phân loại (Item Matrix)

| ID | Icon | Nội dung vật phẩm | Giỏ hứng đúng | Nhận diện sư phạm |
|:--:|:----:|---|:-------------:|---|
| 1 | 🔗 | Link quà tặng lạ, chưa rõ nguồn | 🛑 **Phải (Dừng lại)** | Nguy cơ phishing, mã độc đánh cắp tài khoản |
| 2 | 📚 | Tin nhắn hỏi bài tập từ bạn cùng lớp | 🛡️ **Trái (An toàn)** | Tương tác học tập lành mạnh, quen thuộc |
| 3 | 🏠 | Yêu cầu điền địa chỉ nhà để nhận quà | 🛑 **Phải (Dừng lại)** | Thu thập dữ liệu cá nhân, nguy cơ rò rỉ nơi ở |
| 4 | 📷 | Ảnh cả lớp chụp buổi dã ngoại | 🛡️ **Trái (An toàn)** | Kỷ niệm nhóm lớp, tệp tin an toàn |
| 5 | ⏰ | Tin nhắn thúc giục "Nhanh lên, chỉ hôm nay thôi!" | 🛑 **Phải (Dừng lại)** | Tâm lý gấp gáp (FOMO/Urgency), bẫy clickbait |
| 6 | 👩‍🏫 | Thông báo bài tập về nhà từ cô giáo | 🛡️ **Trái (An toàn)** | Kênh thông tin chính thống từ nhà trường |
| 7 | 🌐 | Trang web lạ không phải của trường | 🛑 **Phải (Dừng lại)** | Tên miền giả mạo, lệch ký tự |
| 8 | 🎮 | Lời mời chơi game cùng nhóm lớp | 🛡️ **Trái (An toàn)** | Lời mời giải trí thông thường |

### 3.3 Hệ thống phản hồi tích cực & Không gây nản (Positive Reinforcement)
- **Khi bắt đúng:**
  - Giỏ tương ứng nảy nhẹ (`basket-bounce-anim`).
  - Hạt particle burst màu xanh/đỏ nổ tung từ vị trí rơi.
  - Điểm số tăng +1, Combo tăng (`x2`, `x3`, `x4`...) kèm huy hiệu lửa nhấp nháy.
  - Tiếng ting chuông thanh thoát tăng dần cao độ theo cấp độ combo.
- **Khi bắt sai:**
  - Không trừ mạng, không "GAME OVER", không xuất hiện chữ "SAI!" tiêu cực.
  - Khung chơi rung nhẹ (`sc-screen-shake`), giỏ chớp đỏ 2 nhịp dịu dàng.
  - Âm "bụp" trầm nhẹ nhàng, combo trở về 0 để trẻ cố gắng ở lần tiếp theo.
- **Vật phẩm rơi chạm đáy (Missed):**
  - Tự động mờ dần và biến mất, xem như sự bỏ lỡ trung lập không phạt điểm.

### 3.4 Đa dạng phương thức điều khiển (Accessibility)
1. **Chuột:** Nhấp giữ kéo vật phẩm sang trái hoặc phải rồi thả vào giỏ.
2. **Cảm ứng (Touchscreen / Tablet):** Chạm và vuốt mượt mà trên điện thoại/iPad.
3. **Bàn phím PC:** Nhấn phím mũi tên Trái (`ArrowLeft`) hoặc `A` để đưa vật phẩm gần đáy nhất vào giỏ An toàn; nhấn phím mũi tên Phải (`ArrowRight`) hoặc `D` để đưa vào giỏ Dừng lại.
4. **Nút "TỰ QUYẾT ĐỊNH ⏩":** Cho phép học sinh có thể bỏ qua mini-game bất cứ lúc nào để chuyển ngay sang màn hình quyết định.

### 3.5 Card khích lệ cuối trận & Chuyển cảnh 3 Quyết định
- Sau khi kết thúc 28 giây, màn hình hiển thị Card khích lệ ngắn (1.8 giây) tổng kết số vật phẩm bắt đúng và chuỗi combo cao nhất.
- Sau 1.8 giây, game dùng **Freeze-Frame Crossfade** tự động chuyển sang Màn hình 3 Quyết định.
- **Tính độc lập trung lập:** Kết quả điểm số của mini-game hoàn toàn không can thiệp hay ép buộc lựa chọn ở 3 nhánh tiếp theo.

### 3.6 Bảng so sánh 3 Lựa chọn Quyết định (3 Branches)

| Lựa chọn | Hành động của người chơi | Video hậu quả | Phần thưởng | Huy hiệu đạt được |
|---|---|---|---|---|
| **🔴 Nhánh A (Xấu)** | Bấm link và điền địa chỉ nhà ngay lập tức | `bad.mp4` | ⭐ +10 XP | 📚 **Người Mới Học** |
| **🟡 Nhánh B (Trung gian)** | Hỏi lớp trưởng xem link này lấy từ đâu | `middle.mp4` | ⭐ +25 XP | 🤔 **Người Hỏi Thông Minh** |
| **🟢 Nhánh C (Tốt)** | Không bấm link, hỏi bố mẹ hoặc cô giáo trước | `good.mp4` | ⭐ +40 XP | 🏆 **LINK GUARDIAN** |

> **Nguyên tắc quyết định không định hướng:**
> 3 nút A / B / C có kích thước, font chữ, độ nổi bật và vị trí hoàn toàn bình đẳng. Tuyệt đối không áp dụng hiệu ứng pulse/glow hay viền màu thiên vị cho nút "đúng" để trẻ rèn luyện tư duy phản biện độc lập.

---

## 4. Tích hợp & Sự kiện Hoàn thành

### 4.1 Mở độc lập trên trình duyệt
```
http://localhost:5000/level1/level1.html
```

### 4.2 Nhúng vào ứng dụng web / Iframe
```html
<iframe src="/level1/level1.html" allow="autoplay" style="width:100vw; height:100vh; border:0;"></iframe>
```

### 4.3 Lắng nghe sự kiện hoàn thành (`level1:complete`)
Khi người chơi kết thúc video hậu quả và chuyển đến màn hình Tổng kết (Stage 4), ứng dụng phát ra `CustomEvent`:
```javascript
window.addEventListener('level1:complete', (event) => {
    console.log('Level 1 hoàn tất!');
    console.log('Nhánh lựa chọn:', event.detail.path); // 'A' | 'B' | 'C'
    console.log('Điểm kinh nghiệm:', event.detail.xp);   // 10 | 25 | 40
    console.log('Huy hiệu:', event.detail.badge);        // 'Người Mới Học' | 'Người Hỏi Thông Minh' | 'LINK GUARDIAN'
    
    // Gửi kết quả lên server cập nhật tiến trình học sinh:
    // fetch('/api/user/progress', { method: 'POST', body: JSON.stringify(event.detail) });
});
```

### 4.4 Các cờ Debug URL để kiểm thử nhanh
- `?skip=intro` hoặc `?skip=game` hoặc `?skip=catchgame`: Bỏ qua video mở đầu, vào thẳng mini-game "Lưới Lọc An Toàn".
- `?skip=decision`: Vào thẳng màn hình 3 nút quyết định A / B / C sau mini-game.
- `?skip=summary-A`: Xem trực tiếp màn hình tổng kết Nhánh A (+10 XP, "Người Mới Học").
- `?skip=summary-B`: Xem trực tiếp màn hình tổng kết Nhánh B (+25 XP, "Người Hỏi Thông Minh").
- `?skip=summary-C`: Xem trực tiếp màn hình tổng kết Nhánh C (+40 XP, "LINK GUARDIAN").

---

## 5. Rút kinh nghiệm & Cải tiến kỹ thuật kế thừa từ Level 0

1. **Khắc phục trùng lặp cơ chế với Level 0:** Level 0 sử dụng kính lúp tĩnh cạo lớp phủ. Level 1 đổi mới 100% bằng mini-game hứng/phân loại vật phẩm động "Lưới Lọc An Toàn", tạo sự hào hứng cho học sinh.
2. **Khắc phục lỗi vỡ nét video khi toàn màn hình:** Sử dụng khung tỷ lệ 16:9 (`max-width: 1280px; max-height: 720px;`) kết hợp `object-fit: contain` và nền mờ khuếch tán (Ambient Backdrop).
3. **Khắc phục lỗi chồng nút điều khiển:** Tích hợp thanh điều khiển đồng nhất `#level1-top-bar` bằng flexbox góc trên bên phải, có khoảng cách cố định `gap: 14px`.
4. **Khắc phục lỗi chồng tiếng âm thanh khi chơi lại:** Xây dựng hàm `stopAllVideos()` dừng toàn bộ thẻ video trước khi phát bất kỳ video mới nào hoặc khi reset màn chơi.
5. **Chuẩn hóa tên file video:** chỉ dùng tên ASCII (`intro`, `bad`, `middle`, `good`) — HLS `/video/level1/hls/<name>/master.m3u8` + MP4 `/video/level1/<name>.mp4`.
