# Level 5: "Thật Hay Giả? Đống Ảnh AI" — CyberKnight/Sigmabloom

> Tài liệu kỹ thuật cho Level 5: Video giới thiệu → Một câu hỏi nhận biết ảnh AI → Tổng kết.
> Thời lượng ~1 phút 15 giây · Video chính ~1m15s (45s + 30s + 30s) · XP tối đa 30 · Huy hiệu THÁM TỬ SOI ẢNH AI.

---

## 1. Cấu trúc file

```
level5/
├── level5.html            # Markup: 3 stage video, stage-photo, result overlay, summary
├── level5.css             # Tokens + z-index + stage/overlay/result/summary + ph-* + ps-* + ai-*
├── level5.js              # Controller: SCENE_FLOW, state machine, video, magnifier, 1 câu hỏi, summary, debug flags
└── README.md              # File này
```

> Level 5 là **một câu hỏi duy nhất** — đã lược bỏ toàn bộ hotspot photofind, PhotoBoard,
> mini cover effect và mission mini-game của Level 4. Không có `photo-scenes.js` / `photo-board.js`.

---

## 2. Video/asset files

Thư mục asset thật **có khoảng trắng**: `video/level 5/`.

| Loại | Tên file thật | Đuôi |
|------|---------------|------|
| Ảnh | `anh_AI.jpg` (1376×768, 16:9) | `.jpg` |
| Video giới thiệu | `intro.mp4` (~45s, có tiếng) | `.mp4` |
| Video đúng | `good.mp4` (~30s, có tiếng) | `.mp4` |
| Video sai | `bad.mp4` (~30s, có tiếng) | `.mp4` |

**Thứ tự dò thư mục** (`ResourceSource.baseIdx` — cache dùng chung cho CẢ video lẫn ảnh):

| # | Thư mục | Ghi chú |
|---|---------|---------|
| 1 | `../video/level 5/` | ← **vị trí thật** (có khoảng trắng) |
| 2 | `../video/level5/` | fallback không khoảng trắng |
| 3 | `video/level5/` | fallback khi nhúng trong thư mục khác |
| 4 | `./` | fallback cuối |

**Thứ tự dò đuôi file:**

| Loại | Thứ tự |
|------|--------|
| Video | `.mp4` → `.webm` → `.mov` |
| Ảnh | `.jpg` → `.jpeg` → `.png` → `.webp` → `.jfif` → `.avif` → `.gif` |

> `.jpg` đứng đầu vì đó là **đuôi thật** của `anh_AI.jpg` (đã kiểm chứng bằng
> `Get-ChildItem` và bằng phản hồi thật `Content-Type: image/jpeg`).

Kết quả dò được (đã kiểm chứng trên server thật): `baseIdx = 0` (`../video/level 5/`),
`videoExt = .mp4`, `imageExt = .jpg`. Mọi URL được dựng qua `encodeURI()` vì thư mục
chứa khoảng trắng (ví dụ `../video/level%205/anh_AI.jpg`).

> Cơ chế dò: ảnh dùng `fetch` + `Range: bytes=0-0` **và bắt buộc kiểm `Content-Type`
> bắt đầu bằng `image/`** — xem mục 12. Trên `file://` fallback sang `<img onload>`
> kèm kiểm `naturalWidth > 0`; video dùng `<video preload="metadata">` kèm kiểm
> `videoWidth > 0`. Bộ đệm `_probePromise` đảm bảo chỉ dò 1 lần cho cả phiên; cache
> `baseIdx` / `imageExt` / `videoExt` **được giữ lại** khi bấm "Chơi lại".

---

## 3. Luồng State Machine (SCENE_FLOW)

```js
const SCENE_FLOW = {
  intro: { question: 'detect' },      // → stage-photo
  good:  { next: 'summary' },         // → SUMMARY
  bad:   { question: 'detect-retry' }  // → màn kết quả sai
};
const VIDEO_SCENES = ['intro', 'good', 'bad'];
const ALL_STAGES = ['intro', 'photo', 'good', 'bad', 'summary'];
```

