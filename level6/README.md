# CyberKnight — Level 6: "Chặn Đứng Bắt Nạt Mạng"

Level dạy trẻ em **bảo vệ bạn bè và bảo vệ chính mình** khi bị bắt nạt trên mạng xã hội.

## 🎯 Mục tiêu học

Sau khi chơi xong, người chơi nhớ được 3 điều:

| # | Biểu tượng | Nội dung |
|---|-----------|----------|
| 1 | 🛑 | Không hùa theo lời chê bai |
| 2 | 🚫 | Chặn và báo cáo tin xấu |
| 3 | 🧑‍🏫 | Kể ngay với người lớn tin cậy |

## 🏅 Huy hiệu

`HIỆP SĨ BẢO VỆ BẠN BÈ`

## 🗺️ Luồng chơi

```
start-overlay
  └─ scene1.mp4        video: "Bạn bè đang bị chê bai trên mạng"
       └─ stage-q1      câu hỏi 3 lựa chọn A / B / C
            └─ scene2.mp4   video: hậu quả khi im lặng vs lên tiếng
                 └─ scene3.mp4  video: cách lên tiếng đúng & an toàn
                      └─ stage-cleanup  mini-game "Dọn dẹp tin nhắn xấu xí"
                           └─ complete.mp4  video ăn mừng
                                └─ badge.mp4   video trao huy hiệu
                                     └─ stage-summary  1 tiêu đề + 3 ý
```

Luồng được điều khiển bằng bảng khai báo tường minh `SCENE_FLOW` trong `level6.js`:

```javascript
const SCENE_FLOW = {
    scene1:   { question: 'decide' },
    scene2:   { next: 'scene3' },
    scene3:   { question: 'cleanup' },
    complete: { next: 'badge' },
    badge:    { next: 'summary' }
};
```

## 🎮 Câu hỏi (stage-q1)

Ba nút **A / B / C** có cùng kích thước và cùng màu trung tính:

| Nút | Nội dung |
|-----|----------|
| A | 😄 Gửi icon cười cợt hùa theo |
| B | 🙈 Thoát ứng dụng và mặc kệ |
| C | 🛡️ Lên tiếng bảo vệ bạn hoặc Bấm Báo cáo ← **đáp án đúng** |

- Màu chỉ xuất hiện **sau** khi con bấm: xanh mint = đúng, cam nhạt = sai.
- Chọn sai → Bíp phản hồi tại chỗ, **không bao giờ nói thẳng đáp án đúng**.
- Chọn lại **không giới hạn**. Sau 15 giây không chọn, Bíp sẽ gợi ý.

### Chấm điểm

| Số lần chọn sai | Sao | XP |
|-----------------|------|-----|
| 0 | ⭐⭐⭐ | 30 |
| 1 | ⭐⭐ | 20 |
| ≥ 2 | ⭐ | 10 |

## 🧹 Mini-game "Dọn dẹp tin nhắn xấu xí" (stage-cleanup)

Ba bong bóng chat xấu bay trong khung:

- `Đồ ngốc nghếch!`
- `Trông cậu thật xấu xí`
- `Hahaha, lêu lêu`

**Cách chơi (touch-first):**

1. **Bấm / chạm** vào bong bóng → dọn ngay (cách chính, dễ nhất trên điện thoại).
2. **Kéo thả** bong bóng vào thùng 🚫 **CHẶN** (Pointer Events, offset tính một lần lúc `pointerdown` — cùng kỹ thuật với `level2/door-puzzle.js`).

> **Ngưỡng phân biệt chạm / kéo = 8 px** (`CONFIG.DRAG_THRESHOLD_PX`).
> Ngón tay luôn "rung" vài px khi chạm trên màn cảm ứng. Dưới ngưỡng → coi là **chạm**
> (dọn bong bóng ngay); vượt ngưỡng → coi là **kéo**. Sau khi kéo, cờ `_suppressClick`
> tự tắt sau **50 ms** nên cú chạm hợp lệ kế tiếp không bị nuốt.

> **Gợi ý khi im lặng**: nếu **15 giây** (`CONFIG.IDLE_HINT_MS`) không thao tác, Bíp nhắc
> *"Thử chạm vào một bong bóng xấu nhé con!"*. Timer được reset mỗi lần con chạm/kéo
> và bị dừng khi dọn đủ 3 bong bóng hoặc rời màn.

Kịch bản hiệu ứng:

