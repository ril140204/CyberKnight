/**
 * SePay Payment Provider Adapter
 *
 * Interface: { verifyRequest(req), parseTransaction(req) }
 *
 * - Xác thực Apikey bằng crypto.timingSafeEqual chống timing attacks.
 * - Header chuẩn: Authorization: Apikey <KEY>
 * - Từ chối khóa mặc định cũ và không log khóa ra console.
 * - Phân tích payload webhook SePay, trích xuất thông tin giao dịch an toàn.
 *
 * Author: Senior Full-Stack Developer
 */

'use strict';

const crypto = require('node:crypto');

/**
 * Kiểm tra tính hợp lệ của request webhook từ SePay
 * Header chuẩn: Authorization: Apikey <KEY>
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function verifyRequest(req) {
  const expectedKey = (process.env.SEPAY_API_KEY || process.env.PAYMENT_WEBHOOK_SECRET || '').trim();
  if (!expectedKey) {
    console.error('❌ SEPAY_API_KEY chưa được cấu hình trong file .env!');
    return false;
  }

  // Lấy key từ Header Authorization theo chuẩn SePay: "Apikey <KEY>"
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return false;
  }

  if (!authHeader.toLowerCase().startsWith('apikey ')) {
    return false;
  }

  const providedKey = authHeader.slice(7).trim();
  if (!providedKey) {
    return false;
  }

  // Chặn ngay lập tức khóa mặc định cũ nếu ai đó cố gắng sử dụng
  if (providedKey === 'sepay_webhook_secret_key_sigmabloom_2026') {
    console.warn(`⚠️ Từ chối webhook sử dụng khóa dự phòng mặc định cũ từ IP: ${req.ip}`);
    return false;
  }

  const bufExpected = Buffer.from(expectedKey, 'utf8');
  const bufProvided = Buffer.from(providedKey, 'utf8');

  if (bufExpected.length !== bufProvided.length || !crypto.timingSafeEqual(bufExpected, bufProvided)) {
    console.warn(`⚠️ Webhook API Key không hợp lệ từ IP: ${req.ip}`);
    return false;
  }

  return true;
}

/**
 * Phân tích dữ liệu giao dịch từ webhook SePay
 * @param {import('express').Request} req
 * @returns {object}
 */
function parseTransaction(req) {
  const b = req.body || {};

  // Transaction ID: bắt buộc độ dài 1-100 ký tự
  const rawId = b.id != null ? b.id : b.provider_tx_id;
  const id = String(rawId || '').trim();
  if (!id || id.length < 1 || id.length > 100) {
    return {
      error: 'INVALID_TX_ID',
      message: 'Mã giao dịch (transaction id) không hợp lệ (yêu cầu từ 1 đến 100 ký tự).',
    };
  }

  // transferType: bắt buộc là 'in'
  const transferType = String(b.transferType || '').toLowerCase().trim();
  if (transferType !== 'in') {
    return {
      isMoneyIn: false,
      id,
      transferType,
      rawPayload: b,
    };
  }

  // amountIn: phải là số nguyên dương hợp lệ từ 1đ đến 1 tỷ đ
  let rawAmount = b.amountIn;
  if (rawAmount == null) {
    rawAmount = b.transferAmount != null ? b.transferAmount : b.amount_in;
  }
  const amountIn = Number(rawAmount);
  if (!Number.isInteger(amountIn) || amountIn <= 0 || amountIn > 1_000_000_000) {
    return {
      error: 'INVALID_AMOUNT',
      message: 'Số tiền chuyển khoản (amountIn) không hợp lệ.',
    };
  }

  const content = String(b.transactionContent || b.content || b.description || b.body || '').trim();
  const sepayCode = b.code ? String(b.code).trim() : null;
  const accountNumber = String(b.accountNumber || b.account_number || b.subAccount || '').trim();
  const gateway = String(b.gateway || b.provider || 'sepay').trim();
  const transactionDate = b.transactionDate || b.transaction_date || null;

  return {
    provider: 'sepay',
    id,
    gateway,
    amountIn,
    content,
    sepayCode,
    accountNumber,
    transactionDate,
    isMoneyIn: true,
    rawPayload: b,
  };
}

module.exports = {
  verifyRequest,
  parseTransaction,
};
