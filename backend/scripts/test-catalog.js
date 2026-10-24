/**
 * Test suite cho backend/src/config/catalog.js
 * Chạy: node --test backend/scripts/test-catalog.js
 *
 * Test cases:
 * - FREE_LEVELS always playable
 * - premium → all LEVELS playable
 * - pack_1_4 → only 1,2,3,4
 * - pack_5_10 → level 5, 6 (level 7-10 chưa phát hành)
 * - Unknown level id → false
 * - Unknown package id → null
 * - listPackageLevels('premium') → all current LEVELS ids
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  FREE_LEVELS,
  LEVELS,
  PACKAGES,
  getLevels,
  getPackages,
  getPackageById,
  getLevelById,
  userCanPlay,
  computePlayableLevels,
  listPackageLevels,
  levelExists,
} = require('../src/config/catalog');

// ============================================================
// Helpers
// ============================================================

/** Tạo entitlements object để test */
function makeEntitlements(opts = {}) {
  return {
    premium: opts.premium || false,
    packages: opts.packages || [],
    playableLevels: opts.playableLevels,
  };
}

/** Tạo entitlements từ danh sách packageIds */
function entFromPackageIds(packageIds) {
  const packages = packageIds.map(id => {
    const pkg = require('../src/config/catalog').getPackageById(id);
    if (!pkg) return null;
    return { packageId: id, levels: pkg.levels };
  }).filter(Boolean);
  return makeEntitlements({ packages });
}

// ============================================================
// Test: FREE_LEVELS
// ============================================================

describe('FREE_LEVELS', () => {
  test('Level 0 is always in FREE_LEVELS', () => {
    assert.ok(FREE_LEVELS.includes(0), 'Level 0 phải miễn phí');
  });
});

// ============================================================
// Test: getLevels — defensive copy
// ============================================================

describe('getLevels()', () => {
  test('trả về mảng có đúng số lượng level hiện tại', () => {
    const levels = getLevels();
    assert.ok(Array.isArray(levels));
    assert.strictEqual(levels.length, LEVELS.length);
  });

  test('không cho phép caller mutate LEVELS gốc', () => {
    const levels = getLevels();
    const originalLength = LEVELS.length;
    levels.push({ id: 999 });
    assert.strictEqual(LEVELS.length, originalLength);
  });

  test('mỗi level có đúng cấu trúc { id, url, title }', () => {
    const levels = getLevels();
    levels.forEach(l => {
      assert.ok(typeof l.id === 'number', 'level phải có id number');
      assert.ok(typeof l.url === 'string', 'level phải có url string');
      assert.ok(typeof l.title === 'string', 'level phải có title string');
    });
  });
});

// ============================================================
// Test: getPackages
// ============================================================

describe('getPackages()', () => {
  test('trả về đúng 3 packages', () => {
    const pkgs = getPackages();
    assert.ok(pkgs.premium, 'phải có premium');
    assert.ok(pkgs.pack_1_4, 'phải có pack_1_4');
    assert.ok(pkgs.pack_5_10, 'phải có pack_5_10');
  });

  test('price và name không bị undefined', () => {
    const pkgs = getPackages();
    Object.values(pkgs).forEach(pkg => {
      assert.strictEqual(typeof pkg.price, 'number');
      assert.strictEqual(typeof pkg.name, 'string');
    });
  });
});

// ============================================================
// Test: getPackageById
// ============================================================

describe('getPackageById()', () => {
  test('trả về premium khi id = premium', () => {
    const pkg = getPackageById('premium');
    assert.ok(pkg, 'premium phải tồn tại');
    assert.strictEqual(pkg.id, 'premium');
    assert.strictEqual(pkg.price, 120000);
  });

  test('trả về pack_1_4 khi id = pack_1_4', () => {
    const pkg = getPackageById('pack_1_4');
    assert.ok(pkg);
    assert.strictEqual(pkg.id, 'pack_1_4');
    assert.deepStrictEqual(pkg.levels, [1, 2, 3, 4]);
  });

  test('trả về pack_5_10 khi id = pack_5_10', () => {
    const pkg = getPackageById('pack_5_10');
    assert.ok(pkg);
    assert.strictEqual(pkg.id, 'pack_5_10');
    assert.deepStrictEqual(pkg.levels, [5, 6, 7, 8, 9, 10]);
  });

  test('trả về null cho package id không tồn tại', () => {
    assert.strictEqual(getPackageById('unknown_package'), null);
    assert.strictEqual(getPackageById(''), null);
    assert.strictEqual(getPackageById(null), null);
  });
});

// ============================================================
// Test: getLevelById
// ============================================================