```
START
 → intro (45s) ──────────────────────────────► [CÂU HỎI: ẢNH GIẢ DO AI VẼ / ẢNH THẬT 100%]
                                                     │
                             ┌──── chọn 🔴 đúng ────┴──── chọn 🟢 sai ────┐
                             ▼                                             ▼
                        hiệu ứng đúng                            hiệu ứng sai
                       (0.8s, mint)                              (0.6s, cam)
                             ▼                                             ▼
                          good (30s)                                   bad (30s)
                             ▼                                             ▼
                        ★ SUMMARY ★                              MÀN KẾT QUẢ SAI
                                                        ┌────────────┴────────────┐
                                                   🔄 Thử lại            🎬 Xem lại cảnh giới thiệu
                                                        │                             │
                                                        ▼                             ▼
                                                   [CÂU HỎI]  ───────────────► intro (phát lại)
```

> `good` và `bad` **không phải hai cảnh tuần tự** — chúng được gọi trực tiếp
> (`_playScene('good')` / `_playScene('bad')`) dựa trên đáp án con chọn.
> Không dùng `parseInt + 1` ở bất kỳ đâu.

**Câu hỏi (1 duy nhất) — "Thám Tử Soi Chi Tiết AI"**:
- Badge: `🕵️ THÁM TỬ SOI CHI TIẾT AI`
- Câu hỏi: *"Bút Thử AI đã sẵn sàng! Bức ảnh mèo biết bay này là ảnh thật hay ảnh do AI vẽ?"*
- Ảnh `anh_AI.jpg` trong khung polaroid, caption *"Ảnh bạn Gấu gửi cho Sóc"*
- 2 nút trả lời **bằng nhau về kích thước và màu sắc** (trung tính, không tiết lộ đáp án)
- 🔶 **Bíp 🤖** (`.ph-bip` cố định) + nút `💡 Gợi ý`
- 🔍 **Bút Thử AI** (kính lúp) — bật/tắt, chạm vào ảnh để phóng to 2.5×

**Màn kết quả sai** (sau `bad.mp4`): icon `🔎` · *"Khoan đã, soi kỹ lại nào!"* ·
2 nút `🔄 Thử lại` / `🎬 Xem lại cảnh giới thiệu` · **không bao giờ nói thẳng đáp án đúng** ·
**không tự động qua level**.

---

## 4. Debug Flags

| URL Param | Hành vi |
|-----------|---------|
| `?skip=intro` | Nhảy thẳng tới stage video `intro.mp4` (bỏ start overlay) |
| `?skip=q1` | Nhảy thẳng tới màn câu hỏi (`stage-photo`), ảnh + 2 nút trả lời |
| `?skip=good` | Nhảy thẳng tới stage video `good.mp4` |
| `?skip=bad` | Nhảy thẳng tới stage video `bad.mp4` |
| `?skip=result-wrong` | Mở màn câu hỏi, **tự chọn 🟢**, rồi hiện thẳng màn kết quả sai (không phát video `bad`) |
| `?skip=summary-first` | Summary 3⭐, 30 XP, recap "✅ đúng ngay lần đầu" |
| `?skip=summary-retry` | Summary 2⭐, 20 XP, recap "🔁 lúc đầu chọn 'ẢNH THẬT 100%'…" |
| `?skip=summary` | Summary mặc định — đúng lần đầu (3⭐, 30 XP) |
| `?debug=1` | Hiện URL tuyệt đối đã thử trong error panel của **video** và **ảnh** |

> Mọi flag `?skip=…` đều ẩn start overlay và reset state trước khi nhảy.

---

## 5. CSS Z-Index Scale

```css
--z-stage: 10;
--z-stage-active: 20;
--z-freeze: 50;
--z-overlay: 60;     /* start overlay + result overlay */
--z-topbar: 9999;   /* THOÁT + BỎ QUA */
```

| Stage / lớp | Z-Index | Source |
|-------------|---------|--------|
| `stage-intro`, `stage-good`, `stage-bad`, `stage-photo`, `stage-summary` | 10 (inactive) / 20 (active) | `.stage`, `.stage.active` |
| `freeze-canvas` | 50 | `--z-freeze` |
| `particle-canvas` | 5 | `.particle-canvas` |
| `start-overlay`, `result-overlay` | 60 | `--z-overlay` |
| `level5-top-bar`, `btn-skip-video` | 9999 | `--z-topbar` |

> `stage-summary` chủ động ẩn `freeze-canvas` + `particle-canvas` để không che nút hành động.

---

## 6. AudioSynth Methods

Tất cả method đều guard `if (!this.ctx) return;` → chạy an toàn khi không có AudioContext.
`window.sound` được export để debug.

