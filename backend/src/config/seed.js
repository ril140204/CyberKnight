/**
 * Script seed tài khoản admin mẫu
 * Mật khẩu được hash bằng bcrypt tại thời điểm chạy từ SEED_ADMIN_PASSWORD
 *
 * Tiêu chuẩn bảo mật (Phase B.3):
 * - Dùng biến duy nhất SEED_ADMIN_PASSWORD (hoặc alias ADMIN_PASSWORD)
 * - Tuyệt đối không dùng giá trị dự phòng mặc định (no fallback)
 * - Trong production: bắt buộc >= 12 ký tự, đủ chữ hoa/thường/số/ký tự đặc biệt, không thuộc danh sách yếu
 * - Không in mật khẩu ra log
 * - Chỉ tạo khi chưa có; chỉ đặt lại mật khẩu khi có cờ --reset-admin-password
 */

'use strict';

const path = require('node:path');
const bcrypt = require('bcryptjs');
const pool = require('./db');

// Nạp file .env từ thư mục backend
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const WEAK_PASSWORDS = new Set([
  'admin',
  'admin@123456',
  'password',
  '12345678',
  'admin123',
  'admin123456',
  'password@123',
  'root',
  'administrator',
]);

/**
 * Kiểm tra độ mạnh của mật khẩu admin trong môi trường production
 * @param {string} password
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateAdminPassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, reason: 'Mật khẩu không được để trống' };
  }

  if (password.length < 12) {
    return { valid: false, reason: 'Mật khẩu phải dài tối thiểu 12 ký tự' };
  }

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[^a-zA-Z\d]/.test(password);

  if (!hasLower || !hasUpper || !hasNumber || !hasSpecial) {
    return {
      valid: false,
      reason: 'Mật khẩu phải bao gồm cả chữ thường, chữ hoa, chữ số và ký tự đặc biệt',
    };
  }

  const lowerPwd = password.toLowerCase();
  if (WEAK_PASSWORDS.has(lowerPwd)) {
    return {
      valid: false,
      reason: 'Mật khẩu nằm trong danh sách các mật khẩu yếu phổ biến',
    };
  }

  return { valid: true };
}

async function seedAdmin() {
  const adminPassword = (process.env.SEED_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '').trim();

  if (!adminPassword) {
    console.warn('⚠️ [SEED ADMIN]: Không tìm thấy biến SEED_ADMIN_PASSWORD trong file .env. Bỏ qua khởi tạo tài khoản Admin.');
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    const check = validateAdminPassword(adminPassword);
    if (!check.valid) {
      console.error(`❌ [SEED ADMIN]: Mật khẩu admin không an toàn cho môi trường production: ${check.reason}!`);
      process.exit(1);
    }
  }

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@sigmabloom.vn';
  const adminUsername = 'admin';
  const resetFlag = process.argv.includes('--reset-admin-password') || process.env.RESET_ADMIN_PASSWORD === 'true';

  try {
    const [rows] = await pool.query(
      'SELECT id, role FROM users WHERE email = ? OR username = ?',
      [adminEmail, adminUsername]
    );

    if (rows.length > 0) {
      if (resetFlag) {
        const hashedPassword = await bcrypt.hash(adminPassword, 12);
        await pool.query(
          `UPDATE users
           SET password = ?, role = 'admin', level = 'Admin', points = 9999, is_active = TRUE
           WHERE id = ?`,
          [hashedPassword, rows[0].id]
        );
        console.log('✅ Đã đặt lại mật khẩu tài khoản Admin theo cờ --reset-admin-password.');
      } else {
        console.log('ℹ️ Tài khoản Admin đã tồn tại. Giữ nguyên mật khẩu hiện tại (dùng cờ --reset-admin-password nếu muốn đặt lại).');
      }
    } else {
      const hashedPassword = await bcrypt.hash(adminPassword, 12);
      await pool.query(
        `INSERT INTO users (first_name, last_name, username, email, password, birth_year, level, role, points, is_active)
         VALUES ('Admin', 'Sigmabloom', ?, ?, ?, 2000, 'Admin', 'admin', 9999, TRUE)`,
        [adminUsername, adminEmail, hashedPassword]
      );
      console.log('✅ Đã khởi tạo tài khoản Admin mẫu thành công!');
    }
  } catch (err) {
    console.error('❌ Lỗi seed admin:', err.message);
  }
}

if (require.main === module) {
  seedAdmin()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Lỗi chạy seed admin:', err);
      process.exit(1);
    });
}

module.exports = seedAdmin;