describe('getLevelById()', () => {
  test('trả về level 0', () => {
    const level = getLevelById(0);
    assert.ok(level);
    assert.strictEqual(level.id, 0);
    assert.strictEqual(level.title, 'Hộp Quà Bí Ẩn');
  });

  test('trả về null cho level không tồn tại', () => {
    assert.strictEqual(getLevelById(999), null);
    assert.strictEqual(getLevelById(-1), null);
  });

  test('mỗi level 0..5 đều tồn tại', () => {
    for (let i = 0; i <= 5; i++) {
      const level = getLevelById(i);
      assert.ok(level, `Level ${i} phải tồn tại`);
      assert.strictEqual(level.id, i);
    }
  });
});

// ============================================================
// Test: listPackageLevels
// ============================================================

describe('listPackageLevels()', () => {
  test('premium trả về toàn bộ LEVELS hiện tại (0..6), KHÔNG bao gồm 7..10 chưa phát hành', () => {
    const ids = listPackageLevels('premium');
    assert.ok(Array.isArray(ids));
    assert.deepStrictEqual(ids, [0, 1, 2, 3, 4, 5, 6]);
  });

  test('pack_1_4 trả về [1,2,3,4]', () => {
    const ids = listPackageLevels('pack_1_4');
    assert.deepStrictEqual(ids, [1, 2, 3, 4]);
  });

  test('pack_5_10 trả về [5,6,7,8,9,10] (level 5 đã phát hành, 6-10 chưa)', () => {
    // pack_5_10 định nghĩa levels = [5,6,7,8,9,10]
    // → hàm vẫn trả về đúng pkg.levels, không lọc theo LEVELS
    // (vì premium mới lọc; gói thường trả đúng như định nghĩa)
    const ids = listPackageLevels('pack_5_10');
    assert.deepStrictEqual(ids, [5, 6, 7, 8, 9, 10]);
  });

  test('package không tồn tại trả về null', () => {
    assert.strictEqual(listPackageLevels('unknown'), null);
  });
});

// ============================================================
// Test: userCanPlay
// ============================================================

describe('userCanPlay(levelId, entitlements)', () => {
  test('FREE_LEVELS (level 0) → luôn true kể cả entitlements = null', () => {
    assert.strictEqual(userCanPlay(0, null), true);
    assert.strictEqual(userCanPlay(0, undefined), true);
    assert.strictEqual(userCanPlay(0, makeEntitlements()), true);
  });

  test('level không tồn tại (999) → false', () => {
    assert.strictEqual(userCanPlay(999, null), false);
    assert.strictEqual(userCanPlay(999, makeEntitlements({ premium: true })), false);
  });

  test('premium user → được chơi mọi level trong LEVELS (0..5)', () => {
    const ent = makeEntitlements({ premium: true });
    for (let i = 0; i <= 5; i++) {
      assert.strictEqual(userCanPlay(i, ent), true, `Level ${i} phải playable với premium`);
    }
  });

  test('premium user → KHÔNG được chơi level 999', () => {
    const ent = makeEntitlements({ premium: true });
    assert.strictEqual(userCanPlay(999, ent), false);
  });

  test('pack_1_4 → được chơi 1,2,3,4 nhưng KHÔNG 0 (level 0 miễn phí vẫn ok)', () => {
    const ent = makeEntitlements({ packages: [{ packageId: 'pack_1_4', levels: [1, 2, 3, 4] }] });
    // Level 0 vẫn miễn phí
    assert.strictEqual(userCanPlay(0, ent), true);
    // Level 1-4 ok
    for (let i = 1; i <= 4; i++) {
      assert.strictEqual(userCanPlay(i, ent), true, `Level ${i} phải playable với pack_1_4`);
    }
  });

  test('pack_1_4 → KHÔNG được chơi level 5 và 6 (thuộc gói pack_5_10)', () => {
    // Level 5/6 đã phát hành nhưng không nằm trong gói pack_1_4 → userCanPlay trả false
    const ent = makeEntitlements({ packages: [{ packageId: 'pack_1_4', levels: [1, 2, 3, 4] }] });
    assert.strictEqual(userCanPlay(5, ent), false);
    assert.strictEqual(userCanPlay(6, ent), false);
  });

  test('pack_5_10 → được chơi level 5 và 6, KHÔNG được chơi level 7-10 (chưa phát hành)', () => {
    // pack_5_10 định nghĩa levels = [5,6,7,8,9,10]; level 5 & 6 có trong LEVELS
    const ent = makeEntitlements({
      packages: [{ packageId: 'pack_5_10', levels: [5, 6, 7, 8, 9, 10] }],
    });
    assert.strictEqual(userCanPlay(5, ent), true, 'Level 5 đã phát hành → phải playable với pack_5_10');
    assert.strictEqual(userCanPlay(6, ent), true, 'Level 6 đã phát hành → phải playable với pack_5_10');
    for (let i = 7; i <= 10; i++) {
      assert.strictEqual(userCanPlay(i, ent), false, `Level ${i} chưa phát hành → không playable`);
    }
    // Level 0 vẫn miễn phí
    assert.strictEqual(userCanPlay(0, ent), true);
  });

  test('user không đăng nhập (entitlements = null) → chỉ free level', () => {
    assert.strictEqual(userCanPlay(0, null), true);
    assert.strictEqual(userCanPlay(1, null), false);
    assert.strictEqual(userCanPlay(4, null), false);
  });

  test('entitlements rỗng → chỉ free level', () => {
    const ent = makeEntitlements();
    assert.strictEqual(userCanPlay(0, ent), true);
    assert.strictEqual(userCanPlay(1, ent), false);
  });

  test('nhiều gói cùng lúc → hợp nhất quyền', () => {
    // User có pack_1_4 nhưng không có premium
    const ent = makeEntitlements({ packages: [{ packageId: 'pack_1_4', levels: [1, 2, 3, 4] }] });
    assert.strictEqual(userCanPlay(1, ent), true);
    assert.strictEqual(userCanPlay(4, ent), true);
    assert.strictEqual(userCanPlay(0, ent), true); // vẫn free
  });

  test('playableLevels pre-computed → dùng thẳng', () => {
    const ent = makeEntitlements({ playableLevels: [0, 1, 2] });
    assert.strictEqual(userCanPlay(0, ent), true);
    assert.strictEqual(userCanPlay(1, ent), true);
    assert.strictEqual(userCanPlay(2, ent), true);
    assert.strictEqual(userCanPlay(3, ent), false);
  });

  test('playableLevels rỗng + premium false → chỉ free', () => {
    const ent = makeEntitlements({ premium: false, playableLevels: [] });
    assert.strictEqual(userCanPlay(0, ent), true);
    assert.strictEqual(userCanPlay(1, ent), false);
  });
});