| Method | Mô tả | Dùng ở |
|--------|-------|---------|
| `playTick` | Click nhẹ (Sine 800→400Hz, 50ms) | Mọi nút bấm |
| `playCorrectCatch` | Ting tăng (C5→G5, 280ms) | Chọn 🔴 đúng |
| `playIncorrectCatch` | Bụp nhẹ (Triangle 220→110Hz) | Chọn 🟢 sai |
| `playSoftBip` | Bíp nhẹ (Sine 660Hz, 120ms) | Gợi ý + màn kết quả sai (tone *soft*, không harsh) |
| `playVictoryChime` | Hợp âm chiến thắng (C-E-G-C) | Màn summary |
| `photoSnap` | Tiếng "Tách!" máy ảnh (Square 2200→900Hz, 50ms) | Ảnh xuất hiện ở màn câu hỏi |
| `magnify` | Âm quét kính lúp (Sine 400↔900Hz, 850ms) | Bật Bút Thử AI |

> Level 4 có thêm `playGlitchExplosion` / `coverStick` — Level 5 **không dùng** nên đã bỏ.

---

## 7. Summary Blocks (6 khối)

| Block | Nội dung |
|-------|---------|
| 1 | Logo CyberKnight + icon `🕵️` + `LEVEL 5 COMPLETED!` + sao + reward box (`⭐ +XP XP`, `🏅 THÁM TỪ SOI ẢNH AI`) |
| 2 | **Message**: *"AI vẽ ảnh rất đẹp nhưng hay sai ở những chi tiết nhỏ. Soi kỹ – Kiểm tra – Hỏi người lớn rồi mới tin nhé!"* |
| 3 | `NHỚ NHANH: SOI – KIỂM – HỎI` — 3 thẻ: 🔍 SOI · ✅ KIỂM · 👨‍👩‍👧 HỎI |
| 4 | `3 DẤU HIỆU ẢNH DO AI VẼ` — 3 hàng: 🐾 Tay/chân/ngón thừa hoặc thiếu · 🔤 Chữ bị nhòe, méo · 🌈 Quá hoàn hảo hoặc vô lý |
| 5 | `HÀNH TRÌNH CỦA CON` — 1 thẻ recap cho mini-game "Thám Tử Soi Chi Tiết AI" (`✅` / `🔁`) |
| 6 | Tip + disclaimer + `🔄 Chơi lại` / `Tiếp tục hành trình ▶` |

**CustomEvent**: `level5:complete` → `{ answers, stars, xp, badge }`
(`badge` = hằng số `BADGE_NAME = 'THÁM TỬ SOI ẢNH AI'`).

---

## 8. Star Rating Logic

`slips` = số lần chọn sai **trước** lần chọn đúng.

| Slips | Stars |
|-------|-------|
| 0 | ⭐⭐⭐ |
| 1 | ⭐⭐ |
| ≥ 2 | ⭐ |

> **Không bao giờ 0 sao.** `slips` đếm từ `level5State.question.history` (mảng `'fake' | 'real'`).

---

## 9. XP Calculation (max 30)

| Điều kiện | XP |
|-----------|-----|
| Đúng ngay lần đầu (slips = 0) | 30 |
| Đúng sau 1 lần sai (slips = 1) | 20 |
| Đúng sau ≥ 2 lần sai | 10 |

**Tối đa: 30 XP** — giữ đúng trần của Level 4.

---

## 10. API / component notes — "Bút Thử AI" (kính lúp)

Thành phần duy nhất mới của Level 5, nằm gọn trong `level5.js`:

| Hàm | Vai trò |
|-----|---------|
| `_setMagnifyMode(on, playSound)` | Bật/tắt chế độ kính lúp; set `aria-pressed` trên nút, class `ai-zoom-active` trên khung, phát `sound.magnify()` khi bật |
| `_setZoom(on)` | Bật/tắt class `ai-zoomed` (CSS `transform: scale(2.5)`) trên `<img id="ai-image">` |
| `_zoomToPoint(clientX, clientY)` | Tính `transform-origin` theo toạ độ chạm (%), tính trên `getBoundingClientRect()` của **khung** (không phải của `<img>`, vì khi đang zoom rect của `<img>` đã bị scale → toạ độ lệch) |
| `_wireMagnifier()` | Gắn listener `click` trên nút bật/tắt và trên khung ảnh |

