/**
 * CyberKnight / Sigmabloom - Safe HTML & Anti-XSS Utilities (assets/safe.js)
 *
 * Cung cấp các tiện ích xử lý chuỗi an toàn, chống lỗ hổng Stored XSS và DOM XSS:
 * - escapeHtml(value): Chuyển đổi các ký tự HTML nguy hiểm (&, <, >, ", ', `) thành HTML entities.
 * - isAllowedQrUrl(url): Kiểm tra whitelist domain cho ảnh mã QR ngân hàng.
 * - safeText(value, fallback): Trả về chuỗi an toàn, thay thế null/undefined bằng fallback.
 */

(function (root) {
  'use strict';

  /**
   * Escape toàn bộ các ký tự đặc biệt nguy hiểm trong HTML.
   * Xử lý an toàn null, undefined, số, boolean và chuỗi.
   *
   * @param {any} value - Giá trị cần escape
   * @returns {string} Chuỗi đã được mã hóa an toàn
   */
  function escapeHtml(value) {
    if (value === null || value === undefined) {
      return '';
    }
    const str = String(value);
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/`/g, '&#96;');
  }

  /**
   * Kiểm tra URL ảnh mã QR xem có thuộc danh sách domain được phép (VietQR) hay không.
   * Chỉ chấp nhận giao thức HTTPS và các hostname tin cậy.
   *
   * @param {string} url - URL cần kiểm tra
   * @returns {boolean} true nếu URL an toàn
   */
  function isAllowedQrUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return false;
      const allowedHosts = [
        'img.vietqr.io',
        'api.vietqr.io',
      ];
      return allowedHosts.includes(parsed.hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  /**
   * Lấy text an toàn kèm giá trị fallback
   *
   * @param {any} value
   * @param {string} fallback
   * @returns {string}
   */
  function safeText(value, fallback = '') {
    if (value === null || value === undefined || value === '') {
      return escapeHtml(fallback);
    }
    return escapeHtml(value);
  }

  const CyberSafe = {
    escapeHtml,
    isAllowedQrUrl,
    safeText,
  };

  // Gắn trực tiếp lên global/window
  if (typeof window !== 'undefined') {
    window.escapeHtml = escapeHtml;
    window.isAllowedQrUrl = isAllowedQrUrl;
    window.CyberSafe = CyberSafe;
  }

  // Hỗ trợ môi trường Node.js cho các test script
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CyberSafe;
  }
})(typeof window !== 'undefined' ? window : globalThis);
