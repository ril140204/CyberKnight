const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * Sinh Access Token (15 phút)
 * Payload chứa id, username, level, role
 */
function generateAccessToken(user) {
  return jwt.sign(
    {
      id:       user.id,
      username: user.username,
      level:    user.level || 'Rookie',
      role:     user.role  || 'user',
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
}

/**
 * Sinh Refresh Token (7 ngày hoặc 30 ngày nếu chọn rememberMe)
 * Payload chỉ chứa id và jti (mã định danh duy nhất của token)
 */
function generateRefreshToken(user, jti, rememberMe = false) {
  const expiresIn = rememberMe ? '30d' : (process.env.JWT_REFRESH_EXPIRES_IN || '7d');
  return jwt.sign(
    {
      id: user.id,
      jti: jti || crypto.randomUUID(),
    },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn }
  );
}

/**
 * Băm token bằng SHA-256 để lưu an toàn trong CSDL
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Sinh token ngẫu nhiên ngẫu nhiên 64 ký tự hex
 */
function generateRandomToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  generateRandomToken,
};