**Hành vi**:
- Chạm vào ảnh khi đang BẬT → phóng to 2.5× tâm tại điểm chạm.
- Chạm lần nữa (hoặc bấm lại nút) → thu về 1×.
- Dùng sự kiện `click` → hoạt động giống nhau với **chuột** và **cảm ứng**; không có drag-and-drop.
- `prefers-reduced-motion: reduce` → giữ nguyên hiệu ứng phóng to, chỉ tắt `transition` mượt.

**Class CSS dùng riêng cho Level 5** (tiền tố `ai-`):
`ai-container` · `ai-tool-row` · `ai-magnify-btn` · `ai-hint-btn` · `ai-zoom-frame` · `ai-zoom-img` ·
`ai-zoom-active` · `ai-zoomed` · `ai-image-error*` · `ai-bip` · `ai-bip-hint` · `ai-answer-row` ·
`ai-answer-btn` (+ `ai-selected-correct` / `ai-selected-wrong`) · `ai-result-overlay` · `ai-result-card`.

> Các class dùng chung với Level 4 được tái sử dụng nguyên xi (vì Level 5 là stylesheet riêng):
> `ph-polaroid` · `ph-frame` · `ph-bip` · `ph-caption` · `ph-mission-badge` · `ph-mission-title` ·
> `ps-formula-card` · `ps-leak-row` · `choice-recap-item` · `result-screen` · `summary-card` ·
> `floating-sparkle` · `cyber-grid` · `deco-blob` · `character-logo-left` · `brand-logo-right`.

---

## 11. Mini-game / module dùng chung

**Không có.**

Level 5 không dùng `PhotoBoard`, `PhotoScenes`, `key-audit` hay bất kỳ module mini-game nào.
Toàn bộ logic nằm trong `level5.js` (self-contained), không phụ thuộc file JS ngoài nào
ngoài Google Fonts + canvas-confetti CDN.

---

## 12. Key Design Decisions

1. **SCENE_FLOW table** (không `parseInt + 1`): `good` và `bad` là hai nhánh song song
   được gọi trực tiếp theo đáp án, không phải hai cảnh kế tiếp nhau.
2. **Một câu hỏi duy nhất** — đơn giản hoá từ Level 4 (đã bỏ photofind, Q2, Q3, mission).
   Toàn bộ giá trị giáo dục nằm ở công cụ Bút Thử AI + 2 nút so sánh trung tính.
3. **Hai nút trả lời hoàn toàn trung tính**: cùng kích thước (`flex: 1 1 0`), cùng gradient
   nền, cùng màu viền, cùng màu chữ. Emoji 🔴/🟢 chỉ là **icon**, **không tô màu trước**
   (tô trước sẽ làm lộ đáp án). Màu chỉ xuất hiện **sau** khi con chọn:
   mint/green nếu đúng, cam nhạt nếu sai.
4. **Chọn sai KHÔNG lộ đáp án**: chỉ nút con vừa bấm được tô; nút còn lại giữ nguyên trạng thái
   trung tính (kể cả nút đúng). Màn kết quả sai cũng chỉ gợi ý, không nói thẳng.
5. **"Thử lại" giữ màu cam** của nút con đã chọn sai (để con nhớ) nhưng **không reset
   `firstChoice`/`history`** — cần thiết cho phần tính sao và phần recap ở summary.
6. **Không tự động qua level khi trượt**: sau `bad.mp4` chỉ có 2 lựa chọn (thử lại / xem lại
   cảnh giới thiệu). Không có đường tắt nào sang summary khi trượt.
7. **Cờ `_sceneEnded` chống kết thúc scene trùng**: nếu không có, việc bấm "BỎ QUA" khi
   video chưa sẵn sàng seek có thể làm handler `ended` bắn lần 2 → chạy lại luồng →
   tính sai sao/XP. Đồng thời `_playScene` dừng & gỡ handler của mọi video khác để tránh
   "nói chồng" giữa các cảnh.
8. **`ResourceSource` dùng chung baseIdx cho video lẫn ảnh**: chỉ dò 1 lần cho cả phiên,
   giữ cache khi bấm "Chơi lại".
9. **`encodeURI()` mọi URL**: thư mục asset thật có khoảng trắng (`level 5`).
10. **Video CÓ TIẾNG — không bao giờ ép `muted`**: nếu autoplay bị chặn, hiện overlay
    `▶ BẤM ĐỂ XEM TIẾP` để con bấm (giữ nguyên audio).
11. **Lưới an toàn cho nút BỎ QUA**: nếu seek chưa xong sau 1.5s, tự kết thúc scene
    (cờ `endedTriggered` chống gọi trùng).
