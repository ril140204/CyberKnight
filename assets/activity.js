/**
 * CyberKnight / Sigmabloom — Activity Tracker (assets/activity.js)
 *
 * Gửi "heartbeat" mỗi 30 giây tới POST /api/me/activity/heartbeat để máy chủ
 * tự tính TỔNG THỜI GIAN ONLINE. Client KHÔNG gửi thời lượng — chỉ báo "còn sống".
 *
 * Nguyên tắc bảo vệ dữ liệu trẻ em:
 *   - KHÔNG đăng nhập  → KHÔNG gửi gì, KHÔNG lưu gì cả.
 *   - Chỉ gửi khi: đã đăng nhập + tab đang hiển thị (visibilityState = 'visible')
 *     + có tương tác thật trong 5 phút gần nhất (bỏ qua máy bị bỏ quên).
 *   - Không lưu token vào localStorage; chỉ dùng token đang có trong RAM.
 *
 * API công khai: window.CyberActivity = { start(), stop() }
 *
 * Tương thích CSP: file này được nạp bằng <script src>, KHÔNG dùng innerHTML
 * hay onclick inline.
 */
(function (window) {
  'use strict';

  // ── Cấu hình ────────────────────────────────────────────────────────
  const HEARTBEAT_INTERVAL_MS = 30_000;  // Nhịp gửi: 30 giây
  const IDLE_TIMEOUT_MS = 5 * 60_000;    // Không tương tác 5 phút → ngừng gửi
  const ENDPOINT = '/api/me/activity/heartbeat';

  // ── Trạng thái nội bộ ──────────────────────────────────────────────
  let timerId = null;
  let lastActivityAt = 0;   // Mốc thời gian tương tác thật gần nhất
  let started = false;
  let sending = false;      // Chống gửi chồng nhau

  /**
   * Lấy access token đang nằm trong bộ nhớ.
   * index.html đồng bộ window.__accessToken sau mỗi lần đăng nhập/refresh.
   */
  function getToken() {
    return window.__accessToken || null;
  }

  /**
   * Gọi API có Bearer token, tự động refresh khi gặp 401.
   * - Ưu tiên dùng CyberAPI.fetch (nếu trang đã nạp assets/api.js) để tái dùng
   *   đúng luồng refresh của hệ thống.
   * - Nếu không có CyberAPI (index.html định nghĩa apiFetch() cục bộ trong thẻ
   *   <script> nên không global), tự gọi fetch và tự refresh qua
   *   /api/auth/refresh (endpoint index.html đang dùng).
   */
  async function sendHeartbeat(keepalive) {
    const token = getToken();
    if (!token) return false;             // Chưa đăng nhập → không gửi gì
    if (sending) return false;

    sending = true;
    try {
      let response;

      if (window.CyberAPI && typeof window.CyberAPI.fetch === 'function') {
        response = await window.CyberAPI.fetch(ENDPOINT, { method: 'POST' });
      } else {
        response = await fetch(ENDPOINT, {
          method: 'POST',
          credentials: 'include',
          keepalive: !!keepalive,
          headers: { Authorization: 'Bearer ' + token },
        });
      }

      // 401 → thử refresh một lần rồi gửi lại (giống apiFetch của index.html)
      if (response && response.status === 401) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          const newToken = getToken();
          if (newToken) {
            response = await fetch(ENDPOINT, {
              method: 'POST',
              credentials: 'include',
              keepalive: !!keepalive,
              headers: { Authorization: 'Bearer ' + newToken },
            });
          }
        }
      }

      return Boolean(response && response.ok);
    } catch (err) {
      // Im lặng: không được phép làm hỏng trải nghiệm game vì lỗi mạng
      return false;
    } finally {
      sending = false;
    }
  }

  /**
   * Làm mới access token từ cookie HttpOnly (kèm logic trùng với index.html)
   * @returns {Promise<boolean>}
   */
  async function refreshAccessToken() {
    if (window.CyberAPI && typeof window.CyberAPI.refreshToken === 'function') {
      return window.CyberAPI.refreshToken();
    }
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) return false;
      const json = await res.json();
      if (json.success && json.accessToken) {
        window.__accessToken = json.accessToken;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Tab có đang hiển thị không
   */
  function isVisible() {
    return document.visibilityState === 'visible';
  }

  /**
   * Người dùng có vừa tương tác thật trong 5 phút gần nhất không.
   * Nếu chưa từng tương tác (lastActivityAt = 0) → coi như đang hoạt động
   * (người dùng vừa mở trang), nên lần heartbeat đầu vẫn được gửi.
   */
  function hasRecentActivity() {
    if (!lastActivityAt) return true;
    return (Date.now() - lastActivityAt) < IDLE_TIMEOUT_MS;
  }

  /**
   * Gửi một nhịp heartbeat nếu đủ điều kiện.
   * @param {boolean} keepalive — dùng khi flush khi đóng tab (fetch keepalive)
   */
  function tick(keepalive) {
    if (!getToken()) return;      // Không đăng nhập → không gửi
    if (!isVisible()) return;     // Tab ẩn → không tính
    if (!hasRecentActivity()) return; // Máy bỏ quên > 5 phút → không tính
    void sendHeartbeat(keepalive);
  }

  // ── Gắn sự kiện lưu vết tương tác thật ─────────────────────────────
  // passive: true để không chặn cuộn (hiệu năng), capture: true để bắt cả
  // sự kiện phát sinh trong iframe game.
  const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'wheel', 'scroll'];
  function markActivity() {
    lastActivityAt = Date.now();
  }
  ACTIVITY_EVENTS.forEach(evt => {
    window.addEventListener(evt, markActivity, { passive: true, capture: true });
  });

  // ── Vòng lặp 30 giây ───────────────────────────────────────────────
  function startLoop() {
    stopLoop();
    timerId = window.setInterval(() => tick(false), HEARTBEAT_INTERVAL_MS);
  }
  function stopLoop() {
    if (timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  // ── Xử lý ẩn/đóng tab: dừng timer + gửi 1 heartbeat cuối ────────────
  // keepalive: true để request vẫn bay tới server khi trang đang đóng.
  // KHÔNG dùng navigator.sendBeacon vì beacon KHÔNG gửi được header Authorization.
  function flushFinal() {
    if (!getToken()) return;
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: { Authorization: 'Bearer ' + getToken() },
      }).catch(() => { /* im lặng */ });
    } catch (_) {
      // im lặng
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushFinal();
      stopLoop();
    } else if (started) {
      // Quay lại tab → gửi 1 nhịp ngay cho khớp thời gian thực
      tick(false);
      startLoop();
    }
  });

  window.addEventListener('pagehide', () => {
    flushFinal();
    stopLoop();
  });
  window.addEventListener('beforeunload', () => {
    flushFinal();
    stopLoop();
  });

  // ── API công khai ───────────────────────────────────────────────────
  const CyberActivity = {
    /** Bắt đầu gửi heartbeat (gọi sau khi đăng nhập/refresh thành công) */
    start() {
      if (!getToken()) return;          // Chưa đăng nhập → không làm gì
      if (started) return;
      started = true;
      lastActivityAt = Date.now();      // Coi như vừa có tương tác
      tick(false);                      // Gửi ngay một nhịp cho nhanh
      startLoop();
    },

    /** Dừng gửi heartbeat (gọi khi đăng xuất) */
    stop() {
      started = false;
      stopLoop();
    },

    /** Trạng thái hiện tại (tiện ích cho test/debug) */
    isRunning() {
      return started;
    },

    /** Số giây kể từ lần tương tác thật gần nhất (tiện ích cho test/debug) */
    idleSeconds() {
      if (!lastActivityAt) return 0;
      return Math.floor((Date.now() - lastActivityAt) / 1000);
    },
  };

  window.CyberActivity = CyberActivity;
})(window);