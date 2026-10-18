/**
 * Tiện ích sinh và đọc mã đơn hàng (Order Code)
 *
 * Format: CK + 8 ký tự từ bảng chữ cái LOẠI TRỪ confusable chars:
 *   0, O, 1, I, L → không dùng
 *
 * Bảng chữ cái an toàn: ABCDEFGHJKLMNPQRSTUVWXYZ23456789
 * Độ dài mã: 10 ký tự (CK = 2 prefix + 8 chars)
 *
 * Author: Senior Full-Stack Developer
 */

// Bảng chữ cái không chứa ký tự dễ nhầm lẫn (0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ALPHABET_LEN = ALPHABET.length; // 30
const PREFIX = 'CK';
const CODE_LENGTH = 8; // độ dài phần random
const TOTAL_LENGTH = PREFIX.length + CODE_LENGTH; // 10

/**
 * Sinh một mã đơn hàng ngẫu nhiên
 * @returns {string} Mã đơn hàng dạng 'CKABC12345'
 */
function generateOrderCode() {
  let result = PREFIX;
  const array = new Uint32Array(CODE_LENGTH);
  // Dùng crypto.getRandomValues để lấy random chất lượng cao
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(array);
  } else {
    // Fallback cho môi trường test không có crypto
    for (let i = 0; i < CODE_LENGTH; i++) {
      array[i] = Math.floor(Math.random() * 0xFFFFFFFF);
    }
  }
  for (let i = 0; i < CODE_LENGTH; i++) {
    result += ALPHABET[array[i] % ALPHABET_LEN];
  }
  return result;
}

/**
 * Trích xuất mã đơn hàng từ nội dung (ví dụ nội dung chuyển khoản)
 * @param {string} content - Chuỗi cần tìm mã
 * @returns {string|null} Mã đơn hàng nếu tìm thấy, null nếu không
 */
function extractOrderCode(content) {
  if (!content || typeof content !== 'string') return null;
  // Regex: CK + 8 ký tự từ bảng an toàn (không chứa 0,O, 1,I, L)
  // [A-H] = A..H (bỏ I)
  // [JK]  = J, K (bỏ L)
  // [MN]  = M, N (bỏ O)
  // [P-Z] = P..Z
  // [2-9] = 2..9
  const match = content.match(/CK[A-HJKMNP-Z2-9]{8}/i);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Kiểm tra mã đơn hàng có hợp lệ hay không
 * @param {string} code
 * @returns {boolean}
 */
function isValidOrderCode(code) {
  if (!code || typeof code !== 'string') return false;
  return /^CK[A-HJKMNP-Z2-9]{8}$/i.test(code);
}

module.exports = {
  generateOrderCode,
  extractOrderCode,
  isValidOrderCode,
  ALPHABET,
  CODE_LENGTH,
  TOTAL_LENGTH,
};
