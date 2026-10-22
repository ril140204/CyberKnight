/**
 * Chuyển dữ liệu từ MySQL (sigmabloom cũ) sang PostgreSQL/Supabase (schema DB_SCHEMA)
 *
 * Chạy MỘT LẦN trên máy/VPS còn truy cập được MySQL cũ, SAU KHI đã `npm run setup-db`:
 *
 *   cd backend
 *   MYSQL_HOST=127.0.0.1 MYSQL_USER=root MYSQL_PASSWORD=... MYSQL_DATABASE=sigmabloom \
 *     npm run migrate-data
 *
 *   Tuỳ chọn: --dry-run (chỉ đếm, không ghi)   --truncate (xoá dữ liệu PG trước khi chép)
 *
 * - Giữ nguyên id (để FK orders/entitlements/audit vẫn khớp), sau đó reset sequence.
 * - Idempotent: INSERT ... ON CONFLICT (id) DO NOTHING → chạy lại không nhân đôi dữ liệu.
 * - Cần package mysql2 (đã có trong dependencies).
 */

'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
process.env.DB_SKIP_STARTUP_CHECK = 'true';

const db = require('../src/config/db');

const DRY_RUN = process.argv.includes('--dry-run');
const TRUNCATE = process.argv.includes('--truncate');
const BATCH = 500;
const Q = `"${db.SCHEMA}"`;

// Thứ tự tôn trọng khóa ngoại
const TABLES = [
  {
    name: 'users',
    cols: ['id', 'first_name', 'last_name', 'username', 'email', 'password', 'birth_year', 'level', 'points',
      'avatar_url', 'is_active', 'role', 'failed_login_attempts', 'locked_until', 'created_at', 'updated_at', 'last_login'],
    map: (r) => ({ ...r, is_active: Boolean(r.is_active), role: r.role || 'user', failed_login_attempts: r.failed_login_attempts || 0 }),
  },
  {
    name: 'refresh_tokens',
    cols: ['id', 'user_id', 'token', 'token_hash', 'expires_at', 'user_agent', 'ip_address', 'created_at'],
  },
  {
    name: 'password_resets',
    cols: ['id', 'user_id', 'token_hash', 'expires_at', 'used_at', 'ip_address', 'created_at'],
  },
  {
    name: 'game_saves',
    cols: ['id', 'user_id', 'save_data', 'updated_at'],
    map: (r) => ({ ...r, save_data: typeof r.save_data === 'string' ? r.save_data : JSON.stringify(r.save_data) }),
  },
  {
    name: 'feedbacks',
    cols: ['id', 'user_id', 'name', 'email', 'category', 'message', 'ip', 'user_agent', 'status', 'error_message', 'created_at'],
  },
  {
    name: 'orders',
    cols: ['id', 'order_code', 'user_id', 'package_id', 'amount', 'status', 'payment_method', 'expires_at', 'paid_at', 'created_at'],
  },
  {
    name: 'payment_transactions',
    cols: ['id', 'provider', 'provider_tx_id', 'order_id', 'amount_in', 'content', 'account_number', 'transaction_date',
      'raw_payload', 'match_status', 'created_at'],
    map: (r) => ({ ...r, raw_payload: r.raw_payload == null ? null : (typeof r.raw_payload === 'string' ? r.raw_payload : JSON.stringify(r.raw_payload)) }),
  },
  {
    name: 'user_entitlements',
    cols: ['id', 'user_id', 'package_id', 'order_id', 'source', 'granted_at', 'expires_at'],
  },
  {
    name: 'admin_audit_log',
    cols: ['id', 'admin_id', 'action', 'target_user_id', 'package_id', 'reason', 'created_at'],
  },
];

async function getMysql() {
  let mysql;
  try {
    mysql = require('mysql2/promise');
  } catch {
    throw new Error('Thiếu package mysql2 — chạy: npm install mysql2');
  }
  return mysql.createConnection({
    host: process.env.MYSQL_HOST || process.env.DB_HOST || '127.0.0.1',
    port: Number.parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'sigmabloom',
    charset: 'utf8mb4',
    dateStrings: false,
  });
}

async function copyTable(mysql, pg, t) {
  const [exists] = await mysql.query('SHOW TABLES LIKE ?', [t.name]);
  if (exists.length === 0) {
    console.log(`⏭  ${t.name}: không có trong MySQL — bỏ qua`);
    return;
  }
  // Chỉ lấy cột có thật ở MySQL (các migration cũ có thể thiếu cột)
  const [colsRows] = await mysql.query(`SHOW COLUMNS FROM \`${t.name}\``);
  const have = new Set(colsRows.map((c) => c.Field));
  const cols = t.cols.filter((c) => have.has(c));

  const [rows] = await mysql.query(`SELECT ${cols.map((c) => `\`${c}\``).join(', ')} FROM \`${t.name}\` ORDER BY id`);
  console.log(`📦 ${t.name}: ${rows.length} dòng (cột: ${cols.join(', ')})`);
  if (DRY_RUN || rows.length === 0) return;

  if (TRUNCATE) {
    await pg.query(`TRUNCATE TABLE ${Q}.${t.name} RESTART IDENTITY CASCADE`);
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH).map((r) => (t.map ? t.map(r) : r));
    const values = [];
    const tuples = chunk.map((r, ri) => {
      const ph = cols.map((c, ci) => {
        values.push(r[c] === undefined ? null : r[c]);
        return `$${ri * cols.length + ci + 1}`;
      });
      return `(${ph.join(', ')})`;
    });
    const sql = `INSERT INTO ${Q}.${t.name} (${cols.join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT (id) DO NOTHING`;
    const res = await pg.query(sql, values);
    inserted += res.rowCount;
  }
  // Reset sequence về max(id)
  await pg.query(
    `SELECT setval(pg_get_serial_sequence('${Q}.${t.name}', 'id'), COALESCE((SELECT MAX(id) FROM ${Q}.${t.name}), 0) + 1, false)`
  );
  console.log(`   ✅ đã chèn ${inserted} / ${rows.length} (bỏ qua ${rows.length - inserted} dòng đã tồn tại)`);
}

async function main() {
  console.log(`🚚 MySQL → PostgreSQL (schema ${db.SCHEMA})${DRY_RUN ? ' [DRY-RUN]' : ''}${TRUNCATE ? ' [TRUNCATE]' : ''}`);
  const mysql = await getMysql();
  const pg = await db.pool.connect();
  try {
    await pg.query('BEGIN');
    for (const t of TABLES) {
      await copyTable(mysql, pg, t);
    }
    await pg.query(DRY_RUN ? 'ROLLBACK' : 'COMMIT');
    console.log(DRY_RUN ? '🔍 Dry-run xong (không ghi gì).' : '🎉 Chuyển dữ liệu hoàn tất.');
  } catch (err) {
    await pg.query('ROLLBACK').catch(() => {});
    console.error('❌ Lỗi — đã rollback:', err.message);
    process.exitCode = 1;
  } finally {
    pg.release();
    await mysql.end().catch(() => {});
    await db.end().catch(() => {});
  }
}

main();
