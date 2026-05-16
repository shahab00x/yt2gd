import { api } from '../api.js';

export function renderSettings(username, onNavigate) {
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
          <button class="nav-item" id="nav-dashboard">
            <span class="nav-icon">🏠</span> Dashboard
          </button>
          <button class="nav-item active" id="nav-settings">
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
          <h1>Settings</h1>
          <p>Configure your Google Drive OAuth credentials below. These are stored on the server.</p>
        </div>

        <!-- Google Drive Card -->
        <div class="card fade-up">
          <div class="card-title">☁️ Google Drive Configuration</div>

          <div id="settings-load-error" class="alert alert-error" style="display:none; margin-bottom:20px;"></div>

          <div class="settings-grid">
            <div class="form-group">
              <label for="clientId">Client ID</label>
              <input id="clientId" class="form-control" type="text"
                placeholder="xxxxxxxx.apps.googleusercontent.com" />
            </div>
            <div class="form-group">
              <label for="clientSecret">Client Secret</label>
              <input id="clientSecret" class="form-control" type="password"
                placeholder="Leave blank to keep existing" />
              <p class="hint">Leave blank to keep the existing secret.</p>
            </div>
            <div class="form-group">
              <label for="redirectUri">Redirect URI</label>
              <input id="redirectUri" class="form-control" type="text"
                placeholder="http://localhost" />
            </div>
            <div class="form-group">
              <label for="refreshToken">Refresh Token</label>
              <input id="refreshToken" class="form-control" type="password"
                placeholder="Leave blank to keep existing" />
              <p class="hint">Leave blank to keep the existing token.</p>
            </div>
            <div class="form-group">
              <label for="torrentBatchSizeGB">Torrent Batch Size (GB)</label>
              <input id="torrentBatchSizeGB" class="form-control" type="number" step="0.5" min="1"
                placeholder="12" />
              <p class="hint">Max space to use for torrent batches before uploading.</p>
            </div>
          </div>

          <div id="settings-result" style="margin-top:4px; display:none;"></div>

          <div class="divider"></div>

          <div style="display:flex; justify-content:flex-end;">
            <button id="save-settings-btn" class="btn btn-primary">
              Save Settings
            </button>
          </div>
        </div>

        <!-- yt-dlp Cookies Card -->
        <div class="card fade-up" style="animation-delay:0.1s;">
          <div class="card-title">🍪 yt-dlp Cookies</div>
          <p style="color:var(--text-secondary); font-size:0.9rem; margin-bottom:16px;">
            Upload a <code style="background:var(--bg-elevated);padding:2px 6px;border-radius:4px;">cookies.txt</code>
            file exported from your browser to allow yt-dlp to bypass age restrictions and bot checks on YouTube.
          </p>

          <div id="cookies-status-msg" style="margin-bottom:14px;"></div>

          <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
            <input id="cookies-file-input" type="file" accept=".txt" style="display:none;" />
            <button id="cookies-upload-btn" class="btn btn-ghost">📂 Upload cookies.txt</button>
            <button id="cookies-remove-btn" class="btn btn-ghost" style="color:var(--error); display:none;">🗑 Remove Cookies</button>
          </div>

          <div id="cookies-result" style="margin-top:12px; display:none;"></div>
        </div>

        <!-- yt-dlp Engine Card -->
        <div class="card fade-up" style="animation-delay:0.2s;">
          <div class="card-title">🚀 yt-dlp Engine</div>
          <p style="color:var(--text-secondary); font-size:0.9rem; margin-bottom:16px;">
            View the currently installed yt-dlp version and trigger manual updates to the latest nightly build.
          </p>

          <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:16px;">
            <span style="font-weight:500; color:var(--text-secondary); font-size:0.9rem;">Installed Version:</span>
            <span id="ytdlp-version-badge" class="badge" style="background:var(--bg-elevated);color:var(--text-secondary);">Loading...</span>
          </div>

          <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
            <button id="ytdlp-update-btn" class="btn btn-ghost">⚡ Update yt-dlp</button>
          </div>

          <div id="ytdlp-update-result" style="margin-top:12px; display:none;"></div>
        </div>

        <!-- System Management Card -->
        <div class="card fade-up" style="animation-delay:0.3s;">
          <div class="card-title">⚙️ System Management</div>
          <p style="color:var(--text-secondary); font-size:0.9rem; margin-bottom:16px;">
            Manage the application codebase. You can pull the latest updates from GitHub or roll back the codebase to a previous commit.
          </p>

          <div style="font-weight:600; color:var(--text-primary); font-size:0.95rem; margin-bottom:12px;">Recent Commit History:</div>
          <div id="commits-list-container" style="margin-bottom:20px; display:flex; flex-direction:column; gap:8px;">
            <div style="color:var(--text-secondary); text-align:center; padding:12px;">Loading commit history...</div>
          </div>

          <div style="display:flex; justify-content:flex-start;">
            <button id="app-update-btn" class="btn btn-primary">
              ⚡ Pull Latest Update
            </button>
          </div>
        </div>

        <!-- How to get credentials -->
        <div class="card fade-up" style="animation-delay:0.4s;">
          <div class="card-title">📖 How to Get Google Drive Credentials</div>
          <ol style="padding-left: 20px; line-height: 2; color: var(--text-secondary); font-size:0.9rem;">
            <li>Go to <a href="https://console.cloud.google.com" target="_blank" style="color:var(--accent-light);">Google Cloud Console</a> and create a project.</li>
            <li>Enable the <strong style="color:var(--text-primary);">Google Drive API</strong>.</li>
            <li>Create OAuth 2.0 credentials (Desktop or Web application).</li>
            <li>Use <a href="https://developers.google.com/oauthplayground" target="_blank" style="color:var(--accent-light);">OAuth Playground</a> to generate a refresh token with the <code style="background:var(--bg-elevated);padding:2px 6px;border-radius:4px;">drive.file</code> scope.</li>
            <li>Paste the values above and click <strong style="color:var(--text-primary);">Save Settings</strong>.</li>
          </ol>
        </div>
      </main>
    </div>
  `;

  // Navigation
  document.getElementById('nav-dashboard').addEventListener('click', () => onNavigate('dashboard'));
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api.logout();
    onNavigate('logout');
  });

  // Load existing settings
  api.getSettings().then(s => {
    if (s.clientId) document.getElementById('clientId').value = s.clientId;
    if (s.redirectUri) document.getElementById('redirectUri').value = s.redirectUri;
    if (s.clientSecret) document.getElementById('clientSecret').placeholder = 'Saved (hidden)';
    if (s.hasRefreshToken) document.getElementById('refreshToken').placeholder = 'Saved (hidden)';
    if (s.torrentBatchSizeGB) document.getElementById('torrentBatchSizeGB').value = s.torrentBatchSizeGB;
  }).catch(err => {
    const box = document.getElementById('settings-load-error');
    box.textContent = 'Could not load current settings: ' + err.message;
    box.style.display = 'flex';
  });

  // Save settings
  document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const btn = document.getElementById('save-settings-btn');
    const resultBox = document.getElementById('settings-result');

    resultBox.style.display = 'none';
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    try {
      await api.saveSettings({
        clientId: document.getElementById('clientId').value.trim(),
        clientSecret: document.getElementById('clientSecret').value,
        redirectUri: document.getElementById('redirectUri').value.trim(),
        refreshToken: document.getElementById('refreshToken').value,
        torrentBatchSizeGB: parseFloat(document.getElementById('torrentBatchSizeGB').value)
      });

      resultBox.className = 'alert alert-success';
      resultBox.textContent = '✅ Settings saved successfully.';
      resultBox.style.display = 'flex';

      // Clear password fields after save
      document.getElementById('clientSecret').value = '';
      document.getElementById('refreshToken').value = '';
      document.getElementById('clientSecret').placeholder = 'Saved (hidden)';
      document.getElementById('refreshToken').placeholder = 'Saved (hidden)';

    } catch (err) {
      resultBox.className = 'alert alert-error';
      resultBox.textContent = '❌ ' + err.message;
      resultBox.style.display = 'flex';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Settings';
    }
  });

  // --- Cookies section ---
  const cookiesStatusMsg = document.getElementById('cookies-status-msg');
  const cookiesResult = document.getElementById('cookies-result');
  const cookiesRemoveBtn = document.getElementById('cookies-remove-btn');
  const cookiesFileInput = document.getElementById('cookies-file-input');
  const cookiesUploadBtn = document.getElementById('cookies-upload-btn');

  function setCookiesStatus(hasCookies) {
    if (hasCookies) {
      cookiesStatusMsg.innerHTML = '<span class="badge badge-success">✅ cookies.txt is active</span>';
      cookiesRemoveBtn.style.display = 'inline-flex';
    } else {
      cookiesStatusMsg.innerHTML = '<span class="badge" style="background:var(--bg-elevated);color:var(--text-secondary);">No cookies uploaded</span>';
      cookiesRemoveBtn.style.display = 'none';
    }
  }

  api.getCookiesStatus().then(s => setCookiesStatus(s.hasCookies)).catch(() => {});

  cookiesUploadBtn.addEventListener('click', () => cookiesFileInput.click());

  cookiesFileInput.addEventListener('change', async () => {
    const file = cookiesFileInput.files[0];
    if (!file) return;

    cookiesUploadBtn.disabled = true;
    cookiesUploadBtn.innerHTML = '<span class="spinner"></span>';
    console.log('[SETTINGS] Cookie upload initiated for file:', file.name, 'size:', file.size);
    try {
      await api.uploadCookies(file);
      console.log('[SETTINGS] Cookie upload successful.');
      setCookiesStatus(true);
      cookiesResult.className = 'alert alert-success';
      cookiesResult.textContent = '✅ cookies.txt uploaded successfully.';
      cookiesResult.style.display = 'flex';
    } catch (err) {
      cookiesResult.className = 'alert alert-error';
      cookiesResult.textContent = '❌ ' + err.message;
      cookiesResult.style.display = 'flex';
    } finally {
      cookiesUploadBtn.disabled = false;
      cookiesUploadBtn.textContent = '📂 Upload cookies.txt';
      cookiesFileInput.value = '';
    }
  });

  cookiesRemoveBtn.addEventListener('click', async () => {
    cookiesRemoveBtn.disabled = true;
    try {
      await api.deleteCookies();
      setCookiesStatus(false);
      cookiesResult.className = 'alert alert-success';
      cookiesResult.textContent = '🗑 Cookies removed.';
      cookiesResult.style.display = 'flex';
    } catch (err) {
      cookiesResult.className = 'alert alert-error';
      cookiesResult.textContent = '❌ ' + err.message;
      cookiesResult.style.display = 'flex';
    } finally {
      cookiesRemoveBtn.disabled = false;
    }
  });

  // --- yt-dlp Engine section ---
  const ytdlpVersionBadge = document.getElementById('ytdlp-version-badge');
  const ytdlpUpdateBtn = document.getElementById('ytdlp-update-btn');
  const ytdlpUpdateResult = document.getElementById('ytdlp-update-result');

  async function loadYtdlpVersion() {
    try {
      const data = await api.getYtdlpVersion();
      if (data.success) {
        ytdlpVersionBadge.textContent = data.version;
        ytdlpVersionBadge.className = 'badge badge-success';
        ytdlpVersionBadge.style.background = '';
        ytdlpVersionBadge.style.color = '';
      } else {
        ytdlpVersionBadge.textContent = data.version || 'Not Installed / Error';
        ytdlpVersionBadge.className = 'badge badge-error';
        ytdlpVersionBadge.style.background = '';
        ytdlpVersionBadge.style.color = '';
      }
    } catch (err) {
      ytdlpVersionBadge.textContent = 'Error: ' + err.message;
      ytdlpVersionBadge.className = 'badge badge-error';
      ytdlpVersionBadge.style.background = '';
      ytdlpVersionBadge.style.color = '';
    }
  }

  loadYtdlpVersion();

  ytdlpUpdateBtn.addEventListener('click', async () => {
    ytdlpUpdateBtn.disabled = true;
    ytdlpUpdateBtn.innerHTML = '<span class="spinner"></span> Updating...';
    ytdlpUpdateResult.style.display = 'none';

    try {
      const data = await api.updateYtdlp();
      if (data.success) {
        ytdlpUpdateResult.className = 'alert alert-success';
        ytdlpUpdateResult.textContent = '✅ yt-dlp updated successfully.';
        ytdlpUpdateResult.style.display = 'flex';
        await loadYtdlpVersion();
      } else {
        throw new Error(data.error || 'Failed to update.');
      }
    } catch (err) {
      ytdlpUpdateResult.className = 'alert alert-error';
      ytdlpUpdateResult.textContent = '❌ ' + err.message;
      ytdlpUpdateResult.style.display = 'flex';
    } finally {
      ytdlpUpdateBtn.disabled = false;
      ytdlpUpdateBtn.textContent = '⚡ Update yt-dlp';
    }
  });

  // --- System Management section ---
  const commitsListContainer = document.getElementById('commits-list-container');
  const appUpdateBtn = document.getElementById('app-update-btn');

  function showSystemRestartOverlay(message) {
    let overlay = document.getElementById('restart-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'restart-overlay';
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(13, 13, 18, 0.85);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        z-index: 99999;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        color: var(--text-primary);
        font-family: var(--font);
        animation: fadeIn 0.3s ease;
      `;
      overlay.innerHTML = `
        <div style="background: var(--bg-surface); padding: 32px 48px; border-radius: var(--radius-lg); border: 1px solid var(--border); box-shadow: var(--shadow-lg); text-align: center; max-width: 400px; display: flex; flex-direction: column; align-items: center; gap: 16px;">
          <span class="spinner" style="width: 40px; height: 40px; border-width: 3px;"></span>
          <h3 id="restart-title" style="margin: 0; font-size: 1.2rem; font-weight: 700; background: var(--accent-gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">System Updating...</h3>
          <p id="restart-desc" style="margin: 0; font-size: 0.9rem; color: var(--text-secondary); line-height: 1.5;">Rebuilding assets, compiling packages, and restarting yt2gd. Please keep this tab open.</p>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    document.getElementById('restart-title').textContent = message;
  }

  function hideSystemRestartOverlay() {
    const overlay = document.getElementById('restart-overlay');
    if (overlay) overlay.remove();
  }

  function pollServerRestart() {
    console.log('[SYSTEM] Starting server restart polling...');
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.ok) {
          clearInterval(interval);
          console.log('[SYSTEM] Server is back online! Reloading page...');
          window.location.reload();
        }
      } catch (e) {
        // Expected network failures while server is rebuilding/restarting
      }
    }, 2000);
  }

  async function loadCommits() {
    try {
      const data = await api.getCommits();
      if (data.success && data.commits) {
        commitsListContainer.innerHTML = data.commits.map(commit => `
          <div class="commit-item" style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; background:var(--bg-elevated); border:1px solid var(--border); border-radius:var(--radius-sm); transition:all var(--transition);">
            <div style="display:flex; flex-direction:column; gap:4px; min-width:0; flex:1;">
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <code style="background:var(--bg-surface); padding:2px 6px; border-radius:4px; font-size:0.75rem; color:var(--accent-light); font-weight:600;">${commit.shortHash}</code>
                ${commit.isActive ? '<span class="badge badge-success" style="font-size:0.65rem; padding:1px 6px;">Active</span>' : ''}
                <span style="font-size:0.75rem; color:var(--text-muted);">${commit.date}</span>
              </div>
              <div style="font-size:0.85rem; font-weight:500; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${commit.subject}">${commit.subject}</div>
            </div>
            ${!commit.isActive ? `
              <button class="btn btn-ghost rollback-btn" data-hash="${commit.hash}" style="padding:6px 12px; font-size:0.75rem; height:auto; margin-left:12px;">Rollback</button>
            ` : ''}
          </div>
        `).join('');

        // Wire up rollback buttons
        document.querySelectorAll('.rollback-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const hash = e.target.getAttribute('data-hash');
            if (confirm(`Are you sure you want to roll back the codebase to commit ${hash.substring(0, 7)}?`)) {
              showSystemRestartOverlay('Rolling back system codebase...');
              try {
                const res = await api.rollbackApp(hash);
                if (res.success) {
                  pollServerRestart();
                } else {
                  throw new Error(res.error || 'Failed to roll back.');
                }
              } catch (err) {
                hideSystemRestartOverlay();
                alert('❌ Rollback failed: ' + err.message);
              }
            }
          });
        });
      } else {
        commitsListContainer.innerHTML = '<div style="color:var(--error); text-align:center; padding:12px;">❌ Could not load commit history.</div>';
      }
    } catch (err) {
      commitsListContainer.innerHTML = `<div style="color:var(--error); text-align:center; padding:12px;">❌ Error loading commit history: ${err.message}</div>`;
    }
  }

  loadCommits();

  appUpdateBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to pull the latest changes from GitHub and update the application?')) {
      showSystemRestartOverlay('Updating Application...');
      try {
        const res = await api.updateApp();
        if (res.success) {
          pollServerRestart();
        } else {
          throw new Error(res.error || 'Failed to update.');
        }
      } catch (err) {
        hideSystemRestartOverlay();
        alert('❌ Update failed: ' + err.message);
      }
    }
  });
}
