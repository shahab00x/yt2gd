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
  const map = { mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬', mp3: '🎵', wav: '🎵',
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

export function renderDashboard(username, onNavigate) {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const app = document.getElementById('app');

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
              placeholder="https://example.com/path/to/file.mp4" />
            <button id="transfer-btn" class="btn btn-primary" style="white-space:nowrap;">
              Upload to Drive
            </button>
          </div>
          <p class="hint" id="url-hint">Paste a direct link to any publicly accessible file.</p>

          <div id="progress-section" style="display:none; margin-top: 24px;">
            <div class="progress-wrap">
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" id="progress-fill" style="width: 50%;"></div>
              </div>
              <div class="progress-label">
                <span id="progress-step">Downloading…</span>
                <span id="progress-pct"></span>
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

  // Transfer
  const transferBtn = document.getElementById('transfer-btn');
  const fileUrlInput = document.getElementById('file-url');
  const progressSection = document.getElementById('progress-section');
  const progressFill = document.getElementById('progress-fill');
  const progressStep = document.getElementById('progress-step');
  const resultBox = document.getElementById('transfer-result');

  transferBtn.addEventListener('click', async () => {
    const url = fileUrlInput.value.trim();
    if (!url) {
      fileUrlInput.focus();
      return;
    }

    // Reset UI
    resultBox.style.display = 'none';
    progressSection.style.display = 'block';
    progressFill.style.width = '20%';
    progressStep.textContent = 'Downloading…';
    transferBtn.disabled = true;
    transferBtn.innerHTML = '<span class="spinner"></span>';

    // Animate progress bar (indeterminate)
    let pct = 20;
    const ticker = setInterval(() => {
      pct = Math.min(pct + Math.random() * 5, 85);
      progressFill.style.width = pct + '%';
    }, 600);

    try {
      progressStep.textContent = 'Downloading & uploading…';
      const data = await api.transfer(url);

      clearInterval(ticker);
      progressFill.style.width = '100%';
      progressStep.textContent = 'Complete!';

      resultBox.className = 'alert alert-success';
      resultBox.innerHTML = `✅ <span><strong>${data.fileName}</strong> uploaded to <em>${data.folder}</em>${data.webViewLink ? ` &nbsp;<a href="${data.webViewLink}" target="_blank" style="color:var(--success);">View on Drive ↗</a>` : ''}</span>`;
      resultBox.style.display = 'flex';

      // Save to history
      const history = loadHistory();
      history.unshift({
        fileName: data.fileName,
        folder: data.folder,
        webViewLink: data.webViewLink,
        time: new Date().toLocaleString(),
        success: true
      });
      saveHistory(history);
      document.getElementById('history-container').innerHTML = renderHistory(history);

      fileUrlInput.value = '';

    } catch (err) {
      clearInterval(ticker);
      progressSection.style.display = 'none';

      resultBox.className = 'alert alert-error';
      resultBox.textContent = `❌ ${err.message}`;
      resultBox.style.display = 'flex';

      // Save failed item to history
      const history = loadHistory();
      history.unshift({
        fileName: url.split('/').pop().split('?')[0] || 'unknown',
        folder: 'yt2gd',
        time: new Date().toLocaleString(),
        success: false
      });
      saveHistory(history);
      document.getElementById('history-container').innerHTML = renderHistory(history);
    } finally {
      transferBtn.disabled = false;
      transferBtn.textContent = 'Upload to Drive';
    }
  });

  // Allow Enter key in URL input
  fileUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') transferBtn.click();
  });
}
