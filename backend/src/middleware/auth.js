const jwt = require('jsonwebtoken');

/**
 * Middleware xác thực Bearer Access Token
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Bạn cần đăng nhập để thực hiện thao tác này.',
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id:       decoded.id,
      username: decoded.username,
      level:    decoded.level,
      role:     decoded.role || 'user', // mặc định 'user' nếu token cũ chưa có role
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Phiên làm việc đã hết hạn.',
        expired: true,
      });
    }
    return res.status(403).json({
      success: false,
      message: 'Mã xác thực (Token) không hợp lệ.',
    });
  }
}

module.exports = authMiddleware;
