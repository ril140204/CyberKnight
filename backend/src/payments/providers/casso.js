/**
 * Casso Payment Provider Adapter
 *
 * Interface: { verifyRequest(req), parseTransaction(req) }
 */

const crypto = require('crypto');

/**
 * Kiểm tra tính hợp lệ của request webhook từ Casso
 * Header chuẩn: secure-token: <KEY>
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function verifyRequest(req) {
  const expectedKey = (process.env.CASSO_SECURE_TOKEN || process.env.PAYMENT_WEBHOOK_SECRET || '').trim();
  if (!expectedKey) return false;

  const providedKey = String(req.headers['secure-token'] || req.headers['authorization'] || '').trim();
  if (!providedKey) return false;

  const bufExpected = Buffer.from(expectedKey, 'utf8');
  const bufProvided = Buffer.from(providedKey, 'utf8');

  if (bufExpected.length !== bufProvided.length) return false;
  return crypto.timingSafeEqual(bufExpected, bufProvided);
}

/**
 * Phân tích dữ liệu giao dịch từ webhook Casso
 * @param {import('express').Request} req
 * @returns {object}
 */
function parseTransaction(req) {
  const b = req.body || {};
  // Casso thường gửi mảng data: [ { id, amount, description, ... } ] hoặc object đơn
  const dataItem = Array.isArray(b.data) && b.data.length > 0 ? b.data[0] : (b.data || b);

  const id = String(dataItem.id || b.id || '');
  const amountIn = Number(dataItem.amount || b.amount || 0);
  const content = String(dataItem.description || dataItem.content || b.content || '');
  const accountNumber = String(dataItem.accountNumber || b.accountNumber || '');
  const transactionDate = dataItem.when || dataItem.transactionDate || new Date().toISOString();
  const isMoneyIn = amountIn > 0;

  return {
    provider: 'casso',
    id,
    gateway: 'casso',
    amountIn,
    content,
    accountNumber,
    transactionDate,
    isMoneyIn,
    rawPayload: b,
  };
}

module.exports = {
  verifyRequest,
  parseTransaction,
};
