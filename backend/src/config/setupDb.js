/**
 * Migration runner cho PostgreSQL (Supabase)
 * Chạy: npm run setup-db        (trong thư mục backend/)
 *       node src/config/setupDb.js [--no-seed]
 *
 * Luồng:
 *   1. Kết nối bằng DIRECT_URL (session pooler, port 5432) — fallback DATABASE_URL
 *   2. CREATE SCHEMA IF NOT EXISTS "<DB_SCHEMA>"   (mặc định "local")
 *   3. Tạo bảng schema_migrations để ghi nhận file đã chạy
 *   4. Chạy lần lượt backend/migrations/*.sql (theo tên file) chưa được áp dụng,
 *      mỗi file trong 1 transaction với  SET LOCAL search_path TO "<schema>", public
 *   5. Seed tài khoản admin (seed.js) — bỏ qua với --no-seed
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const envPath = fs.existsSync(path.join(__dirname, '../../.env'))
  ? path.join(__dirname, '../../.env')
  : path.join(__dirname, '../../../.env');
require('dotenv').config({ path: envPath });

// Không mở pool runtime khi chỉ chạy migration
process.env.DB_SKIP_STARTUP_CHECK = 'true';
const { buildPoolConfig, SCHEMA } = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');
const QSCHEMA = `"${SCHEMA}"`;

async function runMigrations(client) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${QSCHEMA}`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${QSCHEMA}.schema_migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  const applied = new Set(
    (await client.query(`SELECT filename FROM ${QSCHEMA}.schema_migrations`)).rows.map((r) => r.filename)
  );

  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort((a, b) => a.localeCompare(b))
    : [];

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`⏭  ${file} — đã áp dụng trước đó`);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL search_path TO ${QSCHEMA}, public`);
      await client.query(sql);
      await client.query(`INSERT INTO ${QSCHEMA}.schema_migrations (filename) VALUES ($1)`, [file]);
      await client.query('COMMIT');
      console.log(`✅ Đã áp dụng migration ${file}`);
      ran++;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Migration ${file} thất bại: ${err.message}`);
    }
  }
  return ran;
}

async function setup() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL || '';
  const client = new Client(buildPoolConfig(url));

  try {
    await client.connect();
    const info = await client.query('SELECT current_database() AS db, version() AS v');
    console.log(`✅ Kết nối PostgreSQL thành công (db=${info.rows[0].db}, schema=${SCHEMA})`);
    console.log(`   ${info.rows[0].v.split(',')[0]}`);

    const ran = await runMigrations(client);
    console.log(ran > 0 ? `🎉 Đã chạy ${ran} migration mới.` : 'ℹ️  Schema đã cập nhật, không có migration mới.');
  } catch (err) {
    console.error('❌ Lỗi setup database:', err.message || err);
    if (err.stack && process.env.DEBUG) console.error(err.stack);
    await client.end().catch(() => {});
    process.exit(1);
  }
  await client.end();

  if (!process.argv.includes('--no-seed')) {
    try {
      const seed = require('./seed');
      await seed();
    } catch (seedErr) {
      console.error('⚠️ Không thể seed tài khoản admin:', seedErr.message);
    }
  }

  // Đóng pool runtime (seed.js mở qua db.js)
  try { await require('./db').end(); } catch { /* ignore */ }
  process.exit(0);
}

if (require.main === module) {
  setup();
}

module.exports = { runMigrations };
