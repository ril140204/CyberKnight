/**
 * SIGMABLOOM - Catalog: Level & Package definitions
 * Single source of truth for all level/package data and permission logic.
 *
 * Quy tắc:
 * - Level miễn phí: FREE_LEVELS
 * - Premium user: được chơi TẤT CẢ các level đã phát hành (LEVELS)
 * - Gói mua theo level: chỉ được chơi các level trong gói đó
 * - Tất cả logic kiểm tra quyền chơi phải đi qua các hàm trong file này
 *   (controllers sẽ truyền entitlements object đã tính từ DB)
 *
 * Author: Senior Full-Stack Developer
 */

// ============================================================
// LEVELS — Danh sách level đã phát hành
// ============================================================

// Level miễn phí (không cần mua)
const FREE_LEVELS = [0];

// Danh sách level đã phát hành
const LEVELS = [
  { id: 0, url: '/level0/level0.html', title: 'Hộp Quà Bí Ẩn' },
  { id: 1, url: '/level1/level1.html', title: 'Lớp Trưởng Gửi Link Nhận Quà' },
  { id: 2, url: '/level2/level2.html', title: 'Kết Bạn Online' },
  { id: 3, url: '/level3/level3.html', title: 'Bốn Chìa Khóa Bí Mật' },
  { id: 4, url: '/level4/level4.html', title: 'Bức Ảnh Có Quá Nhiều Bí Mật' },
  // ============================================================
  // Các level 5..10 CHƯA phát hành — để comment hướng dẫn thêm:
  // Khi thêm level mới, chỉ cần thêm object vào mảng LEVELS bên dưới
  // và tạo thư mục levelN/ cùng file levelN.html trong project root.
  //
  // Ví dụ khi phát hành level 5:
  //   { id: 5, url: '/level5/level5.html', title: 'Tên Level Mới' },
  // ============================================================
];

// ============================================================
// PACKAGES — Danh sách gói mua
// ============================================================

const PACKAGES = {
  premium:  { name: 'Premium cá nhân', price: 120000, levels: 'ALL' },
  pack_1_4: { name: 'Gói Level 1–4',    price: 49000,  levels: [1, 2, 3, 4] },
  pack_5_10:{ name: 'Gói Level 5–10',   price: 79000,  levels: [5, 6, 7, 8, 9, 10] },
};

// ============================================================
// HELPER: Kiểm tra level có tồn tại trong LEVELS hay không
// ============================================================

/**
 * Trả về true nếu levelId tồn tại trong mảng LEVELS
 * @param {number} levelId
 * @returns {boolean}
 */
function levelExists(levelId) {
  return LEVELS.some(l => l.id === levelId);
}

// ============================================================
// CORE API
// ============================================================

/**
 * Trả về danh sách toàn bộ LEVELS (defensive copy — không cho caller mutate)
 * @returns {Array<{id: number, url: string, title: string}>}
 */
function getLevels() {
  return LEVELS.map(l => ({ ...l }));
}

/**
 * Trả về danh sách toàn bộ PACKAGES (defensive copy)
 * @returns {Object}
 */
function getPackages() {
  return {
    premium:  { ...PACKAGES.premium },
    pack_1_4: { ...PACKAGES.pack_1_4 },
    pack_5_10:{ ...PACKAGES.pack_5_10 },
  };
}

/**
 * Trả về package theo id, hoặc null nếu không tồn tại
 * @param {string} id
 * @returns {Object|null}
 */
function getPackageById(id) {
  const pkg = PACKAGES[id];
  if (!pkg) return null;
  return { id, ...pkg };
}

/**
 * Trả về level theo id, hoặc null nếu không tồn tại
 * @param {number} id
 * @returns {Object|null}
 */
function getLevelById(id) {
  const level = LEVELS.find(l => l.id === id);
  if (!level) return null;
  return { ...level };
}

/**
 * Trả về danh sách level ID mà một gói bao phủ.
 * Nếu packageId là 'premium' → trả về toàn bộ LEVELS hiện tại (không phải ALL 1..10)
 * @param {string} packageId
 * @returns {number[]|null}
 */
function listPackageLevels(packageId) {
  const pkg = PACKAGES[packageId];
  if (!pkg) return null;

  if (pkg.levels === 'ALL') {
    // Premium bao phủ tất cả level đã phát hành (không fake 5..10)
    return LEVELS.map(l => l.id);
  }

  return [...pkg.levels];
}

// ============================================================
// ENTITLEMENTS — Kiểm tra quyền chơi
// ============================================================

