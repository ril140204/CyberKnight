/**
 * Script kiểm tra sự tồn tại của các migration files
 * Chạy: node --test backend/scripts/check-migrations.js
 *
 * Kiểm tra:
 * - 002_auth_complete.sql
 * - 003_create_feedbacks.sql
 * - 004_feedback_user_id.sql
 * - 005_payments.sql
 * - 006_user_role.sql
 * - 007_admin_audit_log.sql
 * - 008_user_activity.sql
 */

const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const EXPECTED_MIGRATIONS = [
  '002_auth_complete.sql',
  '003_create_feedbacks.sql',
  '004_feedback_user_id.sql',
  '005_payments.sql',
  '006_user_role.sql',
  '007_admin_audit_log.sql',
  '008_user_activity.sql',
];

describe('Migration files existence check', () => {
  test('Migrations directory exists', () => {
    assert.ok(
      fs.existsSync(MIGRATIONS_DIR),
      `Thư mục migrations không tồn tại: ${MIGRATIONS_DIR}`
    );
  });

  EXPECTED_MIGRATIONS.forEach(filename => {
    test(`${filename} tồn tại`, () => {
      const filepath = path.join(MIGRATIONS_DIR, filename);
      assert.ok(
        fs.existsSync(filepath),
        `Migration file không tồn tại: ${filename}`
      );
    });
  });

  test('Không có file migration trùng tên', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    const names = files.map(f => f.replace(/\.sql$/, ''));

    // Kiểm tra không có prefix trùng nhau (ví dụ 002 và 002_backup)
    const prefixes = names.map(n => n.replace(/_\w+$/, ''));
    const seen = new Set();
    const duplicates = [];
    for (const p of prefixes) {
      if (seen.has(p)) duplicates.push(p);
      seen.add(p);
    }
    assert.deepStrictEqual(duplicates, [], 'Không nên có migration trùng prefix');
  });

  test('Tổng kết: tất cả migration cần thiết đều có mặt', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    const missing = EXPECTED_MIGRATIONS.filter(m => !files.includes(m));

    if (missing.length > 0) {
      console.log('\n❌ Missing migrations:', missing.join(', '));
    }

    assert.deepStrictEqual(missing, [], 'Tất cả migration phải có mặt');
  });
});

describe('Summary', () => {
  test('In ra tóm tắt', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    const present = EXPECTED_MIGRATIONS.filter(m => files.includes(m));
    const summary = present.map(f => f.replace('.sql', '').replace('_', ' ')).join(', ').toUpperCase();
    console.log(`\n✅ Migrations: ${summary} — OK`);
  });
});
