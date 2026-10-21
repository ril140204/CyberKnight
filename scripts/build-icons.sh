#!/usr/bin/env bash
# ============================================================
# CyberKnight — Dựng SVG sprite icon tự host: assets/icons.svg
#
#   Lucide (ISC)        → icon nét, dùng: <svg class="icon"><use href="/assets/icons.svg#i-shield"/></svg>
#   Simple Icons (CC0)  → logo TikTok (#i-tiktok)
#
# Cách dùng:
#   bash scripts/build-icons.sh
# Thêm icon: thêm tên (đúng tên file trên https://lucide.dev/icons) vào LUCIDE trong scripts/build-icons.py
# rồi chạy lại. Phiên bản thư viện được ghim bên dưới để bản dựng lặp lại được.
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LUCIDE_VERSION="1.49.0"
SIMPLE_ICONS_VERSION="16.33.0"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

(cd "$TMP" && npm pack --silent "lucide-static@$LUCIDE_VERSION" "simple-icons@$SIMPLE_ICONS_VERSION" >/dev/null)
mkdir -p "$TMP/lucide" "$TMP/si"
tar -xzf "$TMP"/lucide-static-*.tgz -C "$TMP/lucide"
tar -xzf "$TMP"/simple-icons-*.tgz -C "$TMP/si"

python3 -I "$ROOT/scripts/build-icons.py" "$TMP/lucide/package/icons" "$TMP/si/package/icons" "$ROOT/assets/icons.svg"
# Đổi ?v= trong các trang để trình duyệt tải sprite mới ngay (không dùng bản cache 1 ngày)
python3 -I "$ROOT/scripts/stamp-assets.py"
