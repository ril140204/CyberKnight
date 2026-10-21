/**
 * Startup Environment & Security Validation (Phase B.4 & D.1)
 *
 * Kiểm tra các biến môi trường bắt buộc khi khởi động:
 * - Production Fail-Fast:
 *   + JWT_SECRET, JWT_REFRESH_SECRET, LEVEL_ACCESS_SECRET >= 32 ký tự, không chứa chuỗi yếu, không trùng nhau
 *   + SEPAY_API_KEY không được để trống
 *   + BANK_BIN, BANK_ACCOUNT, BANK_NAME không được để trống
 *   + DATABASE_URL (PostgreSQL) không được để trống
 *   + FRONTEND_URL phải là https://
 *   + SEED_ADMIN_PASSWORD nếu có phải đủ mạnh (>= 12 ký tự, đủ 4 loại ký tự, không trong danh sách yếu)
 * - Development:
 *   + Cảnh báo nếu secret quá ngắn hoặc dùng placeholder mặc định
 *
 * Author: Senior Full-Stack Developer
 */

'use strict';

const { isPaymentConfigured } = require('../utils/paymentConfig');

const WEAK_SECRET_SUBSTRINGS = ['change_this', 'secret_key', 'super_secret', 'cyberknight_'];
const WEAK_ADMIN_PASSWORDS = new Set([
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

function validateSecretKey(name, val, errors) {
  if (!val || val.length < 32) {
    errors.push(`${name} phải được cấu hình và dài tối thiểu 32 ký tự trong production.`);
    return;
  }
  const lower = val.toLowerCase();
  if (WEAK_SECRET_SUBSTRINGS.some((sub) => lower.includes(sub))) {
    errors.push(`${name} chứa chuỗi mẫu yếu không an toàn (không được chứa các từ: ${WEAK_SECRET_SUBSTRINGS.join(', ')}).`);
  }
}

function checkUniqueSecrets(jwtSecret, refreshSecret, levelSecret, errors) {
  if (jwtSecret && refreshSecret && levelSecret) {
    const uniqueSecrets = new Set([jwtSecret, refreshSecret, levelSecret]);
    if (uniqueSecrets.size !== 3) {
      errors.push('JWT_SECRET, JWT_REFRESH_SECRET và LEVEL_ACCESS_SECRET phải là 3 chuỗi bí mật hoàn toàn khác biệt nhau.');
    }
  }
}

function validateProductionSecrets(env, errors) {
  const jwtSecret = (env.JWT_SECRET || '').trim();
  const refreshSecret = (env.JWT_REFRESH_SECRET || '').trim();
  const levelSecret = (env.LEVEL_ACCESS_SECRET || '').trim();

  validateSecretKey('JWT_SECRET', jwtSecret, errors);
  validateSecretKey('JWT_REFRESH_SECRET', refreshSecret, errors);
  validateSecretKey('LEVEL_ACCESS_SECRET', levelSecret, errors);

  checkUniqueSecrets(jwtSecret, refreshSecret, levelSecret, errors);
}

function validateProductionBanking(env, errors) {
  const sepayKey = (env.SEPAY_API_KEY || '').trim();
  if (!sepayKey) {
    errors.push('SEPAY_API_KEY là bắt buộc trong production để nhận diện webhook.');
  }

  if (!env.BANK_BIN || !env.BANK_ACCOUNT || !env.BANK_NAME) {
    errors.push('Cấu hình ngân hàng (BANK_BIN, BANK_ACCOUNT, BANK_NAME) không được để trống.');
  }
}

function validateProductionDbAndUrl(env, errors) {
  if (!env.DATABASE_URL && !env.DB_PASSWORD) {
    errors.push('DATABASE_URL (hoặc DB_PASSWORD) không được để trống trong môi trường production.');
  }

  const frontendUrl = (env.FRONTEND_URL || '').trim();
  if (!frontendUrl?.startsWith('https://')) {
    errors.push(`FRONTEND_URL phải bắt đầu bằng https:// trong production (hiện tại: "${frontendUrl || '(trống)'}").`);
  }
}

function validateAdminSeedPassword(adminPwd, errors) {
  if (!adminPwd) return;

  if (adminPwd.length < 12) {
    errors.push('SEED_ADMIN_PASSWORD phải dài tối thiểu 12 ký tự trong production.');
    return;
  }

  const hasLower = /[a-z]/.test(adminPwd);
  const hasUpper = /[A-Z]/.test(adminPwd);
  const hasNumber = /\d/.test(adminPwd);
  const hasSpecial = /[^a-zA-Z\d]/.test(adminPwd);

  if (!hasLower || !hasUpper || !hasNumber || !hasSpecial) {
    errors.push('SEED_ADMIN_PASSWORD phải bao gồm cả chữ thường, chữ hoa, số và ký tự đặc biệt.');
  }

  if (WEAK_ADMIN_PASSWORDS.has(adminPwd.toLowerCase())) {
    errors.push('SEED_ADMIN_PASSWORD không được nằm trong danh sách các mật khẩu yếu phổ biến.');
  }
}

function checkDevelopmentWarnings(env, warnings) {
  const jwtSecret = (env.JWT_SECRET || '').trim();
  const levelSecret = (env.LEVEL_ACCESS_SECRET || '').trim();

  if (!jwtSecret || jwtSecret.length < 32 || jwtSecret.includes('change_this')) {
    warnings.push('JWT_SECRET đang dùng khóa mặc định hoặc ngắn hơn 32 ký tự.');
  }
  if (!levelSecret || levelSecret.length < 32) {
    warnings.push('LEVEL_ACCESS_SECRET chưa cấu hình hoặc ngắn hơn 32 ký tự.');
  }
}

/**
 * Kiểm tra cấu hình môi trường
 * @param {object} [env=process.env]
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateConfig(env = process.env) {
  const isProduction = env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];

  if (isProduction) {
    validateProductionSecrets(env, errors);
    validateProductionBanking(env, errors);
    validateProductionDbAndUrl(env, errors);
    if (!isPaymentConfigured(env)) {
      warnings.push('Thanh toán đang TẮT: BANK_* còn giá trị giữ chỗ hoặc PAYMENTS_ENABLED=false — nút mua gói bị khoá.');
    }

    const adminPwd = (env.SEED_ADMIN_PASSWORD || env.ADMIN_PASSWORD || '').trim();
    validateAdminSeedPassword(adminPwd, errors);
  } else {
    checkDevelopmentWarnings(env, warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Thực thi kiểm tra cấu hình khi server khởi động
 * @param {object} [env=process.env]
 */
function validateStartupConfig(env = process.env) {
  const result = validateConfig(env);

  if (result.warnings.length > 0) {
    console.warn('\x1b[33m%s\x1b[0m', '⚠️  CẢNH BÁO CẤU HÌNH:');
    result.warnings.forEach((w) => console.warn(`   • ${w}`));
  }

  if (!result.valid) {
    console.error('\x1b[31m%s\x1b[0m', '❌ LỖI BẢO MẬT KHỞI ĐỘNG (FAIL-FAST):');
    result.errors.forEach((e) => console.error(`   • ${e}`));
    if (env.NODE_ENV === 'production') {
      console.error('\x1b[31m%s\x1b[0m', '🛑 Máy chủ từ chối khởi động vì không đáp ứng tiêu chuẩn an toàn production!');
      process.exit(1);
    }
  }
}

module.exports = {
  validateConfig,
  validateStartupConfig,
};
