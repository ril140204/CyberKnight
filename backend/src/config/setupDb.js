/**
 * Script tự động tạo database, tạo bảng và chạy migrations
 * Chạy: node src/config/setupDb.js
 */
const mysql2 = require('mysql2/promise');
const fs     = require('fs');
const path   = require('path');
const envPath = fs.existsSync(path.join(__dirname, '../../.env'))
  ? path.join(__dirname, '../../.env')
  : path.join(__dirname, '../.env');
require('dotenv').config({ path: envPath });

async function setup() {
  let conn;
  try {
    // Kết nối không cần chỉ định database
    conn = await mysql2.createConnection({
      host:     process.env.DB_HOST     || 'localhost',
      port:     process.env.DB_PORT     || 3306,
      user:     process.env.DB_USER     || 'root',
      password: process.env.DB_PASSWORD || '',
      multipleStatements: true,
    });

    console.log('✅ Kết nối MySQL thành công!');

    // Đọc và chạy file SQL tạo database gốc
    const sqlFile = path.join(__dirname, '../../database.sql');
    try {
      const sql = fs.readFileSync(sqlFile, 'utf8');
      await conn.query(sql);
      console.log('✅ Đã tạo database gốc và bảng cơ bản!');
    } catch (baseErr) {
      console.log('ℹ️ Database gốc/bảng cơ bản đã tồn tại:', baseErr.message);
    }

    // Đọc và chạy toàn bộ migrations trong thư mục migrations
    const migrationsDir = path.join(__dirname, '../../migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort((a, b) => a.localeCompare(b));
      for (const file of files) {
        try {
          const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
          await conn.query(sql);
          console.log(`✅ Đã áp dụng migration ${file}!`);
        } catch (mErr) {
          console.log(`ℹ️ Migration ${file}:`, mErr.message);
        }
      }
    }

    console.log('🎉 Setup cơ sở dữ liệu hoàn tất!');

  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log('ℹ️ Database/bảng đã tồn tại.');
    } else {
      console.error('❌ Lỗi setup database:', err.message || err);
    if (err.stack) console.error(err.stack);
    }
  } finally {
    if (conn) await conn.end();
  }

  // Tự động chạy seed tài khoản admin
  try {
    const seed = require('./seed');
    await seed();
  } catch (seedErr) {
    console.error('⚠️ Không thể seed tài khoản admin:', seedErr.message);
  }

  process.exit(0);
}

setup();
