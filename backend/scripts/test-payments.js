/**
 * Test suite cho backend/src/utils/orderCode.js
 *
 * Chạy: node --test backend/scripts/test-payments.js
 *
 * Các test case:
 * 1. generateOrderCode() trả về string bắt đầu 'CK', độ dài 10
 * 2. Không có ký tự confusable (0, O, 1, I, L)
 * 3. extractOrderCode('CKABC23XY something else') → 'CKABC23XY'
 * 4. extractOrderCode('no code here') → null


 * 5. extractOrderCode('CK1L2O3XY') → null (confusable chars)
 * 6. 1000 mã được sinh đều unique
 *
 * Author: Senior Full-Stack Developer
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');

// Import module đang test
const {
  generateOrderCode,
  extractOrderCode,
  isValidOrderCode,
} = require('../src/utils/orderCode');

const CONFUSABLE = new Set(['0', 'O', 'o', '1', 'I', 'i', 'L', 'l']);

describe('generateOrderCode', () => {
  test('trả về string bắt đầu với CK', () => {
    const code = generateOrderCode();
    assert.ok(code.startsWith('CK'), `Expected starts with CK, got: ${code}`);
  });

  test('trả về độ dài 10 ký tự', () => {
    const code = generateOrderCode();
    assert.strictEqual(code.length, 10, `Expected length 10, got: ${code}`);
  });

  test('không chứa ký tự confusable 0, O, 1, I, L', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateOrderCode();
      for (const char of code) {
        assert.ok(
          !CONFUSABLE.has(char),
          `Ký tự confusable '${char}' trong mã: ${code}`
        );
      }
    }
  });

  test('phần sau prefix CK chỉ chứa ký tự từ bảng alphabet', () => {
    const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 50; i++) {
      const code = generateOrderCode();
      const suffix = code.slice(2); // bỏ CK
      for (const char of suffix) {
        assert.ok(
          ALPHABET.includes(char),
          `Ký tự '${char}' không nằm trong alphabet cho mã: ${code}`
        );
      }
    }
  });

  test('1000 mã được sinh đều unique', () => {
    const set = new Set();
    for (let i = 0; i < 1000; i++) {
      const code = generateOrderCode();
      assert.ok(!set.has(code), `Trùng lặp phát hiện ở lần thứ ${i}: ${code}`);
      set.add(code);
    }
    assert.strictEqual(set.size, 1000, 'Tất cả 1000 mã phải unique');
  });
});

describe('extractOrderCode', () => {
  test('trả về mã khi có trong chuỗi', () => {
    assert.strictEqual(extractOrderCode('CKABC23XYZ something else'), 'CKABC23XYZ');
  });

  test('trả về null khi không có mã', () => {
    assert.strictEqual(extractOrderCode('no code here'), null);
  });

  test('trả về null khi có confusable chars', () => {
    // CK1L2O3XYZ chứa 1, L, O → không hợp lệ
    assert.strictEqual(extractOrderCode('CK1L2O3XYZ'), null);
  });

  test('trả về null khi null/undefined', () => {
    assert.strictEqual(extractOrderCode(null), null);
    assert.strictEqual(extractOrderCode(undefined), null);
    assert.strictEqual(extractOrderCode(''), null);
  });

  test('trả về null khi chuỗi ngắn hơn 10 ký tự', () => {
    assert.strictEqual(extractOrderCode('CKABC'), null);
  });

  test('trả về mã đầu tiên nếu có nhiều mã', () => {
    assert.strictEqual(
      extractOrderCode('Thanh toán CKABC23XYZ roi ma CKDEF45ZZZ con nua'),
      'CKABC23XYZ'
    );
  });

  test('hoạt động với mã toàn số phía sau', () => {
    assert.strictEqual(extractOrderCode('Ma CKAB234567 thanh toan'), 'CKAB234567');
  });

  test('hoạt động với mã toàn chữ phía sau', () => {
    assert.strictEqual(extractOrderCode('Ma CKXYWZMNAB thanh toan'), 'CKXYWZMNAB');
  });

  test('hoạt động với số thấp nhất trong alphabet (2)', () => {
    assert.strictEqual(extractOrderCode('CKAA222222'), 'CKAA222222');
  });

  test('hoạt động với số cao nhất trong alphabet (9)', () => {
    assert.strictEqual(extractOrderCode('CKAA999999'), 'CKAA999999');
  });

  test('KHÔNG match prefix không đủ độ dài', () => {
    // CKABCDEFGH = 10 ký tự → hợp lệ (prefix CK 2 + 8 = 10)
    assert.strictEqual(extractOrderCode('CKABCDEFGH'), 'CKABCDEFGH');
    // CKABCDEFG = 9 ký tự → không đủ
    assert.strictEqual(extractOrderCode('CKABCDEFG'), null);
  });
});

describe('isValidOrderCode', () => {
  test('trả về true cho mã hợp lệ', () => {
    assert.strictEqual(isValidOrderCode('CKABC23XYZ'), true);
    assert.strictEqual(isValidOrderCode('CKXYWZMNAB'), true);
    assert.strictEqual(isValidOrderCode('CKAA222222'), true);
  });

  test('trả về false cho mã có confusable chars', () => {
    assert.strictEqual(isValidOrderCode('CK1L2O3XYZ'), false);
    assert.strictEqual(isValidOrderCode('CKO123456'), false);
    assert.strictEqual(isValidOrderCode('CKABCDEFG0'), false); // Chứa số 0 confusable
  });

  test('trả về false cho mã ngắn', () => {
    assert.strictEqual(isValidOrderCode('CKABC'), false);
    assert.strictEqual(isValidOrderCode('CK'), false);
    assert.strictEqual(isValidOrderCode(''), false);
    assert.strictEqual(isValidOrderCode(null), false);
    assert.strictEqual(isValidOrderCode(undefined), false);
  });

  test('trả về false cho mã không bắt đầu CK', () => {
    assert.strictEqual(isValidOrderCode('XXABC23XY'), false);
    assert.strictEqual(isValidOrderCode('ABCDEFGH'), false);
  });
});

describe('Integration: sinh và đọc round-trip', () => {
  test('mã sinh ra có thể extract lại chính nó', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOrderCode();
      const extracted = extractOrderCode(code);
      assert.strictEqual(
        extracted,
        code,
        `Round-trip thất bại: sinh=${code}, extract=${extracted}`
      );
    }
  });

  test('mã sinh ra hợp lệ với isValidOrderCode', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOrderCode();
      assert.ok(
        isValidOrderCode(code),
        `isValidOrderCode false cho mã: ${code}`
      );
    }
  });
});
