/**
 * CyberKnight / Sigmabloom - Shared API Client (assets/api.js)
 *
 * - Quản lý Access Token thuần túy trong bộ nhớ (Memory-only, không lưu vào localStorage).
 * - Tự động đính kèm Authorization: Bearer và credentials: 'include'.
 * - Tự động gọi refresh-token khi gặp mã 401.
 * - Cung cấp các helper cho Auth, Catalog, Entitlements, Levels, Orders, Activity và Admin.
 */

(function (window) {
  'use strict';

  // Biến lưu access token trong bộ nhớ RAM của JS session
  window.__accessToken = window.__accessToken || null;

  // Quyền truy cập màn chơi mặc định
  window.__entitlements = window.__entitlements || {
    premium: false,
    playableLevels: [0],
    packages: [],
  };

  /**
   * Helper gửi request với auto-retry refresh token
   */
  async function apiFetch(url, options = {}, isRetry = false) {
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      credentials: 'include', // Mang theo HttpOnly cookies (refreshToken, levelAccess)
      ...options,
    };

    if (window.__accessToken) {
      config.headers['Authorization'] = `Bearer ${window.__accessToken}`;
    }

    try {
      const response = await fetch(url, config);

      // Nếu 401 và chưa retry -> thử refresh token
      if (response.status === 401 && !isRetry && !url.includes('/api/auth/login') && !url.includes('/api/auth/refresh-token')) {
        const refreshed = await refreshToken();
        if (refreshed) {
          // Thử lại request gốc với token mới
          return apiFetch(url, options, true);
        }
      }

      return response;
    } catch (err) {
      console.error(`❌ API Fetch error [${url}]:`, err);
      throw err;
    }
  }

/**
   * Khoá "single-flight" cho việc làm mới token.
   *
   * BẮT BUỘC: server XOAY VÒNG refresh token (token cũ bị xoá sau mỗi lần
   * refresh). Nếu nhiều request cùng gặp 401 và cùng gọi refresh, chỉ request
   * đến trước thắng, các request sau nhận 403 kèm `Set-Cookie: refreshToken=`
   * -> trình duyệt XOÁ mất cookie hợp lệ -> người dùng bị đăng xuất oan.
   *
   * Vì vậy: mọi lời gọi refresh trong cùng một thời điểm Sẽ dùng chung MỘT
   * promise, đảm bảo chỉ có đúng 1 HTTP request tới /api/auth/refresh-token.
   */
  let refreshPromise = null;

  /**
   * Làm mới Access Token bằng HttpOnly cookie refreshToken.
   * @returns {Promise<boolean>}
   */
  function refreshToken() {
    // Đã có một lần refresh đang chạy -> chờ và dùng chung kết quả
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      try {
        const res = await fetch('/api/auth/refresh-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });

        if (!res.ok) {
          window.__accessToken = null;
          return false;
        }

        const json = await res.json();
        if (json.success && json.accessToken) {
          window.__accessToken = json.accessToken;
          return true;
        }
        return false;
      } catch {
        window.__accessToken = null;
        return false;
      } finally {
        // Xoá khoá ở finally để lần gọi SAU có thể refresh lại bình thường
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  }

  /**
   * Đồng bộ quyền truy cập các màn chơi của user
   */
  async function loadEntitlements() {
    if (!window.__accessToken) {
      window.__entitlements = { premium: false, playableLevels: [0], packages: [] };
      return window.__entitlements;
    }

    try {
      const res = await apiFetch('/api/me/entitlements');
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          window.__entitlements = {
            premium: Boolean(json.data.premium),
            playableLevels: json.data.playableLevels || [0],
            packages: json.data.packages || [],
          };
          return window.__entitlements;
        }
      }
    } catch (err) {
      console.warn('⚠️ Không thể tải entitlements:', err);
    }

    window.__entitlements = { premium: false, playableLevels: [0], packages: [] };
    return window.__entitlements;
  }

  /**
   * Mở màn chơi: gọi /api/levels/:id/launch để lấy cookie levelAccess
   */
  async function launchLevel(levelId) {
    const res = await apiFetch(`/api/levels/${levelId}/launch`, {
      method: 'POST',
    });
    return res;
  }

  // ── Auth Services ──────────────────────────────────────────────
  const auth = {
    async login(emailOrUsername, password) {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ emailOrUsername, password }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.accessToken) {
        window.__accessToken = data.accessToken;
        await loadEntitlements();
      }
      return { ok: res.ok, status: res.status, data };
    },

    async logout() {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
        });
      } catch (err) {
        console.warn('Lỗi gọi API logout:', err);
      }
      window.__accessToken = null;
      window.__entitlements = { premium: false, playableLevels: [0], packages: [] };
    },

    async getProfile() {
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        return res.json();
      }
      return null;
    },
  };

  // ── Payment Services ───────────────────────────────────────────
  const payments = {
    async createOrder(packageId) {
      const res = await apiFetch('/api/payments/orders', {
        method: 'POST',
        body: JSON.stringify({ packageId }),
      });
      return res.json();
    },

    async getOrder(orderCode) {
      const res = await apiFetch(`/api/payments/orders/${orderCode}`);
      return res.json();
    },

    async cancelOrder(orderCode) {
      const res = await apiFetch(`/api/payments/orders/${orderCode}/cancel`, {
        method: 'POST',
      });
      return res.json();
    },

    async getMyOrders() {
      const res = await apiFetch('/api/payments/orders/mine');
      return res.json();
    },
  };

  // Helper xây dựng chuỗi query an toàn, bỏ các tham số rỗng/null/undefined
  function buildQueryString(params = {}) {
    const clean = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        clean[k] = v;
      }
    }
    const q = new URLSearchParams(clean).toString();
    return q ? '?' + q : '';
  }

  // ── Admin Services ─────────────────────────────────────────────
  const admin = {
    async getStats() {
      const res = await apiFetch('/api/admin/stats');
      return res.json();
    },

    async getUsers(params = {}) {
      const res = await apiFetch(`/api/admin/users${buildQueryString(params)}`);
      return res.json();
    },

    async getOrders(params = {}) {
      const res = await apiFetch(`/api/admin/orders${buildQueryString(params)}`);
      return res.json();
    },

    async getTransactions(params = {}) {
      const res = await apiFetch(`/api/admin/transactions${buildQueryString(params)}`);
      return res.json();
    },

    async grantPackage(payload) {
      const res = await apiFetch('/api/admin/grant', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return res.json();
    },

    async getMismatches(params = {}) {
      const res = await apiFetch(`/api/admin/payments/mismatches${buildQueryString(params)}`);
      return res.json();
    },

    async reconcileTransaction(payload) {
      const res = await apiFetch('/api/admin/payments/reconcile', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return res.json();
    },

    async getAuditLogs(params = {}) {
      const res = await apiFetch(`/api/admin/audit-logs${buildQueryString(params)}`);
      return res.json();
    },
  };

  // ── Activity Services (thời gian online) ──────────────────────────
  // Gửi heartbeat "còn sống" — máy chủ tự tính thời gian online
  // (client KHÔNG gửi thời lượng). Dùng apiFetch để hưởng luồng refresh 401.
  const activity = {
    async heartbeat() {
      const res = await apiFetch('/api/me/activity/heartbeat', {
        method: 'POST',
      });
      try {
        return await res.json();
      } catch {
        return { success: false, message: 'Không nhận được phản hồi từ máy chủ.' };
      }
    },

    async getMyActivity() {
      const res = await apiFetch('/api/me/activity/me');
      return res.json();
    },
  };

  // ── Helper phòng vệ XSS ───────────────────────────────────────
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/`/g, '&#96;');
  }

  // Đảm bảo window.escapeHtml luôn khả dụng
  if (typeof window.escapeHtml !== 'function') {
    window.escapeHtml = escapeHtml;
  }

  // Export module ra window.CyberAPI
  window.CyberAPI = {
    fetch: apiFetch,
    refreshToken,
    loadEntitlements,
    launchLevel,
    escapeHtml,
    auth,
    payments,
    admin,
    activity,
  };

})(window);
