# 🔍 Postmortem Template — CyberKnight / Sigmabloom

> **Hướng dẫn:** Điền mẫu này sau mỗi sự cố nghiêm trọng (down > 5 phút,
> mất dữ liệu, hoặc incident ảnh hưởng đến user). Lưu file vào thư mục
> `deploy/postmortems/` với tên `YYYY-MM-DD-incident-name.md`.
>
> **Mục tiêu:** Rút kinh nghiệm, tránh lặp lại, cải thiện thời gian phản ứng.

---

## 1. Tóm tắt Sự cố

| Trường | Giá trị |
|--------|---------|
| **ID** | INC-YYYYMMDD-### |
| **Ngày giờ** | YYYY-MM-DD HH:MM – HH:MM (UTC+7) |
| **Thời lượng** | X phút / X giờ |
| **Mức độ** | 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low |
| **Người phụ trách** | Tên người xử lý chính |
| **Reviewed by** | Tên người review |

**Tóm tắt (2-3 câu):**
> Mô tả ngắn gọn sự cố xảy ra gì, ảnh hưởng ai, kết quả cuối cùng.

---

## 2. Dòng thời gian (Timeline)

| Giờ (UTC+7) | Sự kiện | Ai | Ghi chú |
|------------|---------|----|---------|
| HH:MM | Sự cố bắt đầu (triệu chứng đầu tiên nhận ra) | — | |
| HH:MM | Phát hiện (bằng cách nào — alert, user report, tự phát hiện?) | — | |
| HH:MM | Bắt đầu xử lý | — | |
| HH:MM | Chẩn đoán nguyên nhân | — | |
| HH:MM | Hành động khắc phục đầu tiên | — | |
| HH:MM | Khắc phục hoàn tất — service trở lại bình thường | — | |
| HH:MM | Postmortem bắt đầu | — | |

---

## 3. Tác động (Impact)

| Mục | Giá trị |
|------|---------|
| **Người dùng bị ảnh hưởng** | Bao nhiêu user / % |
| **Thời gian downtime** | X phút |
| **Giao dịch bị ảnh hưởng** | Số đơn hàng bị treo / lỗi |
| **Doanh thu ước tính mất** | X VNĐ (nếu tính được) |
| **Dữ liệu bị mất** | Có/Không — mô tả |

---

## 4. Nguyên nhân gốc (Root Cause)

**Nguyên nhân trực tiếp:**
> Mô tả sự kiện kỹ thuật trực tiếp dẫn đến sự cố.

**Nguyên nhân gốc (Root Cause):**
> Tại sao sự kiện đó xảy ra? Có vấn đề cấu hình, code, hay quy trình nào dẫn đến?

**Điều kiện cần thiết để tái tạo:**
> Liệt kê các bước để tái tạo sự cố (nếu có).

---

## 5. Hành động đã thực hiện (What We Did)

| # | Hành động | Người | Thời gian |
|---|-----------|-------|-----------|
| 1 | | | |
| 2 | | | |
| 3 | | | |

---

## 6. Nguyên nhân chưa được phát hiện sớm

> Tại sao sự cố không được phát hiện sớm hơn? Có monitoring/alert nào thiếu không?

---

## 7. Hành động phòng ngừa (Action Items)

| # | Hành động | Ưu tiên | Người phụ trách | Deadline |
|---|-----------|--------|----------------|---------|
| 1 | | 🔴 High / 🟠 Medium / 🟢 Low | | YYYY-MM-DD |
| 2 | | 🔴 / 🟠 / 🟢 | | YYYY-MM-DD |
| 3 | | 🔴 / 🟠 / 🟢 | | YYYY-MM-DD |

---

## 8. Lessons Learned (Bài học)

**Điều chạy tốt:**
- ...

**Điều cần cải thiện:**
- ...

**Nếu có thêm thời gian, sẽ làm gì khác:**
- ...

---

## 9. Các file liên quan

- Logs: `pm2 logs cyberknight --lines 500` (đã lưu lúc HH:MM)
- Screenshots/Alert output: [đính kèm]
- Related commits/change: [liên kết]

---

## 10. Ky hiệu và ký duyệt

| Vai trò | Tên | Ngày | Chữ ký |
|---------|-----|------|--------|
| Người viết | | | |
| Reviewer | | | |
| Approver (Admin) | | | |

---

> **Lưu ý:** Postmortem KHÔNG nhằm đổ lỗi cá nhân. Mục đích là cải thiện hệ thống và quy trình.
> Báo cáo này được lưu trong `deploy/postmortems/` và dùng để cập nhật `MONITORING.md`.
