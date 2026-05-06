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
  transfer: (url, format, quality, isLive) => request('POST', '/transfer', { url, format, quality, isLive }),
  cancelTransfer: () => request('POST', '/transfer/cancel'),
  getInfo: () => request('GET', '/auth/info'),
  getCookiesStatus: () => request('GET', '/auth/cookies/status'),
  deleteCookies: () => request('DELETE', '/auth/cookies'),

  /**
   * Upload a cookies.txt file (multipart/form-data).
   */
  uploadCookies: async (file) => {
    const formData = new FormData();
    formData.append('cookies', file);
    console.log(`[API] Uploading via Axios to ${BASE}/auth/cookies...`);
    try {
      const res = await axios.post(`${BASE}/auth/cookies`, formData, {
        withCredentials: true,
        timeout: 60000,
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      console.log(`[API] Axios response received. Status: ${res.status}`);
      return res.data;
    } catch (err) {
      const status = err.response ? err.response.status : 'Network/Timeout';
      const errorMsg = err.response && err.response.data ? err.response.data.error : err.message;
      console.error(`[API] Axios upload error (Status ${status}):`, errorMsg);
      throw new Error(errorMsg);
    }
  },

  /**
   * Open an SSE connection for transfer progress.
   * Returns the EventSource object. Caller is responsible for closing it.
   */
  openProgressStream: () => new EventSource(`${BASE}/transfer/progress`, { withCredentials: true }),
};
