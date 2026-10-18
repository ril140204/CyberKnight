/**
 * Middleware xử lý lỗi tập trung cho toàn ứng dụng
 * Production: KHÔNG bao giờ leak err.message hoặc err.stack
 */
function errorHandler(err, req, res, _next) {
  console.error('❌ Lỗi chưa được xử lý (Unhandled Error):', err);

  const statusCode = err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';

  const response = {
    success: false,
    // Chỉ dùng isOperational + production-safe message; KHÔNG leak err.message ở prod
    message: (err.isOperational && !isProd)
      ? err.message
      : 'Đã xảy ra lỗi máy chủ.',
  };

  if (!isProd) {
    response.error = err.message; // dev: gửi error message
    if (err.stack) response.stack = err.stack; // dev: gửi stack trace
  }

  return res.status(statusCode).json(response);
}

module.exports = errorHandler;