/**
 * Cấu trúc entitlements (tính từ DB ở controller):
 * {
 *   premium: boolean,           // true nếu user có gói premium
 *   packages: [                  // danh sách gói đã mua
 *     { packageId: string, levels: number[]|'ALL' }
 *   ],
 *   playableLevels: number[]     // danh sách levelId user được phép chơi (computed)
 * }
 */

/**
 * Kiểm tra user có được phép chơi level cụ thể hay không.
 * KHÔNG gọi DB — pure function, nhận entitlements đã tính sẵn.
 *
 * Quy tắc:
 * - Level nằm trong FREE_LEVELS → luôn true
 * - User có entitlement.premium === true → true (với mọi level trong LEVELS)
 * - User có gói mua bao phủ levelId → true
 * - Level không tồn tại trong LEVELS → false
 *
 * @param {number} levelId - ID của level cần kiểm tra
 * @param {Object} entitlements - { premium: bool, packages: [{packageId, levels}], playableLevels: [int] }
 * @returns {boolean}
 */
function userCanPlay(levelId, entitlements) {
  // 1. Level không tồn tại → không được chơi
  if (!levelExists(levelId)) return false;

  // 2. Level miễn phí → luôn được chơi
  if (FREE_LEVELS.includes(levelId)) return true;

  // 3. Không có entitlements → không được chơi (user chưa đăng nhập)
  if (!entitlements) return false;

  // 4. Premium → được chơi mọi level đã phát hành
  if (entitlements.premium === true) return true;

  // 5. Kiểm tra gói mua (nếu entitlements chứa playableLevels pre-computed)
  if (Array.isArray(entitlements.playableLevels)) {
    return entitlements.playableLevels.includes(levelId);
  }

  // 6. Fallback: kiểm tra từng gói (cho legacy callers chưa dùng playableLevels)
  if (Array.isArray(entitlements.packages)) {
    return entitlements.packages.some(pkg => {
      if (pkg.levels === 'ALL') return true;
      if (Array.isArray(pkg.levels)) return pkg.levels.includes(levelId);
      return false;
    });
  }

  return false;
}

/**
 * Tính toàn bộ danh sách levelId mà user được phép chơi.
 * Dùng cho Phase 5 / endpoint trả về danh sách level khả dụng.
 *
 * @param {Object} entitlements - { premium: bool, packages: [{packageId, levels}] }
 * @returns {number[]} - Mảng level ID
 */
function computePlayableLevels(entitlements) {
  if (!entitlements) return [...FREE_LEVELS];

  const playable = new Set(FREE_LEVELS);

  if (entitlements.premium === true) {
    // Premium → toàn bộ theoretical range từ listPackageLevels (1..10), plus FREE_LEVELS
    const premiumLevels = listPackageLevels('premium');
    if (premiumLevels) {
      premiumLevels.forEach(lid => playable.add(lid));
    }
    return Array.from(playable).sort((a, b) => a - b);
  }

  if (Array.isArray(entitlements.packages)) {
    entitlements.packages.forEach(pkg => {
      const levels = listPackageLevels(pkg.packageId);
      if (levels) {
        levels.forEach(lid => {
          if (levelExists(lid)) playable.add(lid);
        });
      }
    });
  }

  return Array.from(playable).sort((a, b) => a - b);
}

/**
 * Trả về danh sách package IDs cần thiết để chơi một level.
 * Dùng cho response 403 khi user không có quyền truy cập.
 *
 * @param {number} levelId
 * @returns {string[]} — Mảng packageId, sắp xếp theo giá tăng dần
 */
function getRequiredPackagesForLevel(levelId) {
  // Level không tồn tại (không trong LEVELS) → vẫn kiểm tra xem có gói nào
  // bao phủ levelId hay không (hỗ trợ level chưa phát hành nhưng đã có gói định nghĩa).

  // Nếu level miễn phí → không cần mua gói
  if (FREE_LEVELS.includes(levelId)) return [];

  const pkgs = getPackages();
  const result = [];

  for (const [pkgId, pkg] of Object.entries(pkgs)) {
    const levels = listPackageLevels(pkgId);
    if (levels?.includes(levelId)) {
      result.push({ packageId: pkgId, price: pkg.price });
    }
  }

  // Sắp xếp theo giá tăng dần
  result.sort((a, b) => a.price - b.price);
  return result.map(r => r.packageId);
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  FREE_LEVELS,
  LEVELS,
  PACKAGES,

  getLevels,
  getPackages,
  getPackageById,
  getLevelById,
  listPackageLevels,

  userCanPlay,
  computePlayableLevels,
  levelExists,

  getRequiredPackagesForLevel,
};
