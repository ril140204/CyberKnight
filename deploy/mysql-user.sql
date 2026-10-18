# ============================================================
# CyberKnight / Sigmabloom — Tạo user MySQL riêng cho ứng dụng
#
# LƯU Ý: File này KHÔNG còn chứa user SQL thật.
#         Các user được tạo trong Phase 2.2 bằng bootstrap script.
#
# 3 user cần tạo (Phase 2.2):
#   1. sigmabloom_app@localhost     — CRUD (SELECT, INSERT, UPDATE, DELETE)
#   2. sigmabloom_migrate@localhost — DDL + DML (chạy setup-db)
#   3. sigmabloom_backup@localhost   — SELECT, SHOW VIEW, TRIGGER, LOCK TABLES
#
# Xem deploy/DEPLOY.md (Phase 2.2) để biết câu lệnh tạo đầy đủ.
# ============================================================
