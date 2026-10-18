# Level 4: "Bức Ảnh Có Quá Nhiều Bí Mật" — CyberKnight/Sigmabloom

> Tài liệu kỹ thuật cho Level 4: Video xen kẽ tương tác → Tổng kết.
> Thời lượng 4–5 phút · Video chính 125 giây · XP tối đa 30 · Huy hiệu THÁM TỬ ẢNH AN TOÀN.

---

## 1. Cấu trúc file

```
level4/
├── level4.html            # Markup: 5 scene + reveal, photofind stage, overlay, summary
├── level4.css             # Tokens + z-index + stage/overlay/result/summary + ph-* + ps-*
├── level4.js              # Controller: SCENE_FLOW, state machine, video, photofind, questions, summary, debug flags
├── photo-scenes.js        # 1 SVG inline minh hoạ (main) + toạ độ hotspot
├── photo-board.js         # Class PhotoBoard: ảnh + hotspot dùng cho Q1 photofind
└── README.md              # File này
```

> **Lịch sử**: mini-game "Thám tử tìm bí mật" (PhotoDetectiveGame) đã bị gỡ bỏ vì trùng lặp với Q1 photofind. Nếu cần khôi phục, tham khảo git history.

---

## 2. Video files

Video files can be in any of these folders:

| Folder | Path |
|--------|------|
| Primary | `../video/level4/` |
| Alternate | `../video/level 4/` (note the space) |
| Fallback 1 | `video/level4/` |
| Fallback 2 | `./` |

| Scene | File | After | Next |
|-------|------|-------|------|
| scene1 | `scene1.mp4` | Start button | scene2 |
| scene2 | `scene2.mp4` | scene1 ends | Q1 (photofind) |
| reveal | `reveal.mp4` | Q1 all-found | scene3 |
| scene3 | `scene3.mp4` | reveal ends | Q2 (fix) |
| scene4 | `scene4.mp4` | Q2 fix correct | Q3 (share) |
| scene5 | `scene5.mp4` | Q3 share correct | **SUMMARY** |

> **Lưu ý**: `reveal` là clip 12 giây (CyberKnight lần lượt chỉ balo, thẻ tên, hộp hàng)
> nằm giữa scene2 và scene3 — KHÔNG tính vào 125 giây video chính.

Video path probing order: `../video/level4/` → `../video/level 4/` → `video/level4/` → `./`.  
Base index được cache trong `VideoSource.baseIdx` cho tất cả cảnh về sau (giống Level 3).

---

## 3. Luồng State Machine (SCENE_FLOW)

```js
const SCENE_FLOW = {
  scene1: { next: 'scene2' },
  scene2: { question: 'find' },       // → stage-photofind
  reveal: { next: 'scene3' },
  scene3: { question: 'fix' },         // → interaction overlay
  scene4: { question: 'share' },     // → interaction overlay
  scene5: { next: 'summary' }         // → SUMMARY (mission mini-game removed)
};
const VIDEO_SCENES = ['scene1','scene2','reveal','scene3','scene4','scene5'];
```

```
START
 → scene1 (00:00–00:18) → scene2 (00:18–00:35)
 → [Q1 photofind: tìm 3 thông tin bị lộ]
 → reveal (12s)
 → scene3 (00:35–01:05) → [Q2 fix: A/B/C] ─ B ✔ → scene4
                                                ├ A ✘ → result:fix:A → [retry|replay scene3]
                                                └ C ✘ → result:fix:C → [retry|replay scene3]
 → scene4 (01:05–01:35) → [Q3 share: A/B/C] ─ B ✔ → scene5
                                                    ├ A ✘ → result:share:A → [retry|replay scene4]
                                                    └ C ✘ → result:share:C → [retry|replay scene4]
 → scene5 (01:35–02:05) → **SUMMARY** (direct — no mission mini-game)
```

**Q1 (photofind) — không có màn "sai"**:
- 3 vùng đúng (bag, badge, box) → vòng mint + ✔ + chip thông tin bị lộ
- 1 vùng nhiễu (trophy 🏆) → kính lúp + bip nhắc, không phạt
- Tìm đủ 3 → card "Đúng rồi!" + nút Tiếp tục ▶ → reveal

