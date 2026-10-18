/**
 * Script đảm bảo MySQL đã khởi động cho môi trường phát triển cục bộ Windows
 *
 * Tiêu chuẩn an toàn (Phase B.5):
 * - Bỏ qua hoàn toàn (không chạy, không kill tiến trình) khi NODE_ENV=production hoặc không phải win32
 */

'use strict';

const net = require('node:net');
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');

const MYSQL_PORT = Number.parseInt(process.env.DB_PORT, 10) || 3306;
const MYSQL_HOST = process.env.DB_HOST || 'localhost';
const SERVER_PORT = Number.parseInt(process.env.PORT, 10) || 5000;

function freePort(port) {
  if (process.env.NODE_ENV === 'production' || process.platform !== 'win32') {
    return;
  }

  try {
    const output = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes(`:${port}`) && line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && pid !== process.pid.toString()) {
          try {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
            console.log(`🧹 Đã giải phóng cổng ${port} (tiến trình cũ PID ${pid}).`);
          } catch {}
        }
      }
    }
  } catch {}
}

function checkConnection(port, host, timeout = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function ensureMySQL() {
  if (process.env.NODE_ENV === 'production' || process.platform !== 'win32') {
    return;
  }

  // Giải phóng cổng server nếu có tiến trình treo cũ
  freePort(SERVER_PORT);

  const isRunning = await checkConnection(MYSQL_PORT, MYSQL_HOST);
  if (isRunning) {
    console.log(`⚡ [MySQL] Đang chạy trên cổng ${MYSQL_PORT}.`);
    return;
  }

  console.log(`🔍 [MySQL] Chưa bật. Đang tự động khởi động MySQL Server 8.4...`);

  const mysqldPath = String.raw`C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe`;
  const dataDir = String.raw`C:\ProgramData\MySQL\MySQL Server 8.4\Data`;

  if (!fs.existsSync(mysqldPath)) {
    console.warn(`⚠️ Không tìm thấy mysqld.exe tại: ${mysqldPath}`);
    console.warn(`👉 Vui lòng khởi động MySQL thủ công.`);
    return;
  }

  try {
    const child = spawn(mysqldPath, [`--datadir=${dataDir}`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    // Chờ tối đa 8 giây để MySQL khởi động xong
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const connected = await checkConnection(MYSQL_PORT, MYSQL_HOST, 500);
      if (connected) {
        console.log(`✅ [MySQL] Đã tự động khởi động thành công!`);
        return;
      }
    }
    console.warn(`⚠️ Đang khởi động MySQL, server sẽ thử kết nối lại...`);
  } catch (err) {
    console.error(`❌ Không thể tự động khởi động MySQL:`, err.message);
  }
}

ensureMySQL();
