// Sync videos từ OneDrive vào thư mục public (nếu chưa có)
// Mục đích: khắc phục vấn đề OneDrive Files On-Demand không hiển thị cho Express static

const fs = require('fs');
const path = require('path');

const SOURCE = 'C:\\Users\\ASUS\\OneDrive\\Máy tính\\EXEWEB\\video\\level 2';
// Đích: thư mục video nằm ngoài OneDrive để Express serve được
// Dùng __dirname là backend/src/ → ../../ = project root
const DEST = path.join(__dirname, '..', '..', 'video', 'level 2');

const files = ['intro.mp4', 'bad.mp4', 'good.mp4'];

console.log('Source:', SOURCE);
console.log('Dest:  ', DEST);

if (!fs.existsSync(SOURCE)) {
    console.error('Source folder does not exist!');
    process.exit(1);
}

if (!fs.existsSync(DEST)) {
    fs.mkdirSync(DEST, { recursive: true });
    console.log('Created dest folder');
}

for (const f of files) {
    const src = path.join(SOURCE, f);
    const dst = path.join(DEST, f);

    if (!fs.existsSync(src)) {
        console.warn(`[SKIP] ${f} — không tìm thấy trong source`);
        continue;
    }

    const srcStat = fs.statSync(src);
    console.log(`[CHECK] ${f} — size ${srcStat.size} bytes`);

    if (fs.existsSync(dst)) {
        const dstStat = fs.statSync(dst);
        if (dstStat.size === srcStat.size) {
            console.log(`[OK] ${f} đã tồn tại và cùng kích thước`);
            continue;
        }
    }

    try {
        fs.copyFileSync(src, dst);
        const newStat = fs.statSync(dst);
        console.log(`[COPIED] ${f} → ${newStat.size} bytes`);
    } catch (e) {
        console.error(`[ERROR] ${f}:`, e.message);
    }
}

console.log('\nDone!');