12. **Error panel video luôn nhìn thấy được**: nếu video lỗi phát sinh **trước** khi stage
    được kích hoạt (ví dụ `_playScene` return sớn vì không dò thấy file), error panel sẽ
    nằm trong một stage không có class `active` → trống màn hình. `_showVideoErrorPanel()`
    tự ép `switchStage(stageId)` + `TopBar.updateVisibility(stageId)` trước khi vẽ panel.
13. **A11y**: mọi nút có `aria-label`; nút kính lúp có `aria-pressed`; khung ảnh có
    `role="group"`; focus ring `outline: 3px solid var(--ck-blue-500)`; hỗ trợ
    `prefers-reduced-motion` cho **mọi** animation.
14. **Touch-first**: mọi thao tác là chạm/click; vùng chạm tối thiểu 44×44px;
    2 nút trả lời bị khoá ngay sau lần chạm đầu (chống double-fire).
15. **Không dùng `localStorage`**, không thêm thư viện ngoài Google Fonts + canvas-confetti.
16. **Ngôn ngữ**: UI gọi trẻ là **"con"**; video dùng **"Bé"** (không chép lời thoại
    video vào UI).

---

## 13. Quyết định thiết kế (khi đặc tả mơ hồ)

- **"Chọn sai KHÔNG lộ đáp án" nhưng emoji lại là 🔴/🟢**: đặc tả yêu cầu đúng nút là
  `🔴 ẢNH GIẢ DO AI VẼ` và `🟢 ẢNH THẬT 100%`, đồng thời cấm tô màu trước. Tôi giữ nguyên
  emoji nhưng **không tô màu chúng** (chúng dùng `color` chung của nút) → không rò đáp án.
  Màu xanh/cam chỉ xuất hiện sau khi con đã chọn.
- **Thứ tự 2 nút**: đặc tả liệt kê `🔴 ẢNH GIẢ DO AI VẼ` trước `🟢 ẢNH THẬT 100%` → tô giữ
  đúng thứ tự đó (nút "giả" bên trái).
- **"Bấm lần nữa hoặc bấm nút để thu nhỏ"**: khi đang zoom, chạm vào ảnh sẽ **thu nhỏ**
  (toggle), bấm nút `🔍 Bút Thử AI` cũng tắt chế độ kính lúp và thu nhỏ. Cả hai đều dùng
  chung cờ `level5State.zoomed` nên không xung đột.
- **`transform-origin` tính trên khung hay trên ảnh**: tính trên **khung** (`.ai-zoom-frame`),
  vì `<img>` dùng `object-fit: contain` nên khi đang scale, `getBoundingClientRect()` của
  `<img>` đã bị biến đổi → tính toạ độ trên `<img>` sẽ bị lệch dần.
- **Gợi ý tự động "sau ≥1 lần trượt"**: hiện ngay khi con **quay lại** màn câu hỏi sau một
  lần trượt (vì ngay sau khi trượt, màn hình đã chuyển sang video `bad` nên gợi ý không nhìn
  thấy được). Bộ đếm `hintLevel` tách khỏi `hintsUsed` để gợi ý tự động không "ăn" mất
  lượt bấm nút `💡 Gợi ý` của trẻ.
- **`?skip=result-wrong`**: đặc tả ghi *"auto-select 🟢 then show the wrong-result screen"* →
  tôi làm đúng nghĩa đen (chọn 🟢 rồi hiện thẳng màn kết quả sai, **không** phát video
  `bad`) để test nhanh màn hình này. Muốn xem đầy đủ luồng video thì bấm 🟢 trong
  `?skip=q1`.
- **`?skip=summary`**: đặc tả không nói rõ state → tôi dùng mặc định **đúng lần đầu**
  (3⭐, 30 XP), giống `?skip=summary-first`. Muốn xem biến thể sửa sai thì dùng
  `?skip=summary-retry`.
- **Dò đuôi file ảnh bằng `fetch`**: `fetch` + `Range` nhẹ hơn `<img>` (không tải hết file)
  nhưng bị CORS chặn trên `file://` → tôi tự động fallback sang `<img onload>` khi
  `location.protocol === 'file:'`. Việc thử đuôi file không tồn tại sẽ in 1 dòng 404 trong
  Console — **đây là hành vi dò đường dẫn, không phải lỗi JS** (giống Level 4).
