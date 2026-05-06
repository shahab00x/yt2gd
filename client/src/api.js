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
    console.log(`[API] Reading cookie file as text: ${file.name}`);
    const text = await file.text();
    
    // Direct bypass: Try to hit port 3000 directly to avoid proxy issues
    const { hostname, protocol } = window.location;
    const directUrl = `${protocol}//${hostname}:3000${BASE}/auth/cookies`;
    
    console.log(`[API] Sending ${text.length} bytes via DIRECT upload to ${directUrl}...`);
    try {
      const res = await axios.post(directUrl, { cookies: text }, {
        withCredentials: true,
        timeout: 120000
      });
      console.log(`[API] Direct upload successful. Status: ${res.status}`);
      return res.data;
    } catch (err) {
      console.warn('[API] Direct upload failed, falling back to proxy...', err.message);
      // Fallback to proxy if direct fails (e.g. port 3000 not exposed)
      try {
        const res = await axios.post(`${BASE}/auth/cookies`, { cookies: text }, {
          withCredentials: true,
          timeout: 60000
        });
        return res.data;
      } catch (proxyErr) {
        const status = proxyErr.response ? proxyErr.response.status : 'Network/Timeout';
        const errorMsg = proxyErr.response && proxyErr.response.data ? proxyErr.response.data.error : proxyErr.message;
        console.error(`[API] Cookie upload error (Status ${status}):`, errorMsg);
        throw new Error(errorMsg);
      }
    }
  },

  /**
   * Open an SSE connection for transfer progress.
   * Returns the EventSource object. Caller is responsible for closing it.
   */
  openProgressStream: () => new EventSource(`${BASE}/transfer/progress`, { withCredentials: true }),
};
