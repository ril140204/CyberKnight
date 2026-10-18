/**
 * Script xóa giới hạn thử lại quên mật khẩu (Reset rate limit & reset history)
 * Chạy: node backend/scripts/reset-email-limit.js
 */
const path = require('path');
const fs = require('fs');

const envPath = fs.existsSync(path.join(__dirname, '../.env'))
  ? path.join(__dirname, '../.env')
  : path.join(__dirname, '../../backend/.env');

require('dotenv').config({ path: envPath });

const db = require('../src/config/db');

async function resetLimit() {
  console.log('\n======================================================');
  console.log('🔄 ĐANG XÓA GIỚI HẠN YÊU CẦU QUÊN MẬT KHẨU (RESET RATE LIMIT)');
  console.log('======================================================');

  try {
    const [result] = await db.query('DELETE FROM password_resets');
    console.log(`✅ Đã xóa ${result.affectedRows} bản ghi yêu cầu đặt lại mật khẩu cũ.`);
    console.log('🎉 Giới hạn theo email trong CSDL đã được đặt lại về 0!');
    console.log('👉 Bây giờ bạn có thể thử gửi yêu cầu Quên mật khẩu ngay lập tức.\n');
  } catch (err) {
    console.error('❌ Lỗi khi xóa giới hạn:', err.message);
  } finally {
    await db.end();
    process.exit(0);
  }
}

resetLimit();