- **Hiệu ứng "đúng" 0.8s**: trong 0.8s đó nút đúng được tô mint + phát `playCorrectCatch()`,
  rồi mới chuyển sang `good.mp4`. Hiệu ứng "sai" 0.6s tương tự (cam nhạt + `playIncorrectCatch()`).
- **"Chơi lại" giữ cache asset**: `ResourceSource.baseIdx` / `imageExt` / `videoExt` được giữ
  nguyên (không dò lại) — đúng như Level 4; chỉ `resetAllVideos()` + reset state + clear timer.

---

## 12. Lỗi đã gặp: false-positive khi dò ảnh (SPA fallback trả HTML)

**Triệu chứng**: màn *"Thám Tử Soi Chi Tiết AI"* hiện icon **ảnh vỡ** + alt text +
panel *"Không tải được bức ảnh 😳"*, dù hai nút 🔴/🟢 vẫn bấm được.

**Nguyên nhân gốc**: `backend/src/server.js` có **SPA fallback**:

```js
app.get('*', (req, res) => {
  if (/^\/level\d+/i.test(req.path)) return res.status(404).type('text/plain').send('Not found');
  res.sendFile(path.join(rootDir, 'index.html'));   // ← 200 + text/html cho MỌI URL lạ
});
```

Nên `/video/level%205/anh_AI.png` (file không tồn tại) trả **HTTP 200 + `text/html`**.
Bản `_probeImage` cũ **chỉ kiểm `res.ok || status === 206`**, không kiểm `Content-Type`
→ coi HTML là ảnh hợp lệ → `imageExt = '.png'` → `<img src="...anh_AI.png">` tải ra
HTML → **ảnh vỡ**.

**Bằng chứng** (đo trực tiếp trên server, `curl`):

| URL | Status | Content-Type | Kết luận |
|-----|--------|--------------|-----------|
| `/video/level%205/anh_AI.png` | 200 | `text/html; charset=UTF-8` | ❌ fallback, KHÔNG phải ảnh |
| `/video/level%205/anh_AI.jpg` | 200 | `image/jpeg` | ✅ file thật (119.117 bytes) |
| `/video/level%205/intro.mp4` | 200 | `video/mp4` | ✅ |

**Cách sửa (3 lớp, không đụng tới backend/bảo mật)**:

1. **`_probeImage` (http/https)** — bắt buộc `Content-Type` bắt đầu bằng `image/`:
   ```js
   const statusOk = res.ok || res.status === 206;
   const contentType = res.headers.get('content-type') || '';
   const typeOk = contentType.trim().toLowerCase().startsWith('image/');
   return statusOk && typeOk;   // ← HTML 200 không còn bị coi là ảnh
   ```
2. **`_probeImage` (`file://`)** — `img.onload` phải kiểm `naturalWidth > 0 && naturalHeight > 0`
   (một trang HTML nạp vào `<img>` vẫn có thể fire `onload` với kích thước 0).
3. **`_probeVideo`** — `onloadedmetadata` phải kiểm `videoWidth > 0 && videoHeight > 0`,
   tránh false-positive tương tự cho video.

**Kèm theo (chống tái phát)**:
- `IMAGE_EXTS` đổi thứ tự để **đuôi thật `.jpg` đứng đầu** → giảm request 404 thừa.
- `_tryNextImageCandidate()` — khi `<img>` **hỏng sau khi dò**, tự thử đuôi/thư mục kế tiếp
  trong chuỗi `base × ext`; chỉ hiện panel lỗi khi đã thử hết (trước đây `onerror` báo lỗi ngay).
- Nút *"🔄 Thử lại"* xoá sạch cache (`baseIdx`, `imageExt`, `_probePromise`,
  `_imageProbePromise`, log probe) để dò lại thật sự từ đầu.
- `?debug=1`: panel lỗi in **từng URL tuyệt đối + status + content-type** nhận được.

**Kết quả kiểm chứng** (Chrome headless, đúng luồng thật, có cookie `levelAccess`):
`img.src = ../video/level%205/anh_AI.jpg`, `naturalWidth = 1376`, `naturalHeight = 768`,
`errorPanelVisible = false`, 0 lỗi JS đỏ.

> **Bài học**: dùng `fetch` để dò tài nguyên trên server có SPA fallback thì
> **bắt buộc kiểm `Content-Type`**. Chỉ kiểm HTTP status là không đủ.

---

*Document version: 1.1 | Last updated: 2026-10-22 | Level 5: Thật Hay Giả? Đống Ảnh AI*
