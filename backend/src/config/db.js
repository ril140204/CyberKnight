/**
 * Lớp truy cập PostgreSQL (Supabase) — giữ nguyên API kiểu mysql2 để
 * toàn bộ controller/middleware cũ chạy không cần viết lại:
 *
 *   const [rows] = await db.query('SELECT ... WHERE id = ?', [id]);
 *   const [result] = await db.query('INSERT ...');  // result.insertId, result.affectedRows
 *   const conn = await db.getConnection();          // beginTransaction / commit / rollback / release
 *   await db.end();
 *
 * Những gì lớp này tự xử lý:
 *   - Chuyển placeholder `?` → `$1, $2, ...` (bỏ qua `?` nằm trong chuỗi '...')
 *   - Gắn tên schema (DB_SCHEMA, mặc định "local") vào mọi bảng của ứng dụng,
 *     vì Supabase transaction-mode pooler (port 6543) KHÔNG giữ `SET search_path`
 *     giữa các query → không thể dựa vào search_path của session.
 *   - Tự thêm `RETURNING id` cho INSERT để `result.insertId` hoạt động như MySQL
 *   - BIGINT / NUMERIC trả về Number (thay vì string) để COUNT(*), SUM(), id BIGINT
 *     dùng được như trước
 *   - `affectedRows` = rowCount
 *
 * Cấu hình (.env):
 *   DATABASE_URL  postgresql://user:pass@host:6543/postgres   (runtime — transaction pooler)
 *   DIRECT_URL    postgresql://user:pass@host:5432/postgres   (migration — session pooler)
 *   DB_SCHEMA     local        (schema chứa bảng ứng dụng)
 *   DB_SSL        true|false   (mặc định: bật khi host không phải localhost)
 *   DB_POOL_MAX   10
 *   Hoặc rời rạc: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { Pool, types } = require('pg');

// ── Nạp .env từ backend/.env hoặc .env gốc ────────────────────
const candidatePaths = [
  path.join(__dirname, '../../.env'),     // backend/.env
  path.join(__dirname, '../../../.env'),  // root .env
];
const envPath = candidatePaths.find((p) => fs.existsSync(p)) || candidatePaths[0];
require('dotenv').config({ path: envPath });

// ── Type parsers: BIGINT (int8) & NUMERIC → Number ────────────
// COUNT(*) / SUM() / cột id BIGINT sẽ là Number như mysql2 trả về.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));    // int8
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));  // numeric

const SCHEMA = (process.env.DB_SCHEMA || 'local').trim();
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(SCHEMA)) {
  throw new Error(`DB_SCHEMA không hợp lệ: "${SCHEMA}" (chỉ chữ, số, gạch dưới)`);
}
const QSCHEMA = `"${SCHEMA}"`;

/** Các bảng ứng dụng — mọi tham chiếu sẽ được gắn schema tự động */
const APP_TABLES = [
  'users',
  'refresh_tokens',
  'password_resets',
  'game_saves',
  'feedbacks',
  'orders',
  'payment_transactions',
  'user_entitlements',
  'admin_audit_log',
];

const TABLE_REF_RE = new RegExp(
  `\\b(FROM|JOIN|INTO|UPDATE)\\s+(${APP_TABLES.join('|')})\\b(?!\\s*\\.)`,
  'gi'
);

/**
 * Gắn schema vào tên bảng: FROM users → FROM "local".users
 * @param {string} sql
 */
function qualifyTables(sql) {
  return sql.replace(TABLE_REF_RE, (m, kw, table) => `${kw} ${QSCHEMA}.${table}`);
}

/**
 * Chuyển `?` → `$n`, bỏ qua `?` trong chuỗi ký tự '...'
 * @param {string} sql
 */
function convertPlaceholders(sql) {
  let out = '';
  let n = 0;
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inString) {
      out += ch;
      if (ch === "'") {
        // '' là escape của dấu nháy trong chuỗi
        if (sql[i + 1] === "'") { out += "'"; i++; } else { inString = false; }
      }
      continue;
    }
    if (ch === "'") { inString = true; out += ch; continue; }
    if (ch === '?') { n++; out += `$${n}`; continue; }
    out += ch;
  }
  return out;
}

const INSERT_RE = new RegExp(`^\\s*INSERT\\s+INTO\\s+${QSCHEMA.replace(/"/g, '"')}\\.(${APP_TABLES.join('|')})\\b`, 'i');

/**
 * Biên dịch SQL kiểu MySQL → PostgreSQL
 * @param {string} sql
 */
