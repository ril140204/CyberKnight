/**
 * Tiện ích tạo URL VietQR động theo chuẩn Napas 247
 */

// Tên ngắn của ngân hàng theo mã BIN Napas (hiển thị trong modal thanh toán)
const BANK_NAMES_BY_BIN = {
  '970415': 'VietinBank',
  '970416': 'ACB',
  '970418': 'BIDV',
  '970422': 'MB Bank',
  '970423': 'TPBank',
  '970432': 'VPBank',
  '970436': 'Vietcombank',
  '970403': 'Sacombank',
  '970407': 'Techcombank',
  '970426': 'MSB',
  '970448': 'OCB',
  '970425': 'ABBANK',
  '970452': 'KienlongBank',
};

/**
 * Trả về tên ngắn của ngân hàng theo mã BIN (rỗng nếu không biết)
 * @param {string} [bin]
 * @returns {string}
 */
function getBankShortName(bin) {
  return BANK_NAMES_BY_BIN[String(bin || process.env.BANK_BIN || '').trim()] || '';
}

/**
 * Nội dung chuyển khoản cho một đơn hàng.
 * Một số ngân hàng qua SePay (ví dụ VietinBank) chỉ ghi nhận giao dịch có tiền tố "SEVQR",
 * nên cho phép cấu hình tiền tố qua QR_CONTENT_PREFIX. Webhook vẫn tìm mã CK... ở bất kỳ vị trí nào.
 * @param {string} orderCode
 * @returns {string} Ví dụ: "SEVQR CKABC12345" hoặc "CKABC12345"
 */
function buildTransferContent(orderCode) {
  const code = String(orderCode || '').trim();
  const prefix = String(process.env.QR_CONTENT_PREFIX || '').trim();
  return prefix ? `${prefix} ${code}` : code;
}

/**
 * Sinh URL hình ảnh mã QR VietQR động
 * @param {object} params
 * @param {string} params.bin - Mã BIN ngân hàng (ví dụ 970436 cho Vietcombank)
 * @param {string} params.account - Số tài khoản nhận tiền
 * @param {number} params.amount - Số tiền (VND)
 * @param {string} params.orderCode - Mã đơn hàng (nội dung chuyển khoản, đã gồm tiền tố nếu có)
 * @param {string} params.accountName - Tên chủ tài khoản
 * @returns {string} URL hình ảnh VietQR
 */
function buildQrUrl({ bin, account, amount, orderCode, accountName }) {
  const safeBin = String(bin || process.env.BANK_BIN || '970436').trim();
  const safeAccount = String(account || process.env.BANK_ACCOUNT || '').trim();
  const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
  const safeContent = encodeURIComponent(buildTransferContent(orderCode));
  const safeName = encodeURIComponent(String(accountName || process.env.BANK_NAME || '').trim());

  // Template compact2 chuẩn từ img.vietqr.io
  return `https://img.vietqr.io/image/${safeBin}-${safeAccount}-compact2.png?amount=${safeAmount}&addInfo=${safeContent}&accountName=${safeName}`;
}

module.exports = {
  buildQrUrl,
  buildTransferContent,
  getBankShortName,
};
