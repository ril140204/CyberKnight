/**
 * Routes cho Catalog
 *
 * Endpoints:
 * - GET /api/catalog/levels   — Danh sách level (public)
 * - GET /api/catalog/packages — Danh sách gói mua (public)
 * - GET /api/catalog/me       — Thông tin user + entitlements (AUTH)
 *
 * Author: Senior Full-Stack Developer
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  getLevelsHandler,
  getPackagesHandler,
  getCatalogMe,
} = require('../controllers/catalogController');

// Public — không cần auth
router.get('/levels', getLevelsHandler);
router.get('/packages', getPackagesHandler);

// Auth required
router.get('/me', auth, getCatalogMe);

module.exports = router;
