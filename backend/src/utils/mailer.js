const nodemailer = require('nodemailer');

/**
 * Khởi tạo Nodemailer transporter từ biến môi trường
 */
function createTransporter() {
  if (!process.env.SMTP_HOST && !process.env.SMTP_USER) {
    return null; // Không có cấu hình SMTP -> fallback dev mode
  }

  if (process.env.SMTP_URL) {
    return nodemailer.createTransport(process.env.SMTP_URL);
  }

  const host = process.env.SMTP_HOST || '';
  const user = process.env.SMTP_USER || '';

  // Ưu tiên service: 'gmail' khi dùng Gmail để đạt độ ổn định và tỷ lệ gửi vào Inbox cao nhất
  if (host.includes('gmail.com') || user.endsWith('@gmail.com')) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const isSecure = String(process.env.SMTP_PORT) === '465' || port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure: isSecure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Gửi email đặt lại mật khẩu với giao diện CyberKnight
 */
async function sendResetPasswordEmail(toEmail, username, resetToken) {
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5000').replace(/\/$/, '');
  const resetLink = `${frontendUrl}/reset-password.html?token=${resetToken}`;

  console.log(`\n======================================================`);
  console.log(`🔑 [DEV EMAIL RESET LINK] Gửi tới: ${toEmail}`);
  console.log(`👉 Link đặt lại mật khẩu (hết hạn sau 15 phút):`);
  console.log(`   ${resetLink}`);
  console.log(`======================================================\n`);

  const transporter = createTransporter();
  if (!transporter) {
    // Không có SMTP -> Trả về link để controller dùng trong dev mode nếu cần
    return { sent: false, devLink: resetLink };
  }

  const htmlContent = `
  <!DOCTYPE html>
  <html lang="vi">
  <head>
    <meta charset="UTF-8">
    <style>
      body { font-family: Arial, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
      .container { max-width: 560px; margin: 0 auto; background: #1e293b; border-radius: 16px; border: 1px solid #334155; overflow: hidden; }
      .header { background: linear-gradient(135deg, #00d4ff, #8b5cf6); padding: 30px; text-align: center; }
      .header h1 { color: #ffffff; margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 1px; }
      .content { padding: 30px; line-height: 1.6; color: #cbd5e1; }
      .btn { display: inline-block; background: linear-gradient(90deg, #00d4ff, #0055ff); color: #ffffff !important; padding: 14px 28px; text-decoration: none; border-radius: 12px; font-weight: bold; margin: 20px 0; text-align: center; }
      .footer { background: #0f172a; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #334155; }
      .warning { background: #334155; padding: 12px; border-radius: 8px; font-size: 13px; color: #f1f5f9; margin-top: 15px; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>🛡️ CyberKnight Shield</h1>
      </div>
      <div class="content">
        <h2>Chào ${username || 'CyberKnight'},</h2>
        <p>Chúng mình nhận được yêu cầu đặt lại mật khẩu cho tài khoản CyberKnight của bạn.</p>
        <p>Bấm vào nút dưới đây để thiết lập mật khẩu mới nhé:</p>
        <div style="text-align: center;">
          <a href="${resetLink}" class="btn">🔑 Đặt lại mật khẩu ngay</a>
        </div>
        <div class="warning">
          ⏰ <strong>Lưu ý:</strong> Link này sẽ tự động hết hạn sau <strong>15 phút</strong>.
        </div>
        <p style="margin-top: 20px; font-size: 13px; color: #94a3b8;">Nếu bạn không yêu cầu đổi mật khẩu, hãy yên tâm bỏ qua email này. Tài khoản của bạn vẫn an toàn tuyệt đối!</p>
      </div>
      <div class="footer">
        © 2026 Sigmabloom CyberKnight - Trang web giáo dục an toàn mạng cho trẻ em Việt Nam.
      </div>
    </div>
  </body>
  </html>
  `;

  const textFallback = `Chào ${username || 'CyberKnight'},\n\n` +
    `Chúng mình nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.\n` +
    `Hãy truy cập đường link sau để đổi mật khẩu (hết hạn sau 15 phút):\n\n` +
    `${resetLink}\n\n` +
    `Nếu bạn không yêu cầu thay đổi, hãy bỏ qua email này.\n`;

  try {
    // Verify connection & credentials before sending so failures surface early
    try {
      await transporter.verify();
    } catch (vErr) {
      console.error('❌ SMTP verify failed:', vErr && vErr.message ? vErr.message : vErr);
      return { sent: false, devLink: resetLink, error: String(vErr && vErr.message ? vErr.message : vErr) };
    }

    await transporter.sendMail({
      from: process.env.SMTP_FROM || '"CyberKnight Shield" <no-reply@sigmabloom.vn>',
      to: toEmail,
      subject: '🛡️ Đặt lại mật khẩu tài khoản CyberKnight',
      text: textFallback,
      html: htmlContent,
    });
    return { sent: true, devLink: resetLink };
  } catch (err) {
    console.error('❌ Lỗi gửi email reset password:', err.message);
    return { sent: false, devLink: resetLink, error: err.message };
  }
}

/**
 * Gửi email thông báo đổi mật khẩu thành công
 */
async function sendPasswordChangedEmail(toEmail, username) {
  const transporter = createTransporter();
  if (!transporter) return;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || '"CyberKnight Shield" <no-reply@sigmabloom.vn>',
      to: toEmail,
      subject: '🛡️ Mật khẩu CyberKnight của bạn đã được thay đổi',
      text: `Chào ${username},\n\nMật khẩu tài khoản CyberKnight của bạn vừa được thay đổi thành công. Nếu bạn không thực hiện việc này, hãy liên hệ ngay với ban quản trị!`,
    });
  } catch (err) {
    console.error('❌ Lỗi gửi email thông báo đổi mật khẩu:', err.message);
  }
}