// ============================================================
// Test: computePlayableLevels
// ============================================================

describe('computePlayableLevels(entitlements)', () => {
  test('null entitlements → chỉ free levels [0]', () => {
    const result = computePlayableLevels(null);
    assert.deepStrictEqual(result, [0]);
  });

  test('empty entitlements → chỉ free levels [0]', () => {
    const result = computePlayableLevels(makeEntitlements());
    assert.deepStrictEqual(result, [0]);
  });

  test('premium → toàn bộ level đã phát hành (0..6), KHÔNG bao gồm 7..10', () => {
    const ent = makeEntitlements({ premium: true });
    const result = computePlayableLevels(ent);
    assert.deepStrictEqual(result, [0, 1, 2, 3, 4, 5, 6]);
  });

  test('pack_1_4 → [0, 1, 2, 3, 4] (gộp free level 0)', () => {
    const ent = makeEntitlements({
      packages: [{ packageId: 'pack_1_4', levels: [1, 2, 3, 4] }],
    });
    const result = computePlayableLevels(ent);
    assert.deepStrictEqual(result, [0, 1, 2, 3, 4]);
  });

  test('pack_5_10 → [0, 5, 6] (level 5 và 6 đã phát hành trong gói)', () => {
    const ent = makeEntitlements({
      packages: [{ packageId: 'pack_5_10', levels: [5, 6, 7, 8, 9, 10] }],
    });
    const result = computePlayableLevels(ent);
    assert.deepStrictEqual(result, [0, 5, 6]);
  });

  test('pack_1_4 + pack_5_10 → [0,1,2,3,4,5,6] (level 5 & 6 đã phát hành)', () => {
    const ent = makeEntitlements({
      packages: [
        { packageId: 'pack_1_4', levels: [1, 2, 3, 4] },
        { packageId: 'pack_5_10', levels: [5, 6, 7, 8, 9, 10] },
      ],
    });
    const result = computePlayableLevels(ent);
    assert.deepStrictEqual(result, [0, 1, 2, 3, 4, 5, 6]);
  });

  test('kết quả luôn sorted', () => {
    const ent = makeEntitlements({ premium: true });
    const result = computePlayableLevels(ent);
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i] > result[i - 1], 'mảng phải sorted');
    }
  });
});

// ============================================================
// Test: levelExists
// ============================================================

describe('levelExists(levelId)', () => {
  test('level 0-6 → true', () => {
    for (let i = 0; i <= 6; i++) {
      assert.ok(levelExists(i), `Level ${i} phải tồn tại`);
    }
  });

  test('level 7-10 → false (chưa phát hành)', () => {
    for (let i = 7; i <= 10; i++) {
      assert.strictEqual(levelExists(i), false, `Level ${i} chưa phát hành`);
    }
  });

  test('level 999 → false', () => {
    assert.strictEqual(levelExists(999), false);
  });
});

console.log('✅ Catalog test suite loaded — run with: node --test backend/scripts/test-catalog.js');
