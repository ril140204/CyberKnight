/**
 * Trạng thái cổng thanh toán — một chỗ duy nhất quyết định có cho tạo đơn / hiện mã QR hay không.
 *
 * Thanh toán bị TẮT khi:
 * - PAYMENTS_ENABLED=false (tắt thủ công), hoặc
 * - BANK_BIN / BANK_ACCOUNT / BANK_NAME còn trống hay vẫn là giá trị giữ chỗ
 *   (số tài khoản toàn số 0, tên "CHUA CAU HINH", "PLACEHOLDER", "CHANGE_ME"...).
 *
 * Lý do: hiện mã QR chuyển khoản tới một tài khoản giả trên tên miền dùng chung (*.herokuapp.com)
 * là dấu hiệu lừa đảo điển hình với các bộ lọc phishing — và người dùng có thể chuyển tiền thật vào đó.
 */

'use strict';

const PLACEHOLDER_NAME = /CHUA\s*CAU\s*HINH|PLACEHOLDER|CHANGE[_\s-]?ME|^X+$/i;

function isPaymentConfigured(env = process.env) {
  if (String(env.PAYMENTS_ENABLED || '').trim().toLowerCase() === 'false') return false;

  const bin = String(env.BANK_BIN || '').trim();
  const account = String(env.BANK_ACCOUNT || '').trim();
  const name = String(env.BANK_NAME || '').trim();

  if (!bin || !account || !name) return false;
  if (/^0+$/.test(account)) return false;
  if (PLACEHOLDER_NAME.test(name)) return false;
  return true;
}

module.exports = { isPaymentConfigured };
