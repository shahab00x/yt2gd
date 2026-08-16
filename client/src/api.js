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
  transfer: (url, format, quality, isLive, torrentMode, startBatchIndex = 0, uploadToDrive = true, audioLanguage = 'original') => request('POST', '/transfer', { url, format, quality, isLive, torrentMode, startBatchIndex, uploadToDrive, audioLanguage }),
  cancelTransfer: (transferId = null) => request('POST', '/transfer/cancel', transferId ? { transferId } : null),
  getInfo: () => request('GET', '/auth/info'),
  getCookiesStatus: () => request('GET', '/auth/cookies/status'),
  deleteCookies: () => request('DELETE', '/auth/cookies'),
  getTransferList: () => request('GET', '/transfer/list'),
  getSystemStatus: () => request('GET', '/system/status'),
  clearTmp: () => request('POST', '/system/clear-tmp'),
  uploadFiles: (targetName) => request('POST', '/system/upload-files', { targetName }),
  getYtdlpVersion: () => request('GET', '/system/ytdlp-version'),
  updateYtdlp: () => request('POST', '/system/update-ytdlp'),
  getCommits: () => request('GET', '/system/commits'),
  updateApp: () => request('POST', '/system/update-app'),
  rollbackApp: (hash) => request('POST', '/system/rollback-app', { hash }),

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

  // --------------------------------------------------------------------------
  // Bastyon Uploader
  // --------------------------------------------------------------------------
  bastyon: {
    getAccounts: () => request('GET', '/bastyon/accounts'),
    addAccount: (name, wif) => request('POST', '/bastyon/accounts', { name, wif }),
    deleteAccount: (id) => request('DELETE', `/bastyon/accounts/${id}`),

    vaultStatus: () => request('GET', '/bastyon/vault/status'),
    unlockVault: (passphrase) => request('POST', '/bastyon/vault/unlock', { passphrase }),
    lockVault: () => request('POST', '/bastyon/vault/lock'),
    setPassphrase: (passphrase) => request('POST', '/bastyon/vault/passphrase', { passphrase }),

    download: (url, accountId, format, quality, audioLanguage) =>
      request('POST', '/bastyon/download', { url, accountId, format, quality, audioLanguage }),
    cancel: () => request('POST', '/bastyon/cancel'),

    getDrafts: () => request('GET', '/bastyon/drafts'),
    getDraft: (id) => request('GET', `/bastyon/drafts/${id}`),
    updateDraft: (id, data) => request('PUT', `/bastyon/drafts/${id}`, data),
    deleteDraft: (id) => request('DELETE', `/bastyon/drafts/${id}`),
    publishDraft: (id) => request('POST', `/bastyon/drafts/${id}/publish`),

    getStorage: () => request('GET', '/bastyon/storage'),
    clearStaging: () => request('POST', '/bastyon/staging/clear'),

    /**
     * Open an SSE connection for Bastyon download/publish progress.
     * Returns the EventSource object. Caller is responsible for closing it.
     */
    openProgressStream: () => new EventSource(`${BASE}/bastyon/progress`, { withCredentials: true }),
  },
};
