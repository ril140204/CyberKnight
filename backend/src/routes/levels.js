/**
 * PHASE 4 & PHASE B — Level launch endpoint
 *
 * POST /api/levels/:id/launch
 *
 * Luồng:
 * 1. Xác thực Bearer token (auth middleware — gọi từ SPA, không phải iframe)
 * 2. Kiểm tra level tồn tại trong catalog
 * 3. Tính entitlements từ DB (dùng shared in-memory cache <= 60s)
 * 4. Nếu không được phép → 403 LEVEL_LOCKED + danh sách gói cần mua
 * 5. Nếu được phép → tạo cookie levelAccess (JWT httpOnly, thời hạn rút còn 2 giờ)
 *
 * Author: Senior Full-Stack Developer
 */

'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('../middleware/auth');
const {
  levelExists,
  getLevelById,
  getRequiredPackagesForLevel,
  FREE_LEVELS,
} = require('../config/catalog');
const {
  getPlayableLevelsCached,
  invalidateEntitlementCache,
} = require('../utils/entitlementCache');

const router = express.Router();

// ── Rate limiter: ~30 lần / giờ / user ──────────────────────────────
const launchLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 giờ
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user && req.user.id ? String(req.user.id) : req.ip;
  },
  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      error: 'RATE_LIMITED',
      message: 'Bạn đã gọi quá nhiều lần. Vui lòng thử lại sau.',
    });
  },
  validate: { xForwardedForHeader: false },
});

// ── POST /api/levels/:id/launch ─────────────────────────────────────
router.post('/:id/launch', launchLimiter, authMiddleware, async (req, res) => {
  const levelId = Number.parseInt(req.params.id, 10);

  if (Number.isNaN(levelId)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_LEVEL',
      message: 'ID level không hợp lệ.',
    });
  }

  // ── Bước 1: Level không tồn tại → 404 ────────────────────────────
  if (!levelExists(levelId)) {
    return res.status(404).json({
      success: false,
      error: 'LEVEL_NOT_FOUND',
      message: 'Level không tồn tại.',
    });
  }

  // ── Bước 2: Level miễn phí → trả URL trực tiếp (không cần cookie) ─
  if (FREE_LEVELS.includes(levelId)) {
    const level = getLevelById(levelId);
    return res.json({
      success: true,
      url: level.url,
      free: true,
    });
  }

  // ── Bước 3: Lấy entitlements từ DB (dùng cache chung) ────────────
  const uid = req.user.id;
  let playableLevels;
  try {
    playableLevels = await getPlayableLevelsCached(uid);
  } catch (err) {
    console.error('❌ Lỗi query entitlements khi launch level:', err);
    return res.status(503).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Hệ thống đang bận, vui lòng thử lại sau.',
    });
  }

  // ── Bước 4: Kiểm tra quyền chơi ──────────────────────────────────
  if (!playableLevels.includes(levelId)) {
    const requiredPackages = getRequiredPackagesForLevel(levelId);
    return res.status(403).json({
      success: false,
      error: 'LEVEL_LOCKED',
      message: 'Bạn cần mua gói để chơi level này.',
      data: {
        levelId,
        requiredPackages,
      },
    });
  }

  // ── Bước 5: Tạo levelAccess JWT cookie ───────────────────────────
  const levelAccessSecret = process.env.LEVEL_ACCESS_SECRET;
  if (!levelAccessSecret) {
    console.error('❌ LEVEL_ACCESS_SECRET chưa được cấu hình trong .env!');
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Lỗi cấu hình máy chủ. Vui lòng thử lại sau.',
    });
  }

  // Xóa cache của user để đảm bảo quyền luôn đồng bộ
  invalidateEntitlementCache(uid);

  // Build full playableLevels for cookie (include FREE_LEVELS)
  const cookieLevels = FREE_LEVELS.concat(
    playableLevels.filter((l) => !FREE_LEVELS.includes(l))
  );

  const cookiePayload = {
    uid,
    levels: cookieLevels,
  };

  // Rút ngắn thời hạn cookie từ 6 giờ xuống 2 giờ theo tiêu chuẩn Phase B.5
  const cookieToken = jwt.sign(cookiePayload, levelAccessSecret, {
    expiresIn: '2h',
  });

  const isProduction = process.env.NODE_ENV === 'production';
  const level = getLevelById(levelId);

  res.cookie('levelAccess', cookieToken, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isProduction,
    path: '/',
    maxAge: 2 * 60 * 60 * 1000, // 2 giờ
  });

  return res.json({
    success: true,
    url: level.url,
  });
});

module.exports = router;