**Q2 (fix) — A/B/C**:
- A ✘ "Khoan đã, ảnh còn nguyên bí mật!" (warn) → Thử lại / Xem lại cảnh 3
- B ✔ "Đúng rồi!" + mini cover effect (~1.5s) → scene4
- C ✘ "Che mặt rồi, nhưng bí mật vẫn còn đó!" (soft) → Thử lại / Xem lại cảnh 3

**Q3 (share) — A/B/C**:
- A ✘ "Đăng công khai là ai cũng xem được!" (warn) → Thử lại / Xem lại cảnh 4
- B ✔ "Tuyệt!" → scene5
- C ✘ "Người lạ xin ảnh thì rất đáng nghi!" (warn) → Thử lại / Xem lại cảnh 4

**Nội dung Q1 (chạm đúng) — đầy đủ nguyên văn**:
- bag → "Tên trường: TH Ngôi Sao Xanh"
- badge → "Tên và lớp: Bạn Hiệp Sĩ – Lớp 3A"
- box → "Địa chỉ: Số 12 Ngõ Hoa Mai, Phường Cầu Vồng" + "Số điện thoại: 0123 456 789"

---

## 4. Debug Flags

| URL Param | Hành vi |
|-----------|---------|
| `?skip=scene1` … `?skip=scene5` | Nhảy tới cảnh tương ứng |
| `?skip=reveal` | Nhảy tới clip reveal |
| `?skip=q1` | Nhảy tới màn photofind (giả định đã ở scene2) |
| `?skip=q2` | Nhảy tới câu hỏi fix |
| `?skip=q3` | Nhảy tới câu hỏi share |
| `?skip=result-q2-A`, `?skip=result-q2-C` | Câu fix, tự bấm A/C → màn kết quả |
| `?skip=result-q3-A`, `?skip=result-q3-C` | Câu share, tự bấm A/C → màn kết quả |
| `?skip=summary-first` | Summary 3⭐, 30 XP (perfect run) |
| `?skip=summary-retry` | Summary 2⭐ (với retry history) |
| `?skip=summary` | Summary với lựa chọn mặc định |
| `?debug=1` | Hiện URL video tuyệt đối trong error panel |

---

## 5. CSS Z-Index Scale

```css
--z-stage: 10;
--z-stage-active: 20;
--z-freeze: 50;
--z-overlay: 60;     /* questions + result screens + photofind overlay */
--z-topbar: 9999;
```

| Stage | Z-Index | Source |
|-------|---------|--------|
| `stage-scene1`..`stage-scene5`, `stage-reveal` | 10 (inactive) / 20 (active) | `.stage`, `.stage.active` |
| `stage-photofind` | 10/20 | giống stage video |
| `stage-summary` | 10/20 | giống stage video |
| `freeze-canvas` | 50 | `--z-freeze` |
| `interaction-overlay` | 60 | `--z-overlay` |
| `level4-top-bar`, `btn-skip-video` | 9999 | `--z-topbar` |

> **Đã gỡ**: `stage-mission` (PhotoDetectiveGame) không còn trong cây HTML.

---

## 6. AudioSynth Methods

**Kế thừa từ Level 1/2/3** (tất cả an toàn khi AudioContext không có):

| Method | Mô tả |
|--------|-------|
| `playTick` | Click nhẹ (Sine 800→400Hz, 50ms) |
| `playCorrectCatch` | Ting tăng (C5→G5, 280ms) |
| `playIncorrectCatch` | Bụp nhẹ (Triangle 220→110Hz) |
| `playGlitchExplosion` | Nổ glitch (cho warn result) |
| `playVictoryChime` | Hợp âm chiến thắng (C-E-G-C) |
| `playSoftBip` | Bíp nhẹ (Sine 660Hz, 120ms) — dùng cho soft result + gợi ý |

**MỚI Level 4** (mở rộng `window.sound` an toàn):

| Method | Mô tả | Dùng ở |
|--------|-------|--------|
| `photoSnap` | Tiếng "Tách!" máy ảnh (Square 2200→900Hz, 50ms) | Hiện ảnh Q1 |
| `coverStick` | Tiếng "bụp" nhẹ (Triangle 260→180Hz, 120ms) | Mini cover effect Q2 |
| `magnify` | Âm quét kính lúp (Sine 400↔900Hz, 850ms) | Chạm nhiễu Q1 |

---

## 7. Summary Blocks (Part 3)

