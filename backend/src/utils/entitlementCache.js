/**
 * Shared In-Memory Entitlement Cache for Level Guard
 * TTL: 60 seconds
 *
 * Cung cấp cache quyền chơi level và hàm xóa cache tức thì (invalidateEntitlementCache)
 * khi người dùng mua gói thành công hoặc admin cấp/thu hồi/đối soát quyền.
 */

'use strict';

const db = require('../config/db');
const { computePlayableLevels } = require('../config/catalog');
const { buildEntitlements } = require('../controllers/catalogController');

const entitlementCache = new Map();
const CACHE_TTL_MS = 60_000; // 60 giây

/**
 * Lấy danh sách level có thể chơi từ cache hoặc truy vấn DB
 * @param {number|string} uid
 * @returns {Promise<number[]>}
 */
async function getPlayableLevelsCached(uid) {
  const numUid = Number(uid);
  const cached = entitlementCache.get(numUid);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    return cached.playableLevels;
  }

  const [rows] = await db.query(
    `SELECT package_id, expires_at
     FROM user_entitlements
     WHERE user_id = ?
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [numUid]
  );

  const entitlements = buildEntitlements(rows);
  const playableLevels = computePlayableLevels(entitlements);

  entitlementCache.set(numUid, { timestamp: Date.now(), playableLevels });
  return playableLevels;
}

/**
 * Xóa cache quyền chơi của user để quyền mới có hiệu lực ngay lập tức
 * @param {number|string|null} [uid]
 */
function invalidateEntitlementCache(uid) {
  if (uid != null) {
    entitlementCache.delete(Number(uid));
  } else {
    entitlementCache.clear();
  }
}

module.exports = {
  getPlayableLevelsCached,
  invalidateEntitlementCache,
};
