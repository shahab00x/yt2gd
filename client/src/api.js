import axios from 'axios';

/**
 * Thin API client that wraps fetch calls.
 * Always sends cookies (session) with each request.
 */

const BASE = '/api';

async function request(method, path, body = null) {
  const opts = {
    method,
    credentials: 'include',
    headers: {}
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  login: (username, password) => request('POST', '/auth/login', { username, password }),
  logout: () => request('POST', '/auth/logout'),
  me: () => request('GET', '/auth/me'),
  getSettings: () => request('GET', '/auth/settings'),
  saveSettings: (data) => request('POST', '/auth/settings', data),
  transfer: (url, format, quality, isLive, torrentMode, startBatchIndex = 0) => request('POST', '/transfer', { url, format, quality, isLive, torrentMode, startBatchIndex }),
  cancelTransfer: (transferId = null) => request('POST', '/transfer/cancel', transferId ? { transferId } : null),
  getInfo: () => request('GET', '/auth/info'),
  getCookiesStatus: () => request('GET', '/auth/cookies/status'),
  deleteCookies: () => request('DELETE', '/auth/cookies'),
  getTransferList: () => request('GET', '/transfer/list'),
  getSystemStatus: () => request('GET', '/system/status'),
  clearTmp: () => request('POST', '/system/clear-tmp'),
  getYtdlpVersion: () => request('GET', '/system/ytdlp-version'),
  updateYtdlp: () => request('POST', '/system/update-ytdlp'),

  /**
   * Upload a cookies.txt file (multipart/form-data).
   */
  uploadCookies: async (file) => {
    const formData = new FormData();
    formData.append('cookies', file);
    const res = await fetch(`${BASE}/auth/cookies`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  /**
   * Open an SSE connection for transfer progress.
   * Returns the EventSource object. Caller is responsible for closing it.
   */
  openProgressStream: () => new EventSource(`${BASE}/transfer/progress`, { withCredentials: true }),
};