/**
 * Gửi email thông báo kích hoạt gói dịch vụ thành công
 */
async function sendPackageActivatedEmail(toEmail, username, order, packageInfo) {
  const transporter = createTransporter();
  const packageName = packageInfo?.name || order.package_id;
  const amountStr = Number(order.amount).toLocaleString('vi-VN');

  console.log(`\n======================================================`);
  console.log(`🎉 [KÍCH HOẠT GÓI] Gửi email xác nhận tới: ${toEmail}`);
  console.log(`📦 Gói: ${packageName} - Số tiền: ${amountStr} đ - Mã đơn: ${order.order_code}`);
  console.log(`======================================================\n`);

  if (!transporter) return;

  const htmlContent = `
  <!DOCTYPE html>
  <html lang="vi">
  <head>
    <meta charset="UTF-8">
    <style>
      body { font-family: Arial, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
      .container { max-width: 560px; margin: 0 auto; background: #1e293b; border-radius: 16px; border: 1px solid #334155; overflow: hidden; }
      .header { background: linear-gradient(135deg, #10b981, #06b6d4); padding: 30px; text-align: center; }
      .header h1 { color: #ffffff; margin: 0; font-size: 24px; text-transform: uppercase; }
      .content { padding: 30px; line-height: 1.6; color: #cbd5e1; }
      .card { background: #0f172a; padding: 16px; border-radius: 12px; border: 1px solid #334155; margin: 20px 0; }
      .btn { display: inline-block; background: linear-gradient(90deg, #00d4ff, #0055ff); color: #ffffff !important; padding: 14px 28px; text-decoration: none; border-radius: 12px; font-weight: bold; margin: 20px 0; text-align: center; }
      .footer { background: #0f172a; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #334155; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>🎉 Kích Hoạt Thành Công!</h1>
      </div>
      <div class="content">
        <h2>Chúc mừng ${username || 'Hiệp sĩ CyberKnight'},</h2>
        <p>Đơn hàng của bạn đã được thanh toán thành công. Toàn bộ quyền lợi của gói học tập đã được mở khóa vĩnh viễn trên tài khoản của bạn!</p>
        <div class="card">
          <p><strong>📦 Gói dịch vụ:</strong> ${packageName}</p>
          <p><strong>🏷️ Mã đơn hàng:</strong> <code style="color:#00d4ff">${order.order_code}</code></p>
          <p><strong>💰 Số tiền:</strong> ${amountStr} VNĐ</p>
          <p><strong>⏰ Thời hạn sử dụng:</strong> Vĩnh viễn (Không giới hạn)</p>
        </div>
        <div style="text-align: center;">
          <a href="${(process.env.FRONTEND_URL || 'http://localhost:5000').replace(/\/$/, '')}/" class="btn">🚀 Bắt Đầu Học & Chơi Ngay</a>
        </div>
      </div>
      <div class="footer">
        © 2026 Sigmabloom CyberKnight — Giáo dục an toàn mạng cho trẻ em Việt Nam.
      </div>
    </div>
  </body>
  </html>
  `;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || '"CyberKnight Shield" <no-reply@sigmabloom.vn>',
      to: toEmail,
      subject: `🛡️ Chúc mừng! Gói "${packageName}" của bạn đã được kích hoạt thành công`,
      html: htmlContent,
      text: `Chúc mừng ${username || 'Hiệp sĩ CyberKnight'}!\n\nĐơn hàng ${order.order_code} (${packageName}) đã được thanh toán thành công và mở khóa vĩnh viễn. Chúc bạn có những giờ học bổ ích và thú vị cùng CyberKnight!`,
    });
  } catch (err) {
    console.error('❌ Lỗi gửi email kích hoạt gói:', err.message);
  }
}

module.exports = {
  createTransporter,
  sendResetPasswordEmail,
  sendPasswordChangedEmail,
  sendPackageActivatedEmail,
};
