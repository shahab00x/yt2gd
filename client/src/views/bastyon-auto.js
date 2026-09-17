import { api } from '../api.js';

const AUDIO_TRACKS = [
  { value: 'original', label: 'Original (default)' },
  { value: 'en', label: 'English' },
  { value: 'fa', label: 'Farsi' },
  { value: 'ar', label: 'Arabic' },
  { value: 'tr', label: 'Turkish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
];

const state = {
  watchers: [],
  accounts: [],
  unlocked: false,
  editingId: null,
  checking: {},
  busy: false,
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function timeAgo(ts) {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return 'just now';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} h ago`;
  return new Date(ts).toLocaleString();
}

function statusBadge(w) {
  if (w.lastStatus === 'ok') return '<span class="badge badge-success">✅ Healthy</span>';
  if (w.lastStatus === 'error') return '<span class="badge badge-error">❌ Error</span>';
  if (w.lastStatus === 'skipped_locked') return '<span class="badge" style="background:var(--warning-bg);color:var(--warning);">⏸ Paused — vault locked</span>';
  return '<span class="badge" style="background:var(--bg-elevated);color:var(--text-secondary);">🆕 Never checked</span>';
}

function accountOptions(selectedId = '') {
  return '<option value="">— Select account —</option>' +
    state.accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === selectedId ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
}

function audioTrackOptions(selected = 'original') {
  return AUDIO_TRACKS.map((t) => `<option value="${t.value}" ${t.value === selected ? 'selected' : ''}>${esc(t.label)}</option>`).join('');
}

export function renderBastyonAuto(username, onNavigate) {
  const app = document.getElementById('app');

  app.innerHTML = `
    <div class="app-layout">
      <aside class="sidebar">
        <div class="sidebar-logo">
          <div class="logo-icon">⬆</div>
          <span>yt2gd</span>
        </div>
        <nav class="sidebar-nav">
          <button class="nav-item" id="nav-dashboard">
            <span class="nav-icon">🏠</span> Dashboard
          </button>
          <button class="nav-item" id="nav-bastyon">
            <span class="nav-icon">📤</span> Bastyon Uploader
          </button>
          <button class="nav-item active" id="nav-bastyon-auto">
            <span class="nav-icon">🤖</span> Bastyon Auto
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

      <main class="main-content">
        <div class="page-header fade-up">
          <h1>🤖 Bastyon Auto-Upload</h1>
          <p>Watch a YouTube channel or playlist and auto-publish new videos to Bastyon.</p>
        </div>

        <div id="vault-banner"></div>

        <!-- Watchers list -->
        <div class="card fade-up">
          <div class="card-title" style="display:flex; justify-content:space-between; align-items:center;">
            <span>👀 Watchers</span>
            <span id="watchers-count" class="badge" style="background:var(--bg-elevated); color:var(--text-secondary); font-size:0.7rem;"></span>
          </div>
          <div id="watchers-list-container"><p class="hint" style="padding:12px 0;">Loading watchers…</p></div>
        </div>

        <!-- Add / Edit form -->
        <div class="card fade-up" style="animation-delay:0.05s;">
          <div class="card-title" id="watcher-form-title">＋ Add Watcher</div>
          <div id="no-accounts-hint" class="alert alert-error" style="display:none; margin-bottom:16px;">
            No Bastyon accounts yet — <a href="#" id="goto-bastyon-link" style="color:inherit; font-weight:bold;">add one in Bastyon Uploader first</a>.
          </div>
          <div class="settings-grid">
            <div class="form-group">
              <label for="watcher-name">Name</label>
              <input id="watcher-name" class="form-control" type="text" placeholder="e.g. Daily tech news" />
            </div>
            <div class="form-group">
              <label for="watcher-type">Source type</label>
              <select id="watcher-type" class="form-control">
                <option value="channel">📺 YouTube channel (new uploads + finished streams)</option>
                <option value="playlist">📋 YouTube playlist (newly added videos)</option>
              </select>
            </div>
            <div class="form-group" style="grid-column: 1 / -1;">
              <label for="watcher-url">Source URL</label>
              <input id="watcher-url" class="form-control" type="url" placeholder="https://www.youtube.com/@somechannel/videos  or  …/playlist?list=PL…" />
              <p class="hint" id="watcher-url-hint">Channel: @handle, /channel/…, /c/… or /user/… URL. Live videos are skipped; finished livestreams are uploaded.</p>
            </div>
            <div class="form-group">
              <label for="watcher-account">Bastyon account</label>
              <select id="watcher-account" class="form-control"></select>
            </div>
            <div class="form-group">
              <label for="watcher-format">Format</label>
              <select id="watcher-format" class="form-control">
                <option value="video">🎬 Video</option>
                <option value="audio">🎵 Audio only</option>
              </select>
            </div>
            <div class="form-group">
              <label for="watcher-quality">Quality</label>
              <select id="watcher-quality" class="form-control">
                <option value="best">Best available</option>
                <option value="1080">1080p</option>
                <option value="720">720p</option>
                <option value="480">480p</option>
                <option value="360">360p</option>
                <option value="worst">Lowest</option>
              </select>
            </div>
            <div class="form-group">
              <label for="watcher-audio">Audio track</label>
              <select id="watcher-audio" class="form-control">${audioTrackOptions()}</select>
            </div>
            <div class="form-group">
              <label for="watcher-interval">Check every (minutes, 5–1440)</label>
              <input id="watcher-interval" class="form-control" type="number" min="5" max="1440" value="15" />
            </div>
            <div class="form-group">
              <label for="watcher-limit">Max uploads per 24h (1–50)</label>
              <input id="watcher-limit" class="form-control" type="number" min="1" max="50" value="5" />
            </div>
          </div>
          <p class="hint" id="watcher-mode-hint">Channel mode: uploads videos posted <strong>after creation</strong> — the archive is never backfilled. Oldest first, up to the daily limit, each video once. Uploads keep the title, description, tags, and gain a 🔗 link to the original. Videos that can't download yet (e.g. still live) retry automatically.</p>
          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:12px;">
            <button id="watcher-save-btn" class="btn btn-primary">💾 Save Watcher</button>
            <button id="watcher-cancel-btn" class="btn btn-ghost" style="display:none;">Cancel</button>
          </div>
          <div id="watcher-form-msg" style="margin-top:12px; display:none;"></div>
        </div>

        <!-- How it works -->
        <div class="card fade-up" style="animation-delay:0.1s;">
          <div class="card-title">ℹ️ How it works</div>
          <ul style="color:var(--text-secondary); font-size:0.9rem; line-height:1.7; margin:0; padding-left:20px;">
            <li>Every minute the server checks watchers whose interval has elapsed (one at a time).</li>
            <li>Pointing a watcher at a channel with hundreds of videos is safe: existing videos are remembered and <strong>skipped</strong> — only videos posted after creation upload, oldest first, up to the daily limit.</li>
            <li>Channels: currently-live and upcoming streams are skipped; finished livestreams upload like normal videos. A stream that is still live when checked is retried on later checks.</li>
            <li>Failures after a successful download stay as <strong>failed drafts in Bastyon Uploader → Drafts</strong> where you can retry manually — details appear under the watcher.</li>
            <li>While the vault is <strong>locked</strong> (e.g. after a server restart) checks are paused — unlock it in Bastyon Uploader to resume. Nothing uploads twice.</li>
          </ul>
        </div>
      </main>
    </div>
  `;

  // ---------------- Navigation ----------------
  document.getElementById('nav-dashboard').addEventListener('click', () => onNavigate('dashboard'));
  document.getElementById('nav-bastyon').addEventListener('click', () => onNavigate('bastyon'));
  document.getElementById('nav-settings').addEventListener('click', () => onNavigate('settings'));
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api.logout();
    onNavigate('logout');
  });
  document.getElementById('goto-bastyon-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    onNavigate('bastyon');
  });

  // ---------------- Data loading ----------------
  async function loadWatchers() {
    try {
      const data = await api.bastyon.watchers.list();
      state.watchers = data.watchers || [];
      renderWatchersList();
    } catch (e) { console.error('Failed to load watchers:', e); }
  }

  async function loadAccounts() {
    try {
      const data = await api.bastyon.getAccounts();
      state.accounts = data.accounts || [];
      const sel = document.getElementById('watcher-account');
      if (sel && !state.editingId) sel.innerHTML = accountOptions();
      document.getElementById('no-accounts-hint').style.display = state.accounts.length ? 'none' : 'flex';
    } catch (e) { console.error('Failed to load accounts:', e); }
  }

  async function loadVault() {
    try {
      const data = await api.bastyon.vaultStatus();
      state.unlocked = !!data.unlocked;
      renderVaultBanner();
    } catch (e) { console.error('Failed to load vault status:', e); }
  }

  function renderVaultBanner() {
    const banner = document.getElementById('vault-banner');
    if (state.unlocked) {
      banner.innerHTML = `
        <div class="alert alert-success fade-up" style="display:flex; margin-bottom:20px;">
          🔓 Vault unlocked — auto-uploads are running.
        </div>`;
    } else {
      banner.innerHTML = `
        <div class="alert alert-error fade-up" style="display:flex; margin-bottom:20px;">
          🔒 Vault locked — auto-upload checks are paused until you unlock it in Bastyon Uploader (needed after every server restart).
        </div>`;
    }
  }

  function renderWatchersList() {
    const container = document.getElementById('watchers-list-container');
    document.getElementById('watchers-count').textContent = `${state.watchers.length} watcher${state.watchers.length === 1 ? '' : 's'}`;
    if (!state.watchers.length) {
      container.innerHTML = '<p class="hint" style="padding:12px 0;">No watchers yet — add one below to start auto-uploading.</p>';
      return;
    }
    container.innerHTML = state.watchers.map((w) => {
      const checking = !!state.checking[w.id];
      const errors = (w.recentErrors || []).slice(0, 3).map((e) => `
        <div class="file-meta" style="color:var(--error);">❌ ${esc(e.videoId || '')}: ${esc((e.error || '').slice(0, 160))}</div>
      `).join('');
      return `
      <div class="history-item" style="margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
          <div>
            <strong>${esc(w.name)}</strong>
            <span class="badge" style="background:var(--bg-elevated); color:var(--text-secondary); margin-left:8px;">${w.type === 'channel' ? '📺 Channel' : '📋 Playlist'}</span>
            ${w.enabled ? '' : '<span class="badge" style="background:var(--bg-elevated); color:var(--text-secondary); margin-left:4px;">Disabled</span>'}
          </div>
          <div>${statusBadge(w)}</div>
        </div>
        <div class="file-meta" style="margin-top:6px;">
          <a href="${esc(w.sourceUrl)}" target="_blank" rel="noopener" style="color:var(--accent-light); word-break:break-all;">${esc(w.sourceUrl)}</a>
        </div>
        <div class="file-meta">
          👤 ${esc(w.accountName || '—')} · 🎞 ${esc(w.quality)} ${esc(w.format)} · 🔁 every ${esc(w.checkIntervalMinutes)} min · 📤 today ${esc(w.uploadsToday)}/${esc(w.dailyLimit)} · 🕒 checked ${esc(timeAgo(w.lastCheckAt))}
        </div>
        <div class="file-meta">
          📦 ${esc(w.seenCount || 0)} older video${(w.seenCount || 0) === 1 ? '' : 's'} skipped · Watching since ${esc(w.createdAt ? new Date(w.createdAt).toLocaleDateString() : '—')}
        </div>
        ${w.lastError ? `<div class="file-meta" style="color:var(--warning);">⚠️ ${esc(w.lastError.slice(0, 200))}</div>` : ''}
        ${errors}
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
          <button class="btn btn-ghost" style="padding:4px 12px; font-size:0.75rem;" data-action="check" data-id="${esc(w.id)}" ${checking ? 'disabled' : ''}>${checking ? '⏳ Checking…' : '🔍 Check now'}</button>
          <button class="btn btn-ghost" style="padding:4px 12px; font-size:0.75rem;" data-action="toggle" data-id="${esc(w.id)}">${w.enabled ? '⏸ Disable' : '▶ Enable'}</button>
          <button class="btn btn-ghost" style="padding:4px 12px; font-size:0.75rem;" data-action="edit" data-id="${esc(w.id)}">✏️ Edit</button>
          <button class="btn btn-ghost" style="padding:4px 12px; font-size:0.75rem;" data-action="reset" data-id="${esc(w.id)}">⟲ Reset history</button>
          <button class="btn btn-ghost" style="padding:4px 12px; font-size:0.75rem; color:var(--error);" data-action="delete" data-id="${esc(w.id)}">🗑 Delete</button>
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => handleWatcherAction(btn.dataset.action, btn.dataset.id));
    });
  }

  async function handleWatcherAction(action, id) {
    if (action === 'edit') return startEdit(id);
    if (action === 'reset') {
      const w = state.watchers.find((x) => x.id === id);
      if (!confirm(`Reset history for "${w?.name || id}"? Seen videos, upload log and errors are cleared (settings kept). The next check re-learns existing videos without uploading, then monitoring resumes.`)) return;
      try {
        await api.bastyon.watchers.reset(id);
        await loadWatchers();
      } catch (e) { alert(`❌ ${e.message}`); }
      return;
    }
    if (action === 'delete') {
      const w = state.watchers.find((x) => x.id === id);
      if (!confirm(`Delete watcher "${w?.name || id}"? Already-uploaded videos stay published; nothing else changes.`)) return;
      try {
        await api.bastyon.watchers.remove(id);
        if (state.editingId === id) resetForm();
        await loadWatchers();
      } catch (e) { alert(`❌ ${e.message}`); }
      return;
    }
    if (action === 'toggle') {
      const w = state.watchers.find((x) => x.id === id);
      try {
        await api.bastyon.watchers.update(id, { enabled: !w.enabled });
        await loadWatchers();
      } catch (e) { alert(`❌ ${e.message}`); }
      return;
    }
    if (action === 'check') {
      state.checking[id] = true;
      renderWatchersList();
      try {
        const res = await api.bastyon.watchers.checkNow(id);
        const r = res.result || {};
        if (r.skipped) {
          alert(r.reason === 'vault_locked' ? '⏸ Vault is locked — unlock it in Bastyon Uploader first.' : 'Check skipped.');
        } else if (r.seeded) {
          alert(`✅ First check complete — remembered ${r.discovered} existing video(s). Only future videos will upload.`);
        } else {
          alert(`✅ Checked ${r.checked} video(s): ${r.uploaded.length} uploaded, ${r.failed.length} failed${r.skippedOverLimit ? `, ${r.skippedOverLimit} deferred by daily limit` : ''}.`);
        }
      } catch (e) { alert(`❌ ${e.message}`); }
      finally {
        delete state.checking[id];
        await loadWatchers();
      }
    }
  }

  // ---------------- Form ----------------
  const MODE_HINTS = {
    channel: 'Channel mode: uploads videos posted <strong>after creation</strong> — the archive is never backfilled. Oldest first, up to the daily limit, each video once. Uploads keep the title, description, tags, and gain a 🔗 link to the original. Videos that can\'t download yet (e.g. still live) retry automatically.',
    playlist: 'Playlist mode: uploads <strong>newly added</strong> videos — existing items are remembered and skipped. Oldest first, up to the daily limit, each video once. Uploads keep the title, description, tags, and gain a 🔗 link to the original.',
  };
  document.getElementById('watcher-type').addEventListener('change', (e) => {
    const isPlaylist = e.target.value === 'playlist';
    document.getElementById('watcher-url-hint').textContent = isPlaylist
      ? 'Playlist: any public playlist URL containing "list=". Only newly added videos upload, each once.'
      : 'Channel: @handle, /channel/…, /c/… or /user/… URL. Live videos are skipped; finished livestreams are uploaded.';
    document.getElementById('watcher-mode-hint').innerHTML = isPlaylist ? MODE_HINTS.playlist : MODE_HINTS.channel;
  });

  document.getElementById('watcher-save-btn').addEventListener('click', saveWatcher);
  document.getElementById('watcher-cancel-btn').addEventListener('click', resetForm);

  function readForm() {
    return {
      name: document.getElementById('watcher-name').value.trim(),
      type: document.getElementById('watcher-type').value,
      sourceUrl: document.getElementById('watcher-url').value.trim(),
      accountId: document.getElementById('watcher-account').value,
      format: document.getElementById('watcher-format').value,
      quality: document.getElementById('watcher-quality').value,
      audioLanguage: document.getElementById('watcher-audio').value,
      checkIntervalMinutes: Number(document.getElementById('watcher-interval').value),
      dailyLimit: Number(document.getElementById('watcher-limit').value),
    };
  }

  function showFormMsg(kind, text) {
    const box = document.getElementById('watcher-form-msg');
    box.className = kind === 'ok' ? 'alert alert-success' : 'alert alert-error';
    box.textContent = text;
    box.style.display = 'flex';
  }

  async function saveWatcher() {
    if (state.busy) return;
    state.busy = true;
    try {
      const payload = readForm();
      let watcher;
      if (state.editingId) {
        const res = await api.bastyon.watchers.update(state.editingId, payload);
        watcher = res.watcher;
        showFormMsg('ok', `✅ Watcher "${watcher.name}" updated.`);
      } else {
        const res = await api.bastyon.watchers.create(payload);
        watcher = res.watcher;
        showFormMsg('ok', `✅ Watcher "${watcher.name}" added. The first check only remembers existing videos — new ones will upload automatically.`);
      }
      resetForm({ keepMsg: true });
      await loadWatchers();
    } catch (e) {
      showFormMsg('error', `❌ ${e.message}`);
    } finally {
      state.busy = false;
    }
  }

  function startEdit(id) {
    const w = state.watchers.find((x) => x.id === id);
    if (!w) return;
    state.editingId = id;
    document.getElementById('watcher-form-title').textContent = `✏️ Edit Watcher — ${w.name}`;
    document.getElementById('watcher-name').value = w.name || '';
    document.getElementById('watcher-type').value = w.type || 'channel';
    document.getElementById('watcher-mode-hint').innerHTML = (w.type === 'playlist') ? MODE_HINTS.playlist : MODE_HINTS.channel;
    document.getElementById('watcher-url').value = w.sourceUrl || '';
    document.getElementById('watcher-account').innerHTML = accountOptions(w.accountId);
    document.getElementById('watcher-format').value = w.format || 'video';
    document.getElementById('watcher-quality').value = w.quality || 'best';
    document.getElementById('watcher-audio').value = w.audioLanguage || 'original';
    document.getElementById('watcher-interval').value = w.checkIntervalMinutes ?? 15;
    document.getElementById('watcher-limit').value = w.dailyLimit ?? 5;
    document.getElementById('watcher-cancel-btn').style.display = '';
    document.getElementById('watcher-form-msg').style.display = 'none';
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  function resetForm({ keepMsg = false } = {}) {
    state.editingId = null;
    document.getElementById('watcher-form-title').textContent = '＋ Add Watcher';
    document.getElementById('watcher-name').value = '';
    document.getElementById('watcher-type').value = 'channel';
    document.getElementById('watcher-mode-hint').innerHTML = MODE_HINTS.channel;
    document.getElementById('watcher-url').value = '';
    document.getElementById('watcher-account').innerHTML = accountOptions();
    document.getElementById('watcher-format').value = 'video';
    document.getElementById('watcher-quality').value = 'best';
    document.getElementById('watcher-audio').value = 'original';
    document.getElementById('watcher-interval').value = 15;
    document.getElementById('watcher-limit').value = 5;
    document.getElementById('watcher-cancel-btn').style.display = 'none';
    if (!keepMsg) document.getElementById('watcher-form-msg').style.display = 'none';
  }

  // ---------------- Boot + polling + cleanup ----------------
  async function refreshAll() {
    await loadAccounts();
    await loadWatchers();
    await loadVault();
  }

  refreshAll();
  const pollInterval = setInterval(async () => {
    await loadWatchers();
    await loadVault();
  }, 15000);

  const originalOnNavigate = onNavigate;
  onNavigate = (target) => {
    clearInterval(pollInterval);
    originalOnNavigate(target);
  };
}
