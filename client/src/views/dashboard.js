import { api } from '../api.js';

const HISTORY_KEY = 'yt2gd_history';

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveHistory(h) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 50)));
}

function getFileIcon(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  const map = { mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬', webm: '🎬',
    mp3: '🎵', wav: '🎵', aac: '🎵', ogg: '🎵', m4a: '🎵',
    pdf: '📄', zip: '🗜', rar: '🗜', jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼',
    exe: '⚙️', msi: '⚙️', dmg: '💿' };
  return map[ext] || '📁';
}

function renderHistory(list) {
  if (!list.length) {
    return `<p class="hint" style="text-align:center; padding: 24px 0;">No transfers yet. Submit a URL above to get started.</p>`;
  }
  return `<div class="history-list">
    ${list.map(item => `
      <div class="history-item">
        <span class="file-icon">${getFileIcon(item.fileName)}</span>
        <div class="file-info">
          <div class="file-name">${item.fileName || 'Unknown file'}</div>
          <div class="file-meta">${item.folder || 'yt2gd'} · ${item.time}</div>
        </div>
        ${item.webViewLink ? `<a href="${item.webViewLink}" target="_blank" class="btn btn-ghost" style="padding:6px 14px;font-size:0.8rem;">View ↗</a>` : ''}
        <span class="badge ${item.success ? 'badge-success' : 'badge-error'}">${item.success ? 'Done' : 'Failed'}</span>
      </div>
    `).join('')}
  </div>`;
}

function isYouTubeUrl(url) {
  try {
    const { hostname } = new URL(url);
    return hostname.includes('youtube.com') || hostname.includes('youtu.be');
  } catch { return false; }
}

