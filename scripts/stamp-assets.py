"""Gắn phiên bản theo nội dung (?v=<hash>) cho assets/tailwind.css và assets/icons.svg trong mọi trang.

/assets được cache 1 ngày: không đổi URL thì trình duyệt đã vào site trước đó vẫn dùng file cũ
(ví dụ CSS cũ chưa có class .icon → icon thành khối đen). Chạy lại sau mỗi lần build CSS / icon:
    python3 -I scripts/stamp-assets.py
(npm run build:css và scripts/build-icons.sh đã tự gọi.)
"""
import glob
import hashlib
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def short_hash(rel):
    with open(os.path.join(ROOT, rel), 'rb') as f:
        return hashlib.sha1(f.read()).hexdigest()[:8]


ASSETS = {
    'tailwind.css': (re.compile(r'/assets/tailwind\.css(?:\?v=[0-9a-f]+)?'), short_hash('assets/tailwind.css')),
    'icons.svg': (re.compile(r'/assets/icons\.svg(?:\?v=[0-9a-f]+)?#'), short_hash('assets/icons.svg')),
}

files = sorted(glob.glob(os.path.join(ROOT, '*.html')) + glob.glob(os.path.join(ROOT, 'level*/*.html')))
files.append(os.path.join(ROOT, 'backend/src/server.js'))

for path in files:
    with open(path, encoding='utf-8') as f:
        src = f.read()
    out = ASSETS['tailwind.css'][0].sub(f"/assets/tailwind.css?v={ASSETS['tailwind.css'][1]}", src)
    out = ASSETS['icons.svg'][0].sub(f"/assets/icons.svg?v={ASSETS['icons.svg'][1]}#", out)
    if out != src:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(out)
        print('stamped', os.path.relpath(path, ROOT))

print({k: v[1] for k, v in ASSETS.items()})
