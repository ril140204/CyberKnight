#!/usr/bin/env node
/**
 * Script kiểm tra kết nối SMTP & Gmail App Password
 * In kết quả định dạng JSON: { ok: true|false, error: '...' }
 * Chạy: npm run test-smtp
 */
const path = require('path');
const fs = require('fs');

// Tự động tìm nạp file .env từ đúng thư mục backend
const envPath = fs.existsSync(path.join(__dirname, '../.env'))
  ? path.join(__dirname, '../.env')
  : path.join(__dirname, '../../backend/.env');

require('dotenv').config({ path: envPath });

const { createTransporter } = require('../src/utils/mailer');

(async function run() {
  const output = { ok: false, error: null };

  if (!process.env.SMTP_HOST && !process.env.SMTP_URL) {
    output.error = `Chưa cấu hình SMTP trong file .env (${envPath})`;
    console.log(JSON.stringify(output, null, 2));
    process.exit(1);
  }

  let transporter;
  try {
    transporter = createTransporter();
  } catch (initErr) {
    output.error = initErr?.message || String(initErr);
    console.log(JSON.stringify(output, null, 2));
    process.exit(1);
  }

  if (!transporter) {
    output.error = 'Không thể khởi tạo Nodemailer Transporter (thiếu biến môi trường SMTP).';
    console.log(JSON.stringify(output, null, 2));
    process.exit(1);
  }

  try {
    await transporter.verify();
    output.ok = true;
    console.log(JSON.stringify(output, null, 2));
    process.exit(0);
  } catch (err) {
    output.error = err?.message || String(err);
    console.log(JSON.stringify(output, null, 2));
    process.exit(1);
  }
})();