function compile(sql) {
  let text = convertPlaceholders(qualifyTables(sql));
  if (INSERT_RE.test(text) && !/\bRETURNING\b/i.test(text)) {
    text = `${text.replace(/;\s*$/, '')} RETURNING id`;
  }
  return text;
}

/**
 * Bọc kết quả pg → [rows] theo kiểu mysql2.
 * rows là mảng, đồng thời có thuộc tính affectedRows / insertId / rowCount.
 */
function wrapResult(res) {
  const rows = Array.isArray(res.rows) ? res.rows : [];
  Object.defineProperties(rows, {
    affectedRows: { value: res.rowCount ?? 0, enumerable: false },
    rowCount:     { value: res.rowCount ?? 0, enumerable: false },
    insertId:     { value: rows.length > 0 && rows[0] && rows[0].id !== undefined ? rows[0].id : null, enumerable: false },
    command:      { value: res.command, enumerable: false },
  });
  return [rows, res.fields];
}

/**
 * Kiểm tra lỗi trùng khóa (tương đương ER_DUP_ENTRY của MySQL)
 * @param {any} err
 */
function isDuplicateError(err) {
  return Boolean(err) && (err.code === '23505' || err.code === 'ER_DUP_ENTRY');
}

// ── Cấu hình kết nối ──────────────────────────────────────────
function buildPoolConfig(connectionString) {
  const cfg = {
    max: Number.parseInt(process.env.DB_POOL_MAX || '10', 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'cyberknight',
  };

  let host;
  if (connectionString) {
    cfg.connectionString = connectionString;
    try { host = new URL(connectionString).hostname; } catch { host = ''; }
  } else {
    cfg.host = process.env.DB_HOST || 'localhost';
    cfg.port = Number.parseInt(process.env.DB_PORT || '5432', 10);
    cfg.user = process.env.DB_USER || 'postgres';
    cfg.password = process.env.DB_PASSWORD || '';
    cfg.database = process.env.DB_NAME || 'postgres';
    host = cfg.host;
  }

  const isLocal = /^(localhost|127\.0\.0\.1|::1)$/.test(host || '');
  const sslEnv = (process.env.DB_SSL || '').trim().toLowerCase();
  const useSsl = sslEnv ? sslEnv !== 'false' && sslEnv !== '0' : !isLocal;
  if (useSsl) {
    // Supabase pooler dùng chứng chỉ CA riêng → không verify chain (traffic vẫn mã hóa TLS)
    cfg.ssl = { rejectUnauthorized: false };
  }
  return cfg;
}

const RUNTIME_URL = process.env.DATABASE_URL || process.env.DIRECT_URL || '';
const pool = new Pool(buildPoolConfig(RUNTIME_URL));

pool.on('error', (err) => {
  console.error('❌ [PG Pool] Lỗi kết nối idle client:', err.message);
});

// ── API tương thích mysql2 ────────────────────────────────────

/**
 * @param {string} sql
 * @param {any[]} [params]
 * @returns {Promise<[any[], any]>}
 */
async function query(sql, params = []) {
  const res = await pool.query(compile(sql), params);
  return wrapResult(res);
}

/**
 * Lấy 1 client riêng cho transaction (BEGIN/COMMIT/ROLLBACK).
 */
async function getConnection() {
  const client = await pool.connect();
  let released = false;
  return {
    query: async (sql, params = []) => wrapResult(await client.query(compile(sql), params)),
    beginTransaction: () => client.query('BEGIN'),
    commit: () => client.query('COMMIT'),
    rollback: async () => {
      try { await client.query('ROLLBACK'); } catch { /* không có transaction đang mở */ }
    },
    release: () => {
      if (released) return;
      released = true;
      client.release();
    },
  };
}

async function end() {
  await pool.end();
}

// ── Kiểm tra kết nối khi khởi động (fail-fast) ────────────────
async function testConnection() {
  try {
    const client = await pool.connect();
    try {
      const r = await client.query('SELECT current_database() AS db, current_user AS usr');
      console.log(`✅ Kết nối PostgreSQL thành công (db=${r.rows[0].db}, user=${r.rows[0].usr}, schema=${SCHEMA})`);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('❌ Không thể kết nối PostgreSQL:', err.message);
    console.error('👉 Kiểm tra DATABASE_URL / DIRECT_URL trong file .env (backend/.env).');
    console.error('👉 Chưa có bảng? Chạy: npm run setup-db');
    process.exit(1);
  }
}

if (process.env.DB_SKIP_STARTUP_CHECK !== 'true') {
  void testConnection();
}

module.exports = {
  query,
  getConnection,
  end,
  pool,
  isDuplicateError,
  compile,
  SCHEMA,
  buildPoolConfig,
};
