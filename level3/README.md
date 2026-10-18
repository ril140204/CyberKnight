# Level 3: "Bốn Chìa Khóa Bí Mật" — CyberKnight/Sigmabloom

## 📁 Cấu trúc file

```
level3/
├── level3.html      # Markup: 5 scene video, 3 question overlays, keygame stage, summary
├── level3.css      # Styles: CSS variables, z-index scale, class-based transitions
├── level3.js       # Controller: state machine, video management, question flow
├── key-audit.js    # Mini-game module: 4 rooms, keyhole touch game, leak detection
└── README.md       # File này
```

## 🎬 Video files

Video files can be in either folder (space-sensitive path):

| Folder | Path |
|--------|------|
| Primary | `../video/level3/` |
| Alternate | `../video/level 3/` (note the space) |

| Scene | File | After |
|-------|------|-------|
| scene1 | `scene1.mp4` | Start button |
| scene2 | `scene2.mp4` | scene1 ends |
| scene3 | `scene3.mp4` | question:micro correct |
| scene4 | `scene4.mp4` | question:location correct |
| scene5 | `scene5.mp4` | question:photos correct |

Video path probing order (first successful base is cached for all subsequent scenes):
1. `../video/level3/`
2. `../video/level 3/`
3. `video/level3/`
4. `./`

## 🔄 Luồng State Machine

```
START
  → scene1 → scene2 → [q:micro] ─A→ result:micro:A → [retry|replay]
    │                      └B→ scene3 → [q:location] ─A→ scene4
    │                                    ├B→ result:location:B → [retry|replay]
    │                                    └C→ result:location:C → [retry|replay]
    │
→ scene4 → [q:photos] ─A→ result:photos:A → [retry|replay]
                         └B→ scene5

→ scene5 → key-audit game "Kiểm kê chìa khóa"

→ SUMMARY (3⭐/2⭐/1⭐, HỎI–CHỌN–RÚT, 4 dấu hiệu đáng ngờ, XP)
```

**3 Question Overlays:**
- `micro` (after scene2): Bút Màu xin Micro → A/B
- `location` (after scene3): Bản Đồ xin Vị trí → A/B/C
- `photos` (after scene4): Bản Đồ xin xem Ảnh → A/B

**Key Audit Mini-Game — "Kiểm kê chìa khóa":**
- 4 rooms in sequence (1/4…4/4 progress bar)
- 4 keyholes per room: 📷 Máy Ảnh, 🎤 Micro, 📍 Vị trí, 🖼️ Thư Viện Ảnh
- Touch: tap keyhole to INSERT or REMOVE key (no drag-drop)
- Location keyhole: 3-state cycle (off → "Khi đang dùng" → "Mọi lúc")
- HUD: "Đồng hồ riêng tư" (green/orange leak indicator) + Bíp character
- Leak visual: permission icon bubbles drift toward "Chú Bóng Tò Mò" 👤
- Room 1 (paint): needs=[], initial: {micro:on} → rút Micro
- Room 2 (torch): needs=[], initial: {location:'always',micro:'on'} → rút both; trap if Vị trí still in
- Room 3 (map): needs:['location'], locationMode:'whileUsing', initial:{location:'always',photos:'on'} → "Khi đang dùng" + rút Thư viện
- Room 4 (call): needs:['camera','micro'], needsAdult:true, initial:{camera:'on',location:'always'} → giữ Máy ảnh, cắm Micro, rút Vị trí; [Bố/mẹ đồng ý] required
- Success: 4 keys fly to center → "NGƯỜI GIỮ CHÌA KHÓA" badge + confetti

## 🔧 Debug Flags