export async function renderDashboard(username, onNavigate) {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const app = document.getElementById('app');

  // Fetch server version
  let serverVersion = '…';
  try {
    const info = await api.getInfo();
    serverVersion = info.version || 'unknown';
  } catch { serverVersion = 'unavailable'; }

  // Client version from Vite env (set in vite.config.js)
  const clientVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

  app.innerHTML = `
    <div class="app-layout">
      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="sidebar-logo">
          <div class="logo-icon">⬆</div>
          <span>yt2gd</span>
        </div>
        <nav class="sidebar-nav">
          <button class="nav-item active" id="nav-dashboard">
            <span class="nav-icon">🏠</span> Dashboard
          </button>
          <button class="nav-item" id="nav-settings">
            <span class="nav-icon">⚙️</span> Settings
          </button>
        </nav>
        <div class="sidebar-footer">
          <div class="version-info">
            <span>Server&nbsp;<code>v${serverVersion}</code></span>
            <span>Client&nbsp;<code>v${clientVersion}</code></span>
          </div>
          <button id="logout-btn" class="nav-item" style="color: var(--error);">
            <span class="nav-icon">🚪</span> Sign Out
          </button>
        </div>
      </aside>

      <!-- Content -->
      <main class="main-content">
        <div class="page-header fade-up">
          <h1>Transfer a File</h1>
          <p>Today's uploads will go to <strong>yt2gd / ${today}</strong> on your Google Drive.</p>
        </div>

        <!-- Transfer Card -->
        <div class="card fade-up">
          <div class="card-title">🔗 File URL</div>
          <div class="url-input-wrap">
            <input id="file-url" class="form-control" type="url"
              placeholder="https://youtube.com/watch?v=… or a direct file URL" />
            <button id="transfer-btn" class="btn btn-primary" style="white-space:nowrap;">
              Upload to Drive
            </button>
          </div>

          <!-- YouTube options (hidden until YouTube URL is detected) -->
          <div id="yt-options" style="display:none; margin-top:16px; display:none;">
            <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
              <div class="form-group" style="margin:0; flex:1; min-width:140px;">
                <label for="yt-format" style="font-size:0.82rem;">Format</label>
                <select id="yt-format" class="form-control" style="padding:8px 10px;">
                  <option value="video">🎬 Video</option>
                  <option value="audio">🎵 Audio only</option>
                </select>
              </div>
              <div class="form-group" style="margin:0; flex:1; min-width:140px;">
                <label for="yt-quality" style="font-size:0.82rem;">Quality</label>
                <select id="yt-quality" class="form-control" style="padding:8px 10px;">
                  <option value="best">Best available</option>
                  <option value="1080">1080p</option>
                  <option value="720">720p</option>
                  <option value="480">480p</option>
                  <option value="360">360p</option>
                  <option value="worst">Lowest</option>
                </select>
              </div>
            </div>
            <p class="hint" style="margin-top:8px;">🍪 Cookies will be used automatically if uploaded in Settings.</p>
          </div>

          <p class="hint" id="url-hint" style="margin-top:8px;">Paste a YouTube link or a direct file URL.</p>

          <!-- Progress section -->
          <div id="progress-section" style="display:none; margin-top: 24px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <div class="progress-label" style="margin-top: 0; display: inline-flex; align-items: center; gap: 10px;">
                <span id="progress-step">Connecting…</span>
                <span id="progress-detail" style="font-size:0.8rem; color:var(--text-secondary);"></span>
              </div>
              <button id="cancel-btn" class="btn btn-ghost" style="padding: 4px 10px; font-size: 0.75rem; color: var(--error); border-color: var(--error-bg);">Stop</button>
            </div>
            <div class="progress-wrap" style="margin-top: 0;">
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" id="progress-fill" style="width: 0%;"></div>
              </div>
            </div>
          </div>

          <div id="transfer-result" style="margin-top:20px; display:none;"></div>
        </div>

        <!-- History Card -->
        <div class="card fade-up" style="animation-delay: 0.1s">
          <div class="card-title">📋 Recent Transfers</div>
          <div id="history-container">${renderHistory(loadHistory())}</div>
        </div>
      </main>
    </div>
  `;

  // Navigation
  document.getElementById('nav-settings').addEventListener('click', () => onNavigate('settings'));
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api.logout();
    onNavigate('logout');
  });

  // Show/hide YouTube options based on URL input
  const fileUrlInput = document.getElementById('file-url');
  const ytOptions = document.getElementById('yt-options');

  fileUrlInput.addEventListener('input', () => {
    const url = fileUrlInput.value.trim();
    if (isYouTubeUrl(url)) {
      ytOptions.style.display = 'block';
    } else {
      ytOptions.style.display = 'none';
    }
  });

  // Transfer
  const transferBtn = document.getElementById('transfer-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const progressSection = document.getElementById('progress-section');
  const progressFill = document.getElementById('progress-fill');
  const progressStep = document.getElementById('progress-step');
  const progressDetail = document.getElementById('progress-detail');
  const resultBox = document.getElementById('transfer-result');

  let activeTransfer = false;

  cancelBtn.addEventListener('click', async () => {
    if (!activeTransfer) return;
    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Stopping…';
    try {
      await api.cancelTransfer();
    } catch (err) {
      console.error('Cancel failed:', err);
    }
  });

  transferBtn.addEventListener('click', async () => {
    const url = fileUrlInput.value.trim();
    if (!url) { fileUrlInput.focus(); return; }

    const format = document.getElementById('yt-format')?.value || 'video';
    const quality = document.getElementById('yt-quality')?.value || 'best';

    // Reset UI
    activeTransfer = true;
    resultBox.style.display = 'none';
    progressSection.style.display = 'block';
    progressFill.style.width = '5%';
    progressStep.textContent = 'Connecting…';
    progressDetail.textContent = '';
    transferBtn.disabled = true;
    transferBtn.innerHTML = '<span class="spinner"></span>';
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Stop';

    // Open SSE stream BEFORE posting the transfer request
    const evtSource = api.openProgressStream();
    let transferComplete = false;

    evtSource.addEventListener('status', (e) => {
      const data = JSON.parse(e.data);
      if (data.phase === 'download') {
        progressStep.textContent = 'Downloading…';
        progressFill.style.width = '10%';
      } else if (data.phase === 'upload') {
        progressStep.textContent = 'Uploading to Drive…';
        progressFill.style.width = '55%';
      }
    });

    evtSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      if (data.phase === 'download') {
        if (data.percent) progressFill.style.width = `${Math.min(data.percent * 0.5, 50)}%`;
        progressDetail.textContent = data.label || (data.line ? data.line.substring(0, 80) : '');
      } else if (data.phase === 'upload') {
        if (data.percent) progressFill.style.width = `${50 + Math.min(data.percent * 0.45, 45)}%`;
        progressDetail.textContent = data.label || '';
      }
    });

    evtSource.addEventListener('done', (e) => {
      transferComplete = true;
      activeTransfer = false;
      evtSource.close();
      progressFill.style.width = '100%';
      progressStep.textContent = 'Complete!';
      progressDetail.textContent = '';

      const data = JSON.parse(e.data);
      resultBox.className = 'alert alert-success';
      resultBox.innerHTML = `✅ <span><strong>${data.fileName}</strong> uploaded to <em>${data.folder}</em>${data.webViewLink ? ` &nbsp;<a href="${data.webViewLink}" target="_blank" style="color:var(--success);">View on Drive ↗</a>` : ''}</span>`;
      resultBox.style.display = 'flex';

      const history = loadHistory();
      history.unshift({ fileName: data.fileName, folder: data.folder, webViewLink: data.webViewLink, time: new Date().toLocaleString(), success: true });
      saveHistory(history);
      document.getElementById('history-container').innerHTML = renderHistory(history);
      fileUrlInput.value = '';
      ytOptions.style.display = 'none';
      transferBtn.disabled = false;
      transferBtn.textContent = 'Upload to Drive';
      setTimeout(() => { progressSection.style.display = 'none'; }, 2000);
    });

    evtSource.addEventListener('error', (e) => {
      if (transferComplete) return;
      activeTransfer = false;
      evtSource.close();
      let msg = 'Transfer failed.';
      try { msg = JSON.parse(e.data).message || msg; } catch {}
      
      const isCancelled = msg.toLowerCase().includes('cancel');
      
      progressSection.style.display = 'none';
      resultBox.className = isCancelled ? 'alert alert-error' : 'alert alert-error';
      resultBox.innerHTML = isCancelled ? `🛑 ${msg}` : `❌ ${msg}`;
      resultBox.style.display = 'flex';
      transferBtn.disabled = false;
      transferBtn.textContent = 'Upload to Drive';
    });

    // Now fire the actual request (non-blocking — progress comes through SSE)
    try {
      await api.transfer(url, format, quality);
    } catch (err) {
      if (!transferComplete) {
        activeTransfer = false;
        evtSource.close();
        progressSection.style.display = 'none';
        
        const isCancelled = err.message.toLowerCase().includes('cancel');
        resultBox.className = 'alert alert-error';
        resultBox.innerHTML = isCancelled ? `🛑 ${err.message}` : `❌ ${err.message}`;
        resultBox.style.display = 'flex';

        if (!isCancelled) {
          const history = loadHistory();
          history.unshift({ fileName: url.split('/').pop().split('?')[0] || 'unknown', folder: 'yt2gd', time: new Date().toLocaleString(), success: false });
          saveHistory(history);
          document.getElementById('history-container').innerHTML = renderHistory(history);
        }
        transferBtn.disabled = false;
        transferBtn.textContent = 'Upload to Drive';
      }
    }
  });

  // Allow Enter key
  fileUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') transferBtn.click();
  });
}
