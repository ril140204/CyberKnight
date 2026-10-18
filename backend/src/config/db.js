const mysql2 = require('mysql2/promise');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

// Cấu hình dotenv nạp .env từ đúng thư mục backend hoặc thư mục gốc
const candidatePaths = [
  path.join(__dirname, '../../.env'),    // backend/.env
  path.join(__dirname, '../../../.env'),  // root .env
];
const envPath = candidatePaths.find(p => fs.existsSync(p)) || candidatePaths[0];
require('dotenv').config({ path: envPath });

// Tạo connection pool (dùng chung nhiều kết nối, hiệu quả hơn)
const pool = mysql2.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 3306,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'sigmabloom',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  charset: 'utf8mb4',
});

// Hàm hỗ trợ tự khởi động MySQL nếu chưa chạy trên Windows
// CHỈ chạy khi: non-production + Windows (tránh production deploy cố gắng spawn MySQL)
async function tryAutoStartMySQL() {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  if (process.platform !== 'win32') {
    return false;
  }

  const mysqldPath = String.raw`C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe`;
  const dataDir = String.raw`C:\ProgramData\MySQL\MySQL Server 8.4\Data`;

  if (!fs.existsSync(mysqldPath)) {
    return false;
  }

  console.log('🔍 [MySQL] Đang tự động khởi động MySQL Server 8.4...');
  try {
    const child = spawn(mysqldPath, [`--datadir=${dataDir}`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    // Chờ tối đa 6 giây để MySQL sẵn sàng
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const testConn = await pool.getConnection();
        testConn.release();
        return true;
      } catch {
        // Chưa kết nối được, tiếp tục đợi
      }
    }
  } catch (e) {
    console.error('❌ Không thể tự kích hoạt MySQL:', e.message);
  }
  return false;
}

// Kiểm tra kết nối khi khởi động
async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ Kết nối MySQL thành công!');
    conn.release();
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      const recovered = await tryAutoStartMySQL();
      if (recovered) {
        console.log('✅ Đã tự động bật MySQL và kết nối thành công!');
        return;
      }

      console.error('❌ Không thể kết nối MySQL:', err.message);
      console.error('👉 Dịch vụ MySQL chưa được bật trên máy tính của bạn!');
      console.error('👉 Bạn có thể khởi động nhanh bằng lệnh: npm run start-mysql');
    } else {
      console.error('❌ Không thể kết nối MySQL:', err.message);
      console.error('👉 Hãy kiểm tra lại thông tin kết nối trong file .env');
    }
    process.exit(1);
  }
}

void testConnection();

module.exports = pool;
