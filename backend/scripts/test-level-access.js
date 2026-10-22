/**
 * PHASE 4 — Test suite cho level access permission logic
 * Chạy: node --test backend/scripts/test-level-access.js
 *
 * Test các hàm trong catalog.js và logic middleware checkLevelAccess
 *
 * Author: Senior Full-Stack Developer
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  levelExists,
  userCanPlay,
  getRequiredPackagesForLevel,
  getPackages,
  getLevelById,
  FREE_LEVELS,
  LEVELS,
} = require('../src/config/catalog');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Tạo entitlements giả từ package IDs */
function makeEntitlements(packageIds, premium = false) {
  const packages = packageIds.map(pid => ({ packageId: pid, levels: null }));
  return { premium, packages };
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('PHASE 4 — Level Access Permission Logic', () => {

  // ── FREE_LEVELS ─────────────────────────────────────────────────────────────

  describe('FREE_LEVELS', () => {
    it('FREE_LEVELS = [0]', () => {
      assert.deepStrictEqual(FREE_LEVELS, [0]);
    });
  });

  // ── levelExists ────────────────────────────────────────────────────────────

  describe('levelExists()', () => {
    it('level 0 tồn tại', () => assert.strictEqual(levelExists(0), true));
    it('level 1 tồn tại', () => assert.strictEqual(levelExists(1), true));
    it('level 4 tồn tại', () => assert.strictEqual(levelExists(4), true));
    it('level 5 tồn tại', () => assert.strictEqual(levelExists(5), true));
    it('level 99 không tồn tại', () => assert.strictEqual(levelExists(99), false));
    it('level -1 không tồn tại', () => assert.strictEqual(levelExists(-1), false));
  });

  // ── userCanPlay ────────────────────────────────────────────────────────────

  describe('userCanPlay()', () => {

    it('level 0 với entitlements=null → true (FREE)', () => {
      assert.strictEqual(userCanPlay(0, null), true);
    });

    it('level 0 với entitlements=undefined → true (FREE)', () => {
      assert.strictEqual(userCanPlay(0, undefined), true);
    });

    it('level 1 với entitlements=null → false (cần mua)', () => {
      assert.strictEqual(userCanPlay(1, null), false);
    });

    it('level 1 với {premium: true} → true', () => {
      assert.strictEqual(userCanPlay(1, { premium: true }), true);
    });

    it('level 2 với {premium: true} → true', () => {
      assert.strictEqual(userCanPlay(2, { premium: true }), true);
    });

    it('level 4 với {premium: true} → true', () => {
      assert.strictEqual(userCanPlay(4, { premium: true }), true);
    });

    it('level 1 với pack_1_4 → true', () => {
      const ent = { premium: false, packages: [{ packageId: 'pack_1_4', levels: [1,2,3,4] }] };
      assert.strictEqual(userCanPlay(1, ent), true);
    });

    it('level 2 với pack_1_4 → true', () => {
      const ent = { premium: false, packages: [{ packageId: 'pack_1_4', levels: [1,2,3,4] }] };
      assert.strictEqual(userCanPlay(2, ent), true);
    });

    it('level 3 với pack_1_4 → true', () => {
      const ent = { premium: false, packages: [{ packageId: 'pack_1_4', levels: [1,2,3,4] }] };
      assert.strictEqual(userCanPlay(3, ent), true);
    });

    it('level 4 với pack_1_4 → true', () => {
      const ent = { premium: false, packages: [{ packageId: 'pack_1_4', levels: [1,2,3,4] }] };
      assert.strictEqual(userCanPlay(4, ent), true);
    });

    it('level 5 với pack_1_4 → false (level 5 không trong gói)', () => {
      const ent = { premium: false, packages: [{ packageId: 'pack_1_4', levels: [1,2,3,4] }] };
      assert.strictEqual(userCanPlay(5, ent), false);
    });

    it('level 5 với {premium: true} → true', () => {
      assert.strictEqual(userCanPlay(5, { premium: true }), true);
    });

    it('level 5 với pack_5_10 → true (level 5 đã phát hành, nằm trong gói)', () => {
      const ent = { premium: false, packages: [{ packageId: 'pack_5_10', levels: [5,6,7,8,9,10] }] };
      assert.strictEqual(userCanPlay(5, ent), true);
    });

    it('level 99 với premium=true → false (level 99 không tồn tại)', () => {
      assert.strictEqual(userCanPlay(99, { premium: true }), false);
    });

    it('level 2 với playableLevels pre-computed → true', () => {
      const ent = {
        premium: false,
        packages: [{ packageId: 'pack_1_4', levels: [1,2,3,4] }],
        playableLevels: [0, 1, 2, 3, 4]
      };
      assert.strictEqual(userCanPlay(2, ent), true);
    });

    it('level 1 với playableLevels pre-computed → true', () => {
      const ent = {
        premium: false,
        packages: [{ packageId: 'pack_1_4', levels: [1,2,3,4] }],
        playableLevels: [0, 1, 2, 3, 4]
      };
      assert.strictEqual(userCanPlay(1, ent), true);
    });

    it('level 1 với empty entitlements → false', () => {
      assert.strictEqual(userCanPlay(1, { premium: false, packages: [] }), false);
    });

    it('level 99 với null entitlements → false', () => {
      assert.strictEqual(userCanPlay(99, null), false);
    });

    it('level 0 với entitlements không chứa gói nào → true (FREE)', () => {
      assert.strictEqual(userCanPlay(0, { premium: false, packages: [] }), true);
    });

    it('level 6 với pack_5_10 → false (level 6-10 chưa phát hành)', () => {
      const ent = { premium: false, packages: [{ packageId: 'pack_5_10', levels: [5,6,7,8,9,10] }] };
      assert.strictEqual(userCanPlay(6, ent), false);
    });

    it('tất cả level 1-5 đều playable với premium', () => {
      for (let i = 1; i <= 5; i++) {
        assert.strictEqual(userCanPlay(i, { premium: true }), true, `level ${i} với premium phải là true`);
      }
    });

  });

  // ── getRequiredPackagesForLevel ─────────────────────────────────────────────

  describe('getRequiredPackagesForLevel()', () => {

    it('level 0 → [] (free, không cần gói)', () => {
      assert.deepStrictEqual(getRequiredPackagesForLevel(0), []);
    });

    it('level 1 → [pack_1_4, premium] (sắp xếp theo giá tăng dần: 59k < 120k)', () => {
      const result = getRequiredPackagesForLevel(1);
      assert.deepStrictEqual(result, ['pack_1_4', 'premium']);
    });

    it('level 2 → [pack_1_4, premium]', () => {
      const result = getRequiredPackagesForLevel(2);
      assert.deepStrictEqual(result, ['pack_1_4', 'premium']);
    });

    it('level 3 → [pack_1_4, premium]', () => {
      const result = getRequiredPackagesForLevel(3);
      assert.deepStrictEqual(result, ['pack_1_4', 'premium']);
    });

    it('level 4 → [pack_1_4, premium]', () => {
      const result = getRequiredPackagesForLevel(4);
      assert.deepStrictEqual(result, ['pack_1_4', 'premium']);
    });

    it('level 5 → [pack_5_10, premium] (premium cover level 5 vì đã phát hành)', () => {
      const result = getRequiredPackagesForLevel(5);
      assert.deepStrictEqual(result, ['pack_5_10', 'premium']);
    });

    it('level 99 → [] (không tồn tại)', () => {
      assert.deepStrictEqual(getRequiredPackagesForLevel(99), []);
    });

    it('level -1 → [] (không tồn tại)', () => {
      assert.deepStrictEqual(getRequiredPackagesForLevel(-1), []);
    });

    it('requiredPackages luôn chứa premium cho level đã phát hành (1-5)', () => {
      const pkgs = getPackages();
      for (let i = 1; i <= 5; i++) {
        const result = getRequiredPackagesForLevel(i);
        assert.ok(result.includes('premium'), `level ${i} phải bao gồm premium trong requiredPackages`);
        // premium phải luôn đắt hơn hoặc bằng gói khác
        const premiumIdx = result.indexOf('premium');
        assert.ok(premiumIdx > 0, `premium phải ở cuối (sắp xếp theo giá tăng dần)`);
      }
    });

    it('requiredPackages KHÔNG chứa premium cho level chưa phát hành (6-10)', () => {
      for (let i = 6; i <= 10; i++) {
        const result = getRequiredPackagesForLevel(i);
        assert.ok(!result.includes('premium'), `level ${i} chưa phát hành → premium không nên nằm trong requiredPackages`);
      }
    });

  });

  // ── getLevelById ───────────────────────────────────────────────────────────

  describe('getLevelById()', () => {
    it('level 1 → object với title', () => {
      const level = getLevelById(1);
      assert.ok(level);
      assert.strictEqual(level.id, 1);
      assert.ok(typeof level.title === 'string');
      assert.ok(typeof level.url === 'string');
    });

    it('level 99 → null', () => {
      assert.strictEqual(getLevelById(99), null);
    });
  });

  // ── LEVELS consistency ─────────────────────────────────────────────────────

  describe('LEVELS consistency', () => {
    it('LEVELS chứa đúng 6 level (0-5)', () => {
      assert.strictEqual(LEVELS.length, 6);
      const ids = LEVELS.map(l => l.id);
      assert.deepStrictEqual(ids, [0, 1, 2, 3, 4, 5]);
    });
  });

  // ── Integration: requiredPackages + userCanPlay tương thích ─────────────────

  describe('Integration: requiredPackages vs userCanPlay', () => {

    it('Nếu requiredPackages của level chứa gói đã mua → userCanPlay=true', () => {
      const requiredFor1 = getRequiredPackagesForLevel(1);
      assert.ok(requiredFor1.includes('pack_1_4'));

      // User có pack_1_4 → phải được chơi level 1
      const ent = { premium: false, packages: [{ packageId: 'pack_1_4', levels: [1,2,3,4] }] };
      assert.strictEqual(userCanPlay(1, ent), true);
    });

    it('Nếu user không có gói nào trong requiredPackages → userCanPlay=false', () => {
      const requiredFor1 = getRequiredPackagesForLevel(1);
      assert.ok(requiredFor1.includes('pack_1_4'));

      // User chỉ có pack_5_10 → không chơi được level 1
      const ent = { premium: false, packages: [{ packageId: 'pack_5_10', levels: [5,6,7,8,9,10] }] };
      assert.strictEqual(userCanPlay(1, ent), false);
    });

    it('Free level (0) → requiredPackages rỗng + userCanPlay=true với null', () => {
      assert.deepStrictEqual(getRequiredPackagesForLevel(0), []);
      assert.strictEqual(userCanPlay(0, null), true);
    });

  });

});