| Block | Nội dung |
|-------|---------|
| 3.1 | Logo CyberKnight + icon 📸 + "LEVEL 4 COMPLETED!" + sao + reward box (⭐ +XP, 🏅 THÁM TỬ ẢNH AN TOÀN) |
| 3.2 | **Message**: "Một bức ảnh có thể tiết lộ nhiều hơn mình nghĩ. Nhìn kỹ – Che lại – Hỏi bố mẹ rồi mới chia sẻ nhé!" |
| 3.3 | "NHỚ NHANH: NHÌN – CHE – HỎI" — 3 thẻ ngang (👀 NHÌN, 🖍️ CHE, 👨‍👩‍👧 HỎI) |
| 3.4 | "4 THÔNG TIN DỄ BỊ LỘ TRONG ẢNH" — 4 hàng có thẻ tag (🏫 balo/cặp, 📛 thẻ tên, 🏠 hộp/thư, 📞 giấy/hộp) |
| 3.5 | "HÀNH TRÌNH CỦA CON" — recap thẻ cho Q1, Q2, Q3 (✅/🔁) |
| 3.6 | Tip "Lỡ đăng ảnh có bí mật rồi?" + disclaimer hư cấu + 🔄 Chơi lại / Tiếp tục hành trình ▶ |

**CustomEvent**: `level4:complete` → `{ answers, photofind, stars, xp, badge }`

---

## 8. Star Rating Logic

Đếm số "lần trượt" (slips):

| Slip | Điều kiện |
|------|-----------|
| +1 | Q2 phải thử lại (`firstChoice !== 'B'` mà cuối cùng correct) |
| +1 | Q3 phải thử lại (`firstChoice !== 'B'` mà cuối cùng correct) |
| +1 | Q1 có `wrongTaps ≥ 2` |

| Slips | Stars |
|-------|-------|
| 0 | ⭐⭐⭐ |
| 1 | ⭐⭐ |
| ≥ 2 | ⭐ |

> **Đã gỡ**: slip từ mission (`mistakes ≥ 2`). Mission mini-game đã bị loại bỏ.

---

## 9. XP Calculation (max 30)

| Hành động | XP |
|-----------|----|
| Q1 hoàn thành, `wrongTaps ≤ 1` | 8 |
| Q1 hoàn thành, `wrongTaps ≥ 2` | 4 |
| Q2 đúng lần đầu (`history.length === 1`) | 11 |
| Q2 đúng sau khi sửa | 6 |
| Q3 đúng lần đầu | 11 |
| Q3 đúng sau khi sửa | 6 |

**Tối đa**: 8 + 11 + 11 = **30 XP**

> **Đã gỡ**: XP từ mission (8 hoặc 4). Tổng mới: 30 XP (không thay đổi).

---

## 10. PhotoBoard API (`ph-*`)

```js
new window.PhotoBoard(containerEl, {
    scene: 'main',                  // từ PhotoScenes
    onCorrect(zone),                // private zone tapped
    onDecoy(zone),                 // decoy zone tapped
    onBlankTap(count),             // tap outside any zone
    onAllFound()                   // all private zones done
});
// phương thức: destroy(), showHint(level), getState()
```

Khung ảnh tỉ lệ cố định 4:3 (`aspect-ratio: 4/3`), toạ độ vùng tính theo %.
Mỗi vùng là `<button class="ph-zone">` định vị tuyệt đối, không dùng `<map>`/`<area>`.
Mọi animation có nhánh `@media (prefers-reduced-motion: reduce)`.
`destroy()` gỡ listener + timer — không rò rỉ khi "Chơi lại".

---

## 11. PhotoScenes API (`photo-scenes.js`)

```js
window.PhotoScenes = {
    getZones('main')         // trả về mảng zone có rect (% khung)
    renderSVG('main')        // trả về chuỗi SVG inline (viewBox 400x300)
    tryImageOverride(scene)   // promise: URL ảnh PNG nếu có, null nếu lỗi
};
```

Một ảnh SVG inline (vẽ tay, phong cách phẳng, dùng gradient `--ck-*`):
- **main** — CyberKnight khoe cúp trong phòng (Q1 photofind)

> **Đã gỡ**: scene 'desk' (ZONES_DESK + renderDeskSVG) vì chỉ dùng cho mission mini-game đã bị xóa.

Nếu `../image/level4/photo-main.png` tồn tại, sẽ dùng ảnh thật; hotspot không đổi.

---

## 12. Key Design Decisions

1. **SCENE_FLOW table** (spec §4.2): thay vì `parseInt + 1`, dùng bảng luồng tường minh để
   `reveal` là clip riêng và `scene5 → summary` (không còn mission).
