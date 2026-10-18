const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getSave, saveGame } = require('../controllers/gameController');

// Tất cả các route game save đều yêu cầu đăng nhập
router.get('/save', auth, getSave);
router.post('/save', auth, saveGame);

module.exports = router;