| Bong bóng | Hiệu ứng | Quái Bắt Nạt 👹 |
|-----------|----------|------------------|
| 1 | `bl-pop` — vỡ "bùm" | Nhăn nhó (`bl-bully-grumpy`) |
| 2 | `bl-vanish` — tan dần | Đứng yên |
| 3 | `bl-flash` — màn hình sáng bừng | Tan biến (`bl-bully-vanish`) |

Thanh tiến độ đếm `0/3 → 3/3`.

> **Bố cục**: thùng 🚫 **CHẶN** nằm **cạnh** khung bong bóng (flex, không phải `absolute`)
> → không bao giờ chồng lên bong bóng. Vùng thả luôn ≥ **88 × 88 px**.
> Trên màn thấp (`max-height: 480px`) tiêu đề / Bíp / Quái Bắt Nạt được thu nhỏ,
> Quái Bắt Nạt nằm trong dòng tiêu đề (không đè nút THOÁT), khung bong bóng giữ ≥ 160 px
> và container cho phép cuộn dọc.

> **Reset mini-game**: `CleanupGame.reset()` gỡ class hiệu ứng của Quái Bắt Nạt,
> xoá `.bl-flash-overlay`, xoá bong bóng cũ, đưa tiến độ về `0/3` và **xoá toàn bộ
> `setTimeout` đang chạy** (nhăn nhó 1600 ms, flash 800 ms, chuyển sang `complete` 1400 ms).
> Được gọi khi bấm **THOÁT**, bấm **Chơi lại**, và khi vào lại mini-game.

> **Quái Bắt Nạt** được dựng hoàn toàn bằng CSS + emoji (👹) — không cần asset hình ảnh mới.

## 📺 Video

| Scene | File |
|-------|------|
| scene1 | `video/level 6/scene1.mp4` |
| scene2 | `video/level 6/scene2.mp4` |
| scene3 | `video/level 6/scene3.mp4` |
| complete | `video/level 6/complete.mp4` |
| badge | `video/level 6/badge.mp4` |

Tên file có **khoảng trắng** trong thư mục (`level 6`) nên URL luôn được bọc qua `encodeURI()`.

## 🧪 Debug

Thêm `?debug` vào URL để xem log console chi tiết (URL thử nghiệm video, kết quả asset probing…).

Khi `?debug` bật, console sẽ **cảnh báo nếu thiếu file video** của bất kỳ scene nào
(`scene1`, `scene2`, `scene3`, `complete`, `badge`) — hữu ích khi đổi tên/định dạng file.

Nhảy thẳng tới stage bằng query param `?skip=`:

| Giá trị | Stage |
|---------|-------|
| `scene1` `scene2` `scene3` `complete` `badge` | stage video tương ứng |
| `q1` | màn câu hỏi A/B/C |
| `cleanup` | mini-game dọn tin nhắn |
| `summary` | alias của `summary-first` → ⭐⭐⭐ / 30 XP |
| `summary-first` | summary với ⭐⭐⭐ / 30 XP |
| `summary-retry` | summary với ⭐⭐ / 20 XP |

Ví dụ: `/level6/level6.html?debug&skip=cleanup`

## 📁 Cấu trúc

```
level6/
├── level6.html    # markup: 8 stage + topbar + overlay
├── level6.css     # design tokens (--ck-*, --z-*) + component bl-*
├── level6.js      # state machine, AudioSynth, FreezeFrame, mini-game
└── README.md      # file này
```

## 🧩 Quy ước kỹ thuật (kế thừa từ Level 5)

- Không thêm thư viện JS ngoài Google Fonts + `canvas-confetti`.
- Không dùng `localStorage`; có `escapeHtml()` cục bộ.
- Không force `muted` — video **có tiếng**; autoplay bị chặn thì hiện nút `▶ BẤM ĐỂ XEM TIẾP`.
- Cờ `_sceneEnded` + timer an toàn 1500 ms chống `ended` bắn hai lần khi bấm `BỎ QUA ⏩`.
- Audio tổng hợp bằng WebAudio, không dùng file âm thanh.
- Class riêng của Level 6 dùng tiền tố `bl-` (bullying); class dùng chung (`ph-bip`, `summary-card`, `floating-sparkle`, `cyber-grid`, `deco-blob`) tái sử dụng từ Level 5.
- Phát sự kiện cho host: `window.dispatchEvent(new CustomEvent('level6:complete', { detail: { answers, stars, xp, badge } }))`.
- Đóng level: `postMessage({ type: 'closeGameModal' })` nếu đang chạy trong iframe, fallback `../index.html`.