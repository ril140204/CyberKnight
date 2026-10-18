const db = require('../config/db');

/**
 * GET /api/game/save
 * Lấy file save mới nhất của người dùng từ CSDL
 */
async function getSave(req, res) {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      'SELECT save_data, updated_at FROM game_saves WHERE user_id = ?',
      [userId]
    );

    if (rows.length === 0) {
      return res.json({
        success: true,
        saveData: null,
      });
    }

    let saveData = rows[0].save_data;
    if (typeof saveData === 'string') {
      try {
        saveData = JSON.parse(saveData);
      } catch (e) {
        // Giữ nguyên nếu là đối tượng rồi
      }
    }

    return res.json({
      success: true,
      saveData,
      updatedAt: rows[0].updated_at,
    });

  } catch (err) {
    console.error('❌ Lỗi getSave game:', err);
    return res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy tiến trình game.',
    });
  }
}

/**
 * POST /api/game/save
 * Lưu tiến trình game (upsert)
 */
async function saveGame(req, res) {
  const { saveData } = req.body;
  if (!saveData || typeof saveData !== 'object') {
    return res.status(400).json({
      success: false,
      message: 'Dữ liệu lưu không hợp lệ.',
    });
  }

  try {
    const userId = req.user.id;
    const jsonString = JSON.stringify(saveData);

    await db.query(
      `INSERT INTO game_saves (user_id, save_data)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE save_data = VALUES(save_data), updated_at = CURRENT_TIMESTAMP`,
      [userId, jsonString]
    );

    return res.json({
      success: true,
      message: 'Đã đồng bộ tiến trình game thành công!',
    });

  } catch (err) {
    console.error('❌ Lỗi saveGame:', err);
    return res.status(500).json({
      success: false,
      message: 'Không thể lưu tiến trình game vào CSDL.',
    });
  }
}

module.exports = {
  getSave,
  saveGame,
};