| URL Param | Hành vi |
|-----------|---------|
| `?skip=scene2` | Jump directly to scene2 |
| `?skip=scene3` | Jump directly to scene3 |
| `?skip=scene4` | Jump directly to scene4 |
| `?skip=scene5` | Jump directly to scene5 |
| `?skip=q1` | Jump directly to question:micro |
| `?skip=q2` | Jump directly to question:location |
| `?skip=q3` | Jump directly to question:photos |
| `?skip=result-q1-A` | Jump to question:micro, auto-click A → result screen |
| `?skip=result-q2-B` | Jump to question:location, auto-click B → result screen |
| `?skip=result-q2-C` | Jump to question:location, auto-click C → result screen |
| `?skip=result-q3-A` | Jump to question:photos, auto-click A → result screen |
| `?skip=keygame` | Jump directly to key-audit game |
| `?skip=keygame-room1` | Jump to key-audit game, start at room 1 |
| `?skip=keygame-room2` | Jump to key-audit game, start at room 2 |
| `?skip=keygame-room3` | Jump to key-audit game, start at room 3 |
| `?skip=keygame-room4` | Jump to key-audit game, start at room 4 |
| `?skip=summary-first` | Summary with all 3 correct first try (3⭐, 30 XP) |
| `?skip=summary-retry` | Summary with corrections (1-2⭐) |
| `?skip=summary` | Summary with default choices (micro=B, location=A, photos=B) |
| `?debug=1` | Show all absolute video URLs in error panel |

## 🎨 CSS Z-Index Scale

```css
--z-stage: 10;
--z-stage-active: 20;
--z-freeze: 50;
--z-overlay: 60;     /* questions + result screens */
--z-topbar: 9999;
```

## 📐 Summary Safe-Center

```css
#stage-summary {
    justify-content: flex-start;   /* fallback trình duyệt cũ */
    justify-content: safe center;  /* trình duyệt mới */
    overflow-y: auto;
}
```

## 🔊 AudioSynth Methods

New methods added in key-audit.js:
- `keyInsert` — key goes into keyhole
- `keyRemove` — key comes out of keyhole
- `leakStop` — leak fixed
- `roomClear` — room completed successfully
- `softBonk` — wrong answer (gentle)
- `callRing` — video call ringing

Existing methods: `playTick`, `playCorrectCatch`, `playIncorrectCatch`, `playGlitchExplosion`, `playVictoryChime`, `playSoftBip`

## 🎯 Summary Blocks (Part 3)

| Block | Content |
|-------|---------|
| 3.1 | Title "LEVEL 3 COMPLETED!" + badge + stars + XP |
| 3.2 | "CÔNG THỨC NHỚ NHANH: HỎI – CHỌN – RÚT" (3 horizontal cards) |
| 3.3 | "4 DẤU HIỆU ỨNG DỤNG ĐÁNG NGHI" (4 rows with tags) |
| 3.4 | "HÀNH TRÌNH CỦA CON" (3 question recap cards + game line) |
| 3.5 | Disclaimer + [Chơi lại] [Tiếp tục hành trình] |

CustomEvent: `level3:complete` → `{ answers, keygame: { mistakes, hintsUsed, rooms }, stars, xp, badge }`

## ⭐ Star Rating Logic

- **3⭐**: All 3 questions right first try AND keygame mistakes ≤ 2
- **2⭐**: All 3 correct but at least 1 needed retry, OR keygame mistakes ≤ 2 with some retries
- **1⭐**: Everything else (never 0 stars)

## 💡 Key Design Decisions

1. **VideoSource**: Attempt-index-based base discovery (never derive from URL string)
2. **KeyAuditGame**: Touch-first, no drag-drop; 4 sequential rooms
3. **Leak detection**: Computed per-key based on room.needs vs current keyState
4. **Hints**: 3-tier progressive (hint[0], hint[1]+pulse, hint[2]+explicit)
5. **Call room**: "Bố/mẹ đồng ý" button required before success
6. **Replay**: `onEnded` callback in `_playScene`; summary called immediately (no 2s delay)
7. **Chơi lại**: Resets answers/keygame/videos but KEEPS VideoSource.baseIdx
