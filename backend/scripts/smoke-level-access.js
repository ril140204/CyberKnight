/**
 * PHASE 4 — Smoke test cho middleware checkLevelAccess
 * Chạy: node --test backend/scripts/smoke-level-access.js
 *
 * Mock req/res/next để test middleware behavior mà không cần chạy server.
 * Không gọi DB thật — entitlements được mock trực tiếp.
 *
 * Author: Senior Full-Stack Developer
 */

'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const db = require('../src/config/db');

const {
  levelExists,
  userCanPlay,
  getRequiredPackagesForLevel,
  FREE_LEVELS,
} = require('../src/config/catalog');

// ─────────────────────────────────────────────────────────────────────────────
// Smoke test: verify checkLevelAccess factory pattern
// ─────────────────────────────────────────────────────────────────────────────

describe('PHASE 4 — Smoke Test: checkLevelAccess Middleware Factory', () => {

  describe('1. checkLevelAccess là một hàm trả về hàm (middleware factory)', () => {
    it('module export là một function', () => {
      const checkLevelAccess = require('../src/middleware/checkLevelAccess');
      assert.strictEqual(typeof checkLevelAccess, 'function');
    });

    it('checkLevelAccess(1) trả về một async function', () => {
      const checkLevelAccess = require('../src/middleware/checkLevelAccess');
      const middleware = checkLevelAccess(1);
      assert.strictEqual(typeof middleware, 'function');
    });

    it('checkLevelAccess(4) trả về một async function', () => {
      const checkLevelAccess = require('../src/middleware/checkLevelAccess');
      const middleware = checkLevelAccess(4);
      assert.strictEqual(typeof middleware, 'function');
    });

    it('mỗi levelId trả về middleware riêng', () => {
      const checkLevelAccess = require('../src/middleware/checkLevelAccess');
      const m1 = checkLevelAccess(1);
      const m2 = checkLevelAccess(2);
      assert.notStrictEqual(m1, m2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Smoke test: gọi middleware với mock req/res/next thực sự
  // (không dùng DB — test path logic trực tiếp)
  // ─────────────────────────────────────────────────────────────────────────

  describe('2. Middleware gọi next() cho level miễn phí (FREE_LEVELS)', async () => {

    it('level 0: middleware gọi next() ngay lập tức, không cần req.user', async () => {
      const checkLevelAccess = require('../src/middleware/checkLevelAccess');
      const middleware = checkLevelAccess(0);

      let nextCalled = false;
      // Mock đầy đủ interface để middleware không bị lỗi khi gặp exception
      const req = {
        user: null,
        accepts: () => 'json',
        _levelId: 0,
      };
      const res = {
        status(code) { this._status = code; return this; },
        json(data) { this._body = data; return this; },
        type() { return this; },
        send(html) { this._html = html; return this; },
      };
      const next = () => { nextCalled = true; };

      await middleware(req, res, next);

      assert.strictEqual(nextCalled, true, 'next() phải được gọi cho FREE_LEVELS');
      assert.strictEqual(res._status, undefined, 'không set status code cho FREE_LEVELS');
    });

    it('level 0: gọi next() kể cả khi đăng nhập rồi', async () => {
      const checkLevelAccess = require('../src/middleware/checkLevelAccess');
      const middleware = checkLevelAccess(0);

      let nextCalled = false;
      const req = { user: { id: 1, username: 'test' } };
      const res = {
        status(code) { this._status = code; return this; },
        json(data) { this._body = data; return this; },
      };
      const next = () => { nextCalled = true; };

      await middleware(req, res, next);
      assert.strictEqual(nextCalled, true);
    });
  });

  describe('3. Middleware trả 401 khi không đăng nhập (level 1-4)', async () => {

    it('level 1 không đăng nhập → 401 JSON', async () => {
      const checkLevelAccess = require('../src/middleware/checkLevelAccess');
      const middleware = checkLevelAccess(1);

      const req = {
        user: null,
        accepts: () => 'json', // fetch request
      };
      const res = {
        _status: null,
        status(code) { this._status = code; return this; },
        type() { return this; },
        json(data) { this._body = data; return this; },
      };
      const next = () => {};

      await middleware(req, res, next);

      assert.strictEqual(res._status, 401);
      assert.strictEqual(res._body.success, false);
      assert.strictEqual(res._body.error, 'UNAUTHORIZED');
    });

    it('level 4 không đăng nhập → 401 JSON', async () => {
      const checkLevelAccess = require('../src/middleware/checkLevelAccess');
      const middleware = checkLevelAccess(4);

      const req = {
        user: undefined,
        accepts: () => 'json',
      };
      const res = {
        status(code) { this._status = code; return this; },
        type() { return this; },
        json(data) { this._body = data; return this; },
      };

      await middleware(req, res, () => {});

      assert.strictEqual(res._status, 401);
    });
  });

  describe('4. Middleware trả 404 khi level không tồn tại', async () => {

    it('level 99 → 404 JSON', async () => {
      const checkLevelAccess = require('../src/middleware/checkLevelAccess');
      const middleware = checkLevelAccess(99);

      const req = {
        user: { id: 1, username: 'test' },
        accepts: () => 'json',
      };
      const res = {
        status(code) { this._status = code; return this; },
        type() { return this; },
        json(data) { this._body = data; return this; },
      };

      await middleware(req, res, () => {});

      assert.strictEqual(res._status, 404);
      assert.strictEqual(res._body.error, 'LEVEL_NOT_FOUND');
    });
  });

  describe('5. HTML fallback: trả về HTML khi Accept=text/html', async () => {

    it('401 + Accept: text/html → HTML content (string, không phải JSON)', async () => {
      const checkLevelAccess = require('../src/middleware/checkLevelAccess');
      const middleware = checkLevelAccess(1);

      const req = {
        user: null,
        accepts: () => 'html',
      };
      const res = {
        status(code) { this._status = code; return this; },
        type(type) { this._type = type; return this; },
        send(html) { this._html = html; return this; },
      };

      await middleware(req, res, () => {});

      assert.strictEqual(res._status, 401);
      assert.strictEqual(res._type, 'text/html');
      assert.strictEqual(typeof res._html, 'string');
      assert.ok(res._html.length > 50, 'HTML phải có nội dung');
      assert.ok(res._html.includes('Đăng nhập') || res._html.includes('đăng nhập'),
        'HTML phải chứa thông báo đăng nhập');
    });
  });

  describe('6. Pure functions: userCanPlay + getRequiredPackagesForLevel', () => {

    it('userCanPlay(1, null) → false', () => {
      assert.strictEqual(userCanPlay(1, null), false);
    });

    it('userCanPlay(0, null) → true (FREE)', () => {
      assert.strictEqual(userCanPlay(0, null), true);
    });

    it('userCanPlay(1, {premium:true}) → true', () => {
      assert.strictEqual(userCanPlay(1, { premium: true }), true);
    });

    it('getRequiredPackagesForLevel(0) → [] (free)', () => {
      assert.deepStrictEqual(getRequiredPackagesForLevel(0), []);
    });

    it('getRequiredPackagesForLevel(1) → [pack_1_4, premium]', () => {
      assert.deepStrictEqual(getRequiredPackagesForLevel(1), ['pack_1_4', 'premium']);
    });

    it('getRequiredPackagesForLevel(99) → [] (không tồn tại)', () => {
      assert.deepStrictEqual(getRequiredPackagesForLevel(99), []);
    });

    it('levelExists(1) → true', () => {
      assert.strictEqual(levelExists(1), true);
    });

    it('levelExists(99) → false', () => {
      assert.strictEqual(levelExists(99), false);
    });

    it('FREE_LEVELS = [0]', () => {
      assert.deepStrictEqual(FREE_LEVELS, [0]);
    });
  });

  after(async () => {
    // Chờ testConnection() hoàn tất trước khi đóng pool
    await new Promise((r) => setTimeout(r, 200));
    try {
      await db.end();
    } catch (_) {}
  });

});