2. **PhotoBoard chỉ dùng ở Q1 photofind**: mode `'cover'` đã bị gỡ bỏ cùng với mission mini-game.
3. **Chọn sai KHÔNG lộ đáp án**: chỉ tô nhẹ nút đã chọn (mint nếu đúng, cam nhạt nếu sai);
   các nút còn lại giữ nguyên trạng thái trung tính.
4. **Q1 không có "sai"**: vùng nhiễu chỉ kính lúp + bip nhắc, không bắt xem lại video,
   gợi ý 3 bậc (chỉ số hint tăng dần) qua nút 💡 hoặc tự động (sau 12s idle, 2 lần sai, hoặc 5 lần chạm trống).
5. **Q2 mini cover effect**: sau khi trả lời đúng B, overlay hiển thị ảnh thu nhỏ với 3 nhãn dán
   "CHE TÊN TRƯỜNG / CHE THẺ TÊN / CHE SỐ ĐIỆN THOẠI" pop lên (CSS only, ~1.5s, tắt nếu reduced-motion).
6. **AudioSynth an toàn**: tất cả method mới (`photoSnap`, `coverStick`, `magnify`)
   đều guard `if (!synth.ctx) return;` — chạy được khi mất audio.
7. **Thanh tiến độ 3 chấm**: Q1 dùng UI `.ph-hud-progress` với 3 chấm sáng dần.
8. **Disclaimer hư cấu**: mọi tên trường ("TH Ngôi Sao Xanh"), tên lớp
   ("Bạn Hiệp Sĩ – Lớp 3A"), địa chỉ, số điện thoại ("0123 456 789") đều giả.
   Caption trong polaroid + disclaimer trong summary đều ghi rõ.
9. **Chơi lại**: reset toàn bộ state + hủy PhotoBoard + resetAllVideos() +
   khôi phục thẻ overlay, **giữ** `VideoSource.baseIdx` (không phải probe lại).
10. **Z-index kế thừa Level 3**: thang `--z-stage` (10), `--z-stage-active` (20),
    `--z-freeze` (50), `--z-overlay` (60), `--z-topbar` (9999).
11. **Touch-first**: mọi thao tác là chạm/click, không kéo-thả; vùng chạm tối thiểu 44×44 px
    (dù ảnh thu nhỏ). Khoá sau lần chạm đầu trên mỗi vùng (tránh double-fire).
12. **A11y**: nút có `aria-label`; vùng ảnh có `role="group"`; thông báo động dùng `.ph-bip` (cố định);
    focus ring rõ (`outline: 3px solid var(--ck-blue-500)`); hỗ trợ `prefers-reduced-motion`.

---

## 13. Quyết định thiết kế (khi đặc tả mơ hồ)

- **Số thứ tự tên vùng decoy Q1**: đặc tả §5.1 nói "chạm trống ≥ 5 lần liên tiếp" nhưng
  không nói rõ "chạm trống" có nghĩa là gì khi đã có các vùng nhiễu (trophy). Tôi tính
  cả 2: `wrongTaps` (chạm nhiễu) và `blankTaps` (chạm ngoài mọi vùng) — gợi ý kích hoạt
  khi `wrongTaps >= 2` HOẶC `blankTaps >= 5` HOẶC idle 12s.
- **Trophy ở Q1**: đặc tả nói "1 vùng gây nhiễu" và liệt kê trophy nhưng không cho biết
  vùng đó có nên có hiệu ứng kính lúp. Tôi thêm kính lúp quét + bip nhắc (mild orange, không
  đỏ) theo đúng tinh thần khuyến khích của đặc tả.
- **Box zone hiển thị 2 thông tin**: đặc tả §5.1 ghi "Địa chỉ ... và Số điện thoại: 0123 456 789"
  → tôi gộp cả 2 dòng vào 1 chip thông tin, mỗi dòng trên một dòng riêng.
- **Animation ưu tiên giảm chuyển động**: polaroid nghiêng ≤ 2° bị TẮT khi
  `prefers-reduced-motion: reduce`; tất cả animation (chip-pop, magnify-sweep, …)
  đều có nhánh reduce tắt chuyển động, chỉ giữ thay đổi màu/viền.

---

*Document version: 1.1 | Last updated: 2026-10-11 | Change: Removed PhotoDetectiveGame mission mini-game*
