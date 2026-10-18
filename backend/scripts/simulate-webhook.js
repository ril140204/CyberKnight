/**
 * Script giả lập SePay gửi webhook thanh toán tới máy chủ CyberKnight
 *
 * Cách chạy:
 *   node backend/scripts/simulate-webhook.js <MÃ_ĐƠN> [SỐ_TIỀN] [TX_ID]
 *
 * Ví dụ:
 *   node backend/scripts/simulate-webhook.js CKABCDEF23 120000
 */

'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');

// Cấu hình dotenv nạp biến môi trường
const envPath = fs.existsSync(path.join(__dirname, '../.env'))
  ? path.join(__dirname, '../.env')
  : path.join(__dirname, '../../.env');
require('dotenv').config({ path: envPath });

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';
const API_KEY = (process.env.SEPAY_API_KEY || process.env.PAYMENT_WEBHOOK_SECRET || 'sepay_webhook_secret_key_sigmabloom_2026').trim();

const args = process.argv.slice(2);
const orderCode = args[0] || 'CKDEMO1234';
const rawAmount = String(args[1] || '').replace(/[.,\s]/g, '');
const amount = parseInt(rawAmount, 10) || 120000;
const txId = args[2] || Math.floor(10000000 + Math.random() * 90000000);

const payload = {
  id: txId,
  gateway: 'Vietcombank',
  transactionDate: new Date().toISOString().replace('T', ' ').substring(0, 19),
  accountNumber: process.env.BANK_ACCOUNT || '1234567890',
  subAccount: null,
  amountIn: amount,
  amountOut: 0,
  accumulated: 10000000,
  code: null,
  transactionContent: `Chuyen khoan thanh toan khoa hoc CyberKnight ${orderCode}`,
  referenceNumber: 'FT26' + Math.floor(Math.random() * 1000000),
  body: null,
  transferType: 'in',
};

console.log('\n======================================================');
console.log('📡 GIẢ LẬP SEPAY WEBHOOK');
console.log(`🔗 Endpoint: ${BASE_URL}/api/payments/webhook/sepay`);
console.log(`🏷️  Mã đơn:   ${orderCode}`);
console.log(`💰 Số tiền:  ${amount.toLocaleString('vi-VN')} VNĐ`);
console.log(`🆔 Tx ID:    ${txId}`);
console.log(`🔑 API Key:  ${API_KEY ? '(Đã cấu hình)' : '⚠️ CHƯA CÓ TRONG .ENV'}`);
console.log('======================================================\n');

const url = new URL('/api/payments/webhook/sepay', BASE_URL);
const bodyStr = JSON.stringify(payload);

const req = http.request({
  hostname: url.hostname,
  port: url.port || 80,
  path: url.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Apikey ${API_KEY}`,
    'Content-Length': Buffer.byteLength(bodyStr),
  },
}, (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    console.log(`📥 Phản hồi từ Server: HTTP ${res.statusCode}`);
    try {
      console.log('📄 Body:', JSON.stringify(JSON.parse(data), null, 2));
    } catch {
      console.log('📄 Body:', data);
    }
  });
});

req.on('error', (err) => {
  console.error('❌ Lỗi kết nối tới server:', err.message);
});

req.write(bodyStr);
req.end();
