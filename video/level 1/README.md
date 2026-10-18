# 📁 Thư mục chứa VIDEO cho Level 1

> **Video MP4 là TÙY CHỌN, không bắt buộc!** Game vẫn hoạt động hoàn toàn bình thường nhờ **fallback scene** thông minh hiển thị kết quả dạng text + animation khi không có video.

## Tại sao video là tùy chọn?

- Game sử dụng hệ thống **fallback scene** (màn hình kết quả tương tác) khi video không load được
- Người chơi vẫn thấy hậu quả, bài học và có thể tiếp tục hành trình
- Trải nghiệm giáo dục không bị gián đoạn khi thiếu file video

## Nếu bạn có video MP4

Đặt **đầy đủ 4 file** sau vào thư mục này để có trải nghiệm video đầy đủ:

| File | Mô tả | Thời lượng khuyến nghị |
|------|-------|------------------------|
| `intro.mp4` | Video mở đầu (tình huống lớp trưởng gửi link) | ~15–25 giây |
| `bad.mp4` | Video hậu quả XẤU (Nhánh A — bấm link & điền địa chỉ) | ~10 giây |
| `middle.mp4` | Video hậu quả TRUNG GIAN (Nhánh B — hỏi lớp trưởng) | ~10 giây |
| `good.mp4` | Video hậu quả TỐT (Nhánh C — không bấm + hỏi người lớn) | ~10 giây |

### Yêu cầu định dạng

- **Định dạng:** `.mp4` (H.264 + AAC)
- **Tỷ lệ khung hình:** 16:9 (1280×720 hoặc 1920×1080 đều được)
- **Dung lượng khuyến nghị:** Dưới 10 MB mỗi file (để load nhanh)

## Cách fallback scene hoạt động

1. Game thử load file MP4 qua **4 đường dẫn dự phòng** (relative + absolute)
2. Nếu **tất cả đều fail** → hiển thị **fallback scene** với:
   - Icon + tiêu đề cảnh báo đặc trưng cho từng nhánh (A/B/C)
   - 4 bài học an toàn mạng tương ứng với lựa chọn
   - Animation đẹp mắt (slide-in, pulse, gradient theo nhánh)
   - Nút **"XEM BÀI HỌC CHI TIẾT ▶"** → chuyển sang màn hình tổng kết
3. Nếu có video MP4 → video phát bình thường, fallback bị ẩn

## Test nhanh

```powershell
cd "C:\Users\ASUS\OneDrive\Máy tính\EXEWEB\backend"
node src/server.js
```

Mở browser:
- `http://localhost:5000/level1/level1.html?skip=outro-A` — Test nhánh A
- `http://localhost:5000/level1/level1.html?skip=outro-B` — Test nhánh B
- `http://localhost:5000/level1/level1.html?skip=outro-C` — Test nhánh C

**Kết quả:**
- Có video → Video phát
- Không có video → Fallback scene hiển thị đầy đủ nội dung + nút tiếp tục

## Debug

Mở **DevTools → Console** xem log. Code có log chi tiết:
```
🔄 Đang thử đường dẫn [1/4]: ../video/level 1/bad.mp4
❌ Tất cả đường dẫn dự phòng đều thất bại
⚠️ Tất cả đường dẫn video outro đều thất bại — dùng fallback scene
```