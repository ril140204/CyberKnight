// ============================================================
// CyberKnight / Sigmabloom — Cấu hình PM2 Production
//
// Cách dùng:
//   npm install -g pm2
//   pm2 start deploy/ecosystem.config.js
//   pm2 save && pm2 startup
//
// Lưu ý: KHÔNG dùng "npm start" vì prestart chạy ensure-mysql.js
//         (script dành riêng cho Windows dev, không phù hợp production Linux).
// ============================================================

const path = require('node:path');

// Project root: thư mục cha của deploy/
const root = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'cyberknight',
      // Entry: backend/src/server.js (từ cwd backend/)
      script: 'src/server.js',
      // cwd phải là thư mục backend/ để require() đúng path
      cwd: path.join(root, 'backend'),
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      // Tự khởi động lại khi dùng quá 300MB RAM
      max_memory_restart: '300M',

      // Log: logs/ tại project root
      out_file: path.join(root, 'logs', 'cyberknight-out.log'),
      error_file: path.join(root, 'logs', 'cyberknight-error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Tự động restart khi crash
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,

      // Không theo dõi file thay đổi ở production
      watch: false,
    },
  ],
};
