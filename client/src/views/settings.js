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
          </div>

          <div id="settings-result" style="margin-top:4px; display:none;"></div>

          <div class="divider"></div>

          <div style="display:flex; justify-content:flex-end;">
            <button id="save-settings-btn" class="btn btn-primary">
              Save Settings
            </button>
          </div>
        </div>

        <!-- How to get credentials -->
        <div class="card fade-up" style="animation-delay:0.1s;">
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
        refreshToken: document.getElementById('refreshToken').value
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
}
