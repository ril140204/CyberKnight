/**
 * Tiện ích tạo URL VietQR động theo chuẩn Napas 247
 */

/**
 * Sinh URL hình ảnh mã QR VietQR động
 * @param {object} params
 * @param {string} params.bin - Mã BIN ngân hàng (ví dụ 970436 cho Vietcombank)
 * @param {string} params.account - Số tài khoản nhận tiền
 * @param {number} params.amount - Số tiền (VND)
 * @param {string} params.orderCode - Mã đơn hàng (nội dung chuyển khoản)
 * @param {string} params.accountName - Tên chủ tài khoản
 * @returns {string} URL hình ảnh VietQR
 */
function buildQrUrl({ bin, account, amount, orderCode, accountName }) {
  const safeBin = String(bin || process.env.BANK_BIN || '970436').trim();
  const safeAccount = String(account || process.env.BANK_ACCOUNT || '').trim();
  const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
  const safeContent = encodeURIComponent(String(orderCode || '').trim());
  const safeName = encodeURIComponent(String(accountName || process.env.BANK_NAME || '').trim());

  // Template compact2 chuẩn từ img.vietqr.io
  return `https://img.vietqr.io/image/${safeBin}-${safeAccount}-compact2.png?amount=${safeAmount}&addInfo=${safeContent}&accountName=${safeName}`;
}

module.exports = {
  buildQrUrl,
};
