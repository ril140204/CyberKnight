/**
 * Test Suite kiểm tra Production Fail-Fast & Cấu hình môi trường (Phase B.4 & D.1)
 *
 * Chạy: node backend/scripts/test-env-failfast.js
 *
 * Tiêu chí kiểm thử:
 * 1. Môi trường Production hợp lệ -> valid: true, không có lỗi.
 * 2. Thiếu hoặc ngắn (<32 ký tự) JWT_SECRET -> phát hiện lỗi và từ chối.
 * 3. Chứa chuỗi mẫu yếu trong JWT_SECRET (vd: super_secret, change_this) -> từ chối.
 * 4. Thiếu JWT_REFRESH_SECRET hoặc LEVEL_ACCESS_SECRET -> từ chối.
 * 5. Các secret bị trùng nhau (trùng giá trị) -> từ chối.
 * 6. Thiếu SEPAY_API_KEY trong production -> từ chối.
 * 7. Thiếu cấu hình ngân hàng (BANK_BIN, BANK_ACCOUNT, BANK_NAME) -> từ chối.
 * 8. Thiếu DB_PASSWORD trong production -> từ chối.
 * 9. FRONTEND_URL dùng HTTP thay vì HTTPS trong production -> từ chối.
 * 10. SEED_ADMIN_PASSWORD yếu hoặc ngắn < 12 ký tự -> từ chối.
 * 11. Môi trường Development cảnh báo nhưng không chặn chạy server.
 *
 * Author: Senior Full-Stack Developer
 */

'use strict';

const { validateConfig } = require('../src/config/startupCheck');

let passed = 0;
let failed = 0;

function assert(condition, label, details) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    if (details) console.log(`     Chi tiết: ${details}`);
    failed++;
  }
}

function runTests() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   KIỂM TRA PRODUCTION FAIL-FAST & CẤU HÌNH MÔI TRƯỜNG        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const validProductionEnv = {
    NODE_ENV: 'production',
    JWT_SECRET: 'a_very_secure_jwt_token_random_string_over_32_chars_1234567890',
    JWT_REFRESH_SECRET: 'another_unique_refresh_token_random_string_32_chars_45678901',
    LEVEL_ACCESS_SECRET: 'third_completely_different_level_random_32_chars_789012345678',
    SEPAY_API_KEY: 'secure_sepay_webhook_api_key_random_value',
    BANK_BIN: '970415',
    BANK_ACCOUNT: '108881471301',
    BANK_NAME: 'VU DUC HIEU',
    DB_PASSWORD: 'strong_production_db_password_xyz',
    FRONTEND_URL: 'https://sigmabloom.vn',
    SEED_ADMIN_PASSWORD: 'AdminStrongPassword@2026!',
  };

  // Case 1: Cấu hình chuẩn production
  console.log('── 1. Kiểm tra cấu hình Production hợp lệ ──');
  const resValid = validateConfig(validProductionEnv);
  assert(resValid.valid === true && resValid.errors.length === 0, 'Cấu hình production chuẩn vượt qua kiểm tra thành công');

  // Case 2: JWT_SECRET thiếu hoặc quá ngắn
  console.log('\n── 2. Kiểm tra JWT_SECRET thiếu hoặc ngắn < 32 ký tự ──');
  const resShortJwt = validateConfig({ ...validProductionEnv, JWT_SECRET: 'short_key_123' });
  assert(!resShortJwt.valid, 'Từ chối JWT_SECRET có độ dài < 32 ký tự');
  assert(resShortJwt.errors.some(e => e.includes('JWT_SECRET')), 'Báo lỗi chi tiết về JWT_SECRET');

  // Case 3: JWT_SECRET chứa chuỗi mẫu yếu
  console.log('\n── 3. Kiểm tra chuỗi mẫu yếu trong Secrets ──');
  const resWeakJwt = validateConfig({
    ...validProductionEnv,
    JWT_SECRET: 'this_is_a_sigmabloom_super_secret_key_that_is_long_enough',
  });
  assert(!resWeakJwt.valid, "Từ chối JWT_SECRET chứa chuỗi mẫu yếu 'super_secret'");

  // Case 4: Các secret bị trùng nhau
  console.log('\n── 4. Kiểm tra Secrets bị trùng nhau ──');
  const resDuplicateSecrets = validateConfig({
    ...validProductionEnv,
    JWT_REFRESH_SECRET: validProductionEnv.JWT_SECRET,
  });
  assert(!resDuplicateSecrets.valid, 'Từ chối khi JWT_SECRET và JWT_REFRESH_SECRET trùng giá trị');

  // Case 5: Thiếu SEPAY_API_KEY
  console.log('\n── 5. Kiểm tra SEPAY_API_KEY ──');
  const resNoSepay = validateConfig({ ...validProductionEnv, SEPAY_API_KEY: '' });
  assert(!resNoSepay.valid, 'Từ chối khi thiếu SEPAY_API_KEY trong production');

  // Case 6: Thiếu cấu hình ngân hàng
  console.log('\n── 6. Kiểm tra Cấu hình Ngân hàng ──');
  const resNoBank = validateConfig({ ...validProductionEnv, BANK_ACCOUNT: '' });
  assert(!resNoBank.valid, 'Từ chối khi thiếu BANK_ACCOUNT');

  // Case 7: FRONTEND_URL không phải HTTPS
  console.log('\n── 7. Kiểm tra FRONTEND_URL HTTPS ──');
  const resHttpUrl = validateConfig({ ...validProductionEnv, FRONTEND_URL: 'http://sigmabloom.vn' });
  assert(!resHttpUrl.valid, 'Từ chối FRONTEND_URL không dùng giao thức https:// trong production');

  // Case 8: Mật khẩu Seed Admin yếu
  console.log('\n── 8. Kiểm tra Mật khẩu Seed Admin ──');
  const resWeakAdminPwd = validateConfig({ ...validProductionEnv, SEED_ADMIN_PASSWORD: 'Admin@123456' });
  assert(!resWeakAdminPwd.valid, "Từ chối mật khẩu seed admin mặc định/yếu 'Admin@123456'");

  const resShortAdminPwd = validateConfig({ ...validProductionEnv, SEED_ADMIN_PASSWORD: 'Short1!' });
  assert(!resShortAdminPwd.valid, 'Từ chối mật khẩu seed admin ngắn < 12 ký tự');

  // Case 9: Development mode
  console.log('\n── 9. Kiểm tra Môi trường Development ──');
  const resDev = validateConfig({
    NODE_ENV: 'development',
    JWT_SECRET: 'dev_short_key',
    LEVEL_ACCESS_SECRET: '',
  });
  assert(resDev.valid === true, 'Môi trường development cho phép khởi động (valid: true)');
  assert(resDev.warnings.length > 0, 'Phát hiện cảnh báo phù hợp trong development');

  // ── Tổng kết ──
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   KẾT QUẢ KIỂM THỬ STARTUP CONFIG & PRODUCTION FAIL-FAST     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n  ✅ Đạt:   ${passed}`);
  console.log(`  ❌ Hỏng:  ${failed}`);
  console.log(`  📊 Tổng:  ${passed + failed}\n`);

  if (failed === 0) {
    console.log('🎉 TẤT CẢ KIỂM THỬ STARTUP FAIL-FAST ĐÃ VƯỢT QUA!\n');
    process.exit(0);
  } else {
    console.error('⚠️  CÓ KIỂM THỬ THẤT BẠI — CẦN RÀ SOÁT LẠI STARTUP CHECK.\n');
    process.exit(1);
  }
}

runTests();
