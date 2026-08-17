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
  accounts: [],
  drafts: [],
  hasAccounts: false,
  unlocked: false,
  selectedDraftId: null,
  publishing: false,
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtBytes(b) {
  if (!b || b <= 0) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function accountOptions(selectedId = '') {
  return `<option value="">— Select account —</option>` +
    state.accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === selectedId ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
}

function audioTrackOptions(selected = 'original') {
  return AUDIO_TRACKS.map((t) => `<option value="${t.value}" ${t.value === selected ? 'selected' : ''}>${esc(t.label)}</option>`).join('');
}

function draftStatusBadge(status) {
  const map = {
    downloading: ['⏳ Downloading…', ''],
    draft: ['📝 Draft', ''],
    publishing: ['🚀 Publishing…', ''],
    published: ['✅ Published', 'badge-success'],
    failed: ['❌ Failed', 'badge-error'],
  };
  const [label, cls] = map[status] || [status, 'badge-error'];
  return `<span class="badge ${cls}">${label}</span>`;
}

export function renderBastyon(username, onNavigate) {
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
          <button class="nav-item active" id="nav-bastyon">
            <span class="nav-icon">📤</span> Bastyon Uploader
          </button>
          <button class="nav-item" id="nav-settings">
            <span class="nav-icon">⚙️</span> Settings
          </button>
        </nav>
        <div class="sidebar-footer">
          <div class="version-info" id="vault-chip" style="font-size:0.75rem;"></div>
          <button id="logout-btn" class="nav-item" style="color: var(--error);">
            <span class="nav-icon">🚪</span> Sign Out
          </button>
        </div>
      </aside>

      <main class="main-content">
        <div class="page-header fade-up">
          <h1>Bastyon Uploader</h1>
          <p>Download videos with yt-dlp and publish them to Bastyon (Pocketnet).</p>
        </div>

        <!-- Download & Create Post -->
        <div class="card fade-up">
          <div class="card-title">🎬 Download &amp; Create Post</div>
          <div class="form-group" style="margin:0 0 16px;">
            <label for="bastyon-account" style="font-size:0.82rem;">Publishing Account</label>
            <select id="bastyon-account" class="form-control" style="width:auto; min-width:240px; max-width:100%;">${accountOptions()}</select>
          </div>
          <div class="url-input-wrap" style="flex-wrap:wrap;">
            <input id="bastyon-url" class="form-control" type="url" style="min-width:190px;"
              placeholder="Paste any video URL supported by yt-dlp…" />
            <button id="bastyon-download-btn" class="btn btn-primary" style="white-space:nowrap; padding:14px 16px;">
              Download &amp; Create Post
            </button>
          </div>

          <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:center; margin-top:12px;">
            <div class="form-group" style="margin:0; flex:1; min-width:140px;">
              <label for="bastyon-format" style="font-size:0.82rem;">Format</label>
              <select id="bastyon-format" class="form-control" style="padding:8px 10px;">
                <option value="video">🎬 Video</option>
                <option value="audio">🎵 Audio only</option>
              </select>
            </div>
            <div class="form-group" style="margin:0; flex:1; min-width:140px;">
              <label for="bastyon-quality" style="font-size:0.82rem;">Quality</label>
              <select id="bastyon-quality" class="form-control" style="padding:8px 10px;">
                <option value="best">Best available</option>
                <option value="1080">1080p</option>
                <option value="720">720p</option>
                <option value="480">480p</option>
                <option value="360">360p</option>
                <option value="worst">Lowest</option>
              </select>
            </div>
            <div class="form-group" style="margin:0; flex:1; min-width:140px;">
              <label for="bastyon-audio-language" style="font-size:0.82rem;">Audio Track</label>
              <select id="bastyon-audio-language" class="form-control" style="padding:8px 10px;">
                ${audioTrackOptions()}
              </select>
            </div>
          </div>

          <p class="hint" style="margin-top:8px;">🍪 Cookies from Settings are used automatically. YouTube's auto-dubbed audio is skipped in favor of the original track.</p>

          <div id="bastyon-progress-section" style="display:none; margin-top: 20px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <div class="progress-label" style="margin-top: 0; display: inline-flex; align-items: center; gap: 10px;">
                <span id="bastyon-progress-step">Connecting…</span>
                <span id="bastyon-progress-detail" style="font-size:0.8rem; color:var(--text-secondary);"></span>
              </div>
              <button id="bastyon-cancel-btn" class="btn btn-ghost" style="padding: 4px 10px; font-size: 0.75rem; color: var(--error); border-color: var(--error-bg);">Stop</button>
            </div>
            <div class="progress-wrap" style="margin-top: 0;">
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" id="bastyon-progress-fill" style="width: 0%;"></div>
              </div>
            </div>
          </div>
          <div id="bastyon-download-result" style="margin-top:16px; display:none;"></div>
        </div>

        <!-- Accounts -->
        <div class="card fade-up" style="animation-delay:0.05s;">
          <div class="card-title" style="display:flex; justify-content:space-between; align-items:center;">
            <span>🔑 Bastyon Accounts</span>
            <div id="vault-actions"></div>
          </div>
          <div id="vault-panel"></div>
          <div class="divider"></div>
          <div id="accounts-container"></div>
        </div>

        <!-- Draft Editor -->
        <div class="card fade-up" id="draft-editor-card" style="display:none;">
          <div class="card-title" style="display:flex; justify-content:space-between; align-items:center;">
            <span>✏️ Draft Editor</span>
            <button id="new-post-btn" class="btn btn-ghost" style="padding:4px 12px; font-size:0.75rem;">＋ New Post</button>
          </div>

          <div class="settings-grid">
            <div class="form-group" style="grid-column: 1 / -1;">
              <label for="draft-title">Title</label>
              <input id="draft-title" class="form-control" type="text" placeholder="Post title (pre-filled from video)" />
            </div>
            <div class="form-group" style="grid-column: 1 / -1;">
              <label for="draft-description">Description</label>
              <textarea id="draft-description" class="form-control" rows="4" placeholder="Post body / description (pre-filled from video)"></textarea>
            </div>
            <div class="form-group" style="grid-column: 1 / -1;">
              <label for="draft-tags">Tags (comma separated)</label>
              <input id="draft-tags" class="form-control" type="text" placeholder="tech, crypto, vlog" />
            </div>
            <div class="form-group">
              <label for="draft-account">Publishing Account</label>
              <select id="draft-account" class="form-control"></select>
            </div>
            <div class="form-group">
              <label for="draft-trim-start">Trim Start <span class="hint" style="font-weight:normal;">(optional)</span></label>
              <input id="draft-trim-start" class="form-control" type="text" placeholder="e.g. 01:30" />
            </div>
            <div class="form-group">
              <label for="draft-trim-end">Trim End <span class="hint" style="font-weight:normal;">(optional)</span></label>
              <input id="draft-trim-end" class="form-control" type="text" placeholder="e.g. 02:45" />
            </div>
            <div class="form-group" style="grid-column: 1 / -1;">
              <label style="display:flex; align-items:center; gap:8px; font-size:0.9rem;">
                <input id="draft-transcode" type="checkbox" checked style="width:auto;" />
                Normalize video before upload (H.264 ≤720p, capped bitrate/fps — never upscales)
              </label>
            </div>
          </div>

          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:8px;">
            <button id="save-draft-btn" class="btn btn-ghost">💾 Save Changes</button>
            <button id="publish-draft-btn" class="btn btn-primary">🚀 Publish to Bastyon</button>
            <button id="delete-draft-btn" class="btn btn-ghost" style="color:var(--error);">🗑 Delete Draft</button>
          </div>

          <div id="publish-progress-section" style="display:none; margin-top: 16px;">
            <div class="progress-label" style="margin-top: 0; display: inline-flex; align-items: center; gap: 10px;">
              <span id="publish-progress-step">Preparing…</span>
              <span id="publish-progress-detail" style="font-size:0.8rem; color:var(--text-secondary);"></span>
            </div>
            <div class="progress-wrap" style="margin-top: 0;">
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" id="publish-progress-fill" style="width: 0%;"></div>
              </div>
            </div>
          </div>
          <div id="publish-result" style="margin-top:16px; display:none;"></div>
        </div>

        <!-- Drafts List -->
        <div class="card fade-up" style="animation-delay:0.05s;">
          <div class="card-title" style="display:flex; justify-content:space-between; align-items:center;">
            <span>📋 Drafts</span>
            <span id="drafts-count" class="badge" style="background:var(--bg-elevated); color:var(--text-secondary); font-size:0.7rem;"></span>
          </div>
          <div id="drafts-list-container"><p class="hint" style="padding:12px 0;">Loading drafts…</p></div>
        </div>

        <!-- Storage -->
        <div class="card fade-up" style="animation-delay:0.1s;">
          <div class="card-title" style="display:flex; justify-content:space-between; align-items:center;">
            <span>💾 Storage</span>
            <button id="clear-staging-btn" class="btn btn-ghost" style="padding:4px 10px; font-size:0.75rem; color:var(--error);">Clear Staging</button>
          </div>
          <div id="bastyon-storage-container"><div class="file-meta">Loading…</div></div>
        </div>
      </main>
    </div>
  `;

  // ---------------- Navigation ----------------
  document.getElementById('nav-dashboard').addEventListener('click', () => onNavigate('dashboard'));
  document.getElementById('nav-settings').addEventListener('click', () => onNavigate('settings'));
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api.logout();
    onNavigate('logout');
  });

  // ---------------- Data loading ----------------
  async function loadAccounts() {
    try {
      const data = await api.bastyon.getAccounts();
      state.accounts = data.accounts || [];
    } catch (e) { console.error('Failed to load accounts:', e); }
  }

  async function loadDrafts() {
    try {
      const data = await api.bastyon.getDrafts();
      state.drafts = data.drafts || [];
      renderDraftsList();
    } catch (e) { console.error('Failed to load drafts:', e); }
  }

  async function loadVault() {
    try {
      const data = await api.bastyon.vaultStatus();
      state.hasAccounts = data.hasAccounts;
      state.unlocked = data.unlocked;
      renderVault();
    } catch (e) { console.error('Failed to load vault status:', e); }
  }

  async function refreshStorage() {
    try {
      const data = await api.bastyon.getStorage();
      renderStorage(data);
    } catch (e) { console.error('Failed to load storage:', e); }
  }

  async function refreshAll() {
    await loadAccounts();
    await loadDrafts();
    await loadVault();
    refreshStorage();
    // Refresh account dropdowns
    const sel = document.getElementById('bastyon-account');
    if (sel) sel.innerHTML = accountOptions();
    const draftSel = document.getElementById('draft-account');
    if (draftSel && state.selectedDraftId) {
      const draft = state.drafts.find((d) => d.id === state.selectedDraftId);
      draftSel.innerHTML = accountOptions(draft?.accountId || '');
    }
  }

  // ---------------- Vault panel ----------------
  function renderVault() {
    // Vault state drives whether accounts can be managed — always re-render with it.
    renderAccounts();
    const panel = document.getElementById('vault-panel');
    const actions = document.getElementById('vault-actions');

    if (!state.hasAccounts && !state.unlocked) {
      panel.innerHTML = `
        <p style="color:var(--text-secondary); font-size:0.9rem; margin-bottom:12px;">
          Set a <strong>master passphrase</strong> to encrypt your Bastyon private keys on disk.
          It is <strong>never stored</strong> — you'll re-enter it after a server restart to publish.
        </p>
        <div class="alert alert-error" style="margin-bottom:12px; display:flex;">
          ⚠️ If you forget this passphrase, stored keys <strong>cannot be recovered</strong>.
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <input id="vault-pass-1" class="form-control" type="password" placeholder="Master passphrase" style="max-width:280px;" />
          <input id="vault-pass-2" class="form-control" type="password" placeholder="Confirm passphrase" style="max-width:280px;" />
          <button id="vault-set-btn" class="btn btn-primary">Set Passphrase</button>
        </div>
      `;
      actions.innerHTML = '';
      document.getElementById('vault-set-btn').addEventListener('click', setPassphrase);
      return;
    }

    if (!state.unlocked) {
      panel.innerHTML = `
        <p style="color:var(--text-secondary); font-size:0.9rem; margin-bottom:12px;">
          The vault is <strong>locked</strong>. Enter the master passphrase to <strong>add accounts</strong> and publish.
          The Add Account form appears below once unlocked.
        </p>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <input id="vault-unlock-input" class="form-control" type="password" placeholder="Master passphrase" style="max-width:280px;" />
          <button id="vault-unlock-btn" class="btn btn-primary">Unlock</button>
        </div>
        <div id="vault-unlock-msg" style="margin-top:8px;"></div>
      `;
      actions.innerHTML = `<span class="badge" style="background:var(--bg-elevated);color:var(--text-secondary);">🔒 Locked</span>`;
      document.getElementById('vault-unlock-btn').addEventListener('click', unlockVault);
      return;
    }

    panel.innerHTML = `
      <p style="color:var(--text-secondary); font-size:0.9rem; margin-bottom:12px;">
        The vault is <strong>unlocked</strong> — you can add accounts and publish.
        Keys are encrypted at rest with AES-256-GCM.
      </p>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <input id="vault-pass-new" class="form-control" type="password" placeholder="New passphrase (optional)" style="max-width:280px;" />
        <input id="vault-pass-new2" class="form-control" type="password" placeholder="Confirm new passphrase" style="max-width:280px;" />
        <button id="vault-rotate-btn" class="btn btn-ghost">Change Passphrase</button>
      </div>
      <div id="vault-rotate-msg" style="margin-top:8px;"></div>
    `;
    actions.innerHTML = `<span class="badge badge-success">🔓 Unlocked</span> <button id="vault-lock-btn" class="btn btn-ghost" style="padding:4px 10px; font-size:0.75rem;">Lock</button>`;
    document.getElementById('vault-rotate-btn').addEventListener('click', rotatePassphrase);
    document.getElementById('vault-lock-btn').addEventListener('click', async () => {
      await api.bastyon.lockVault();
      state.unlocked = false;
      renderVault();
    });
  }

  async function setPassphrase() {
    const p1 = document.getElementById('vault-pass-1').value;
    const p2 = document.getElementById('vault-pass-2').value;
    if (!p1 || p1 !== p2) return alert('Passphrases do not match.');
    try {
      await api.bastyon.setPassphrase(p1);
      state.unlocked = true;
      state.hasAccounts = false;
      renderVault();
    } catch (e) { alert(`❌ ${e.message}`); }
  }

  async function unlockVault() {
    const input = document.getElementById('vault-unlock-input');
    const msg = document.getElementById('vault-unlock-msg');
    try {
      await api.bastyon.unlockVault(input.value);
      state.unlocked = true;
      renderVault();
      renderAccounts();
    } catch (e) {
      msg.className = 'alert alert-error';
      msg.textContent = `❌ ${e.message}`;
      msg.style.display = 'flex';
    }
  }

  async function rotatePassphrase() {
    const p1 = document.getElementById('vault-pass-new').value;
    const p2 = document.getElementById('vault-pass-new2').value;
    const msg = document.getElementById('vault-rotate-msg');
    if (!p1 || p1 !== p2) return alert('Passphrases do not match.');
    try {
      await api.bastyon.setPassphrase(p1);
      msg.className = 'alert alert-success';
      msg.textContent = '✅ Passphrase changed; all keys re-encrypted.';
      msg.style.display = 'flex';
    } catch (e) {
      msg.className = 'alert alert-error';
      msg.textContent = `❌ ${e.message}`;
      msg.style.display = 'flex';
    }
  }

  // ---------------- Accounts ----------------
  function renderAccounts() {
    const container = document.getElementById('accounts-container');
    if (!state.unlocked) {
      container.innerHTML = `<p class="hint" style="padding:8px 0;">Unlock the vault to manage accounts.</p>`;
      return;
    }
    container.innerHTML = `
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px;">
        <input id="acc-name" class="form-control" type="text" placeholder="Account name" style="max-width:220px;" />
        <input id="acc-wif" class="form-control" type="password" placeholder="Private key — WIF or 64-char hex (hidden)" style="flex:1; min-width:260px;" />
        <button id="acc-add-btn" class="btn btn-primary">Add Account</button>
      </div>
      <p class="hint" style="margin-bottom:12px;">💡 Hex keys are converted to WIF automatically — paste either format.</p>
      <div id="acc-msg" style="margin-bottom:10px;"></div>
      <div class="history-list">
        ${state.accounts.length === 0
          ? `<p class="hint" style="padding:12px 0;">No accounts yet. Add one to publish.</p>`
          : state.accounts.map((a) => `
              <div class="history-item">
                <span class="file-icon">👤</span>
                <div class="file-info">
                  <div class="file-name">${esc(a.name)}</div>
                  <div class="file-meta">Added ${new Date(a.createdAt).toLocaleString()}</div>
                </div>
                <button class="btn btn-ghost acc-del-btn" data-id="${esc(a.id)}" style="padding:6px 12px; font-size:0.75rem; color:var(--error);">Remove</button>
              </div>
            `).join('')}
      </div>
    `;

    document.getElementById('acc-add-btn').addEventListener('click', async () => {
      const name = document.getElementById('acc-name').value.trim();
      const wif = document.getElementById('acc-wif').value.trim();
      const msg = document.getElementById('acc-msg');
      if (!name || !wif) return alert('Enter both a name and a private key (WIF or 64-char hex).');
      try {
        await api.bastyon.addAccount(name, wif);
        msg.className = 'alert alert-success';
        msg.textContent = `✅ Account "${name}" added (encrypted).`;
        msg.style.display = 'flex';
        document.getElementById('acc-name').value = '';
        document.getElementById('acc-wif').value = '';
        await refreshAll();
      } catch (e) {
        msg.className = 'alert alert-error';
        msg.textContent = `❌ ${e.message}`;
        msg.style.display = 'flex';
      }
    });

    container.querySelectorAll('.acc-del-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this account? Drafts that use it must be re-assigned before publishing.')) return;
        await api.bastyon.deleteAccount(btn.dataset.id);
        await refreshAll();
      });
    });
  }

  // ---------------- Drafts list ----------------
  function renderDraftsList() {
    const container = document.getElementById('drafts-list-container');
    const count = document.getElementById('drafts-count');
    count.textContent = `${state.drafts.length} draft${state.drafts.length === 1 ? '' : 's'}`;
    if (!state.drafts.length) {
      container.innerHTML = `<p class="hint" style="padding:12px 0;">No drafts yet. Download a video above.</p>`;
      return;
    }
    container.innerHTML = state.drafts.map((d) => `
      <div class="history-item ${d.id === state.selectedDraftId ? '' : ''}" style="cursor:pointer;" data-draft-id="${esc(d.id)}">
        <span class="file-icon">🎬</span>
        <div class="file-info">
          <div class="file-name">${esc(d.title || d.sourceUrl || 'Untitled')}</div>
          <div class="file-meta">${esc(d.accountName || 'No account')} · ${fmtBytes(d.fileSize)}${d.txid ? ` · TxID ${d.txid.slice(0, 12)}…` : ''}${d.error ? ` · ${esc(d.error.slice(0, 60))}` : ''}</div>
        </div>
        ${draftStatusBadge(d.status)}
      </div>
    `).join('');

    container.querySelectorAll('.history-item').forEach((row) => {
      row.addEventListener('click', () => selectDraft(row.dataset.draftId));
    });
  }

  // ---------------- Draft editor ----------------
  function selectDraft(id) {
    const draft = state.drafts.find((d) => d.id === id);
    if (!draft) return;
    state.selectedDraftId = id;
    const card = document.getElementById('draft-editor-card');
    card.style.display = 'block';
    document.getElementById('draft-title').value = draft.title || '';
    document.getElementById('draft-description').value = draft.description || '';
    document.getElementById('draft-tags').value = (draft.tags || []).join(', ');
    document.getElementById('draft-trim-start').value = draft.trimStart || '';
    document.getElementById('draft-trim-end').value = draft.trimEnd || '';
    document.getElementById('draft-transcode').checked = draft.transcode !== false;
    const accountSel = document.getElementById('draft-account');
    accountSel.innerHTML = accountOptions(draft.accountId || '');
    document.getElementById('publish-result').style.display = 'none';
    document.getElementById('publish-progress-section').style.display = 'none';
    renderDraftsList();
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function currentDraft() {
    return state.drafts.find((d) => d.id === state.selectedDraftId) || null;
  }

  async function saveDraftEdits() {
    const draft = currentDraft();
    if (!draft) return;
    const payload = {
      title: document.getElementById('draft-title').value,
      description: document.getElementById('draft-description').value,
      tags: document.getElementById('draft-tags').value,
      accountId: document.getElementById('draft-account').value,
      trimStart: document.getElementById('draft-trim-start').value.trim(),
      trimEnd: document.getElementById('draft-trim-end').value.trim(),
      transcode: document.getElementById('draft-transcode').checked,
    };
    const updated = await api.bastyon.updateDraft(draft.id, payload);
    state.drafts = state.drafts.map((d) => (d.id === updated.draft.id ? updated.draft : d));
    renderDraftsList();
    return updated.draft;
  }

  document.getElementById('save-draft-btn').addEventListener('click', async () => {
    try {
      await saveDraftEdits();
      showResult('publish-result', '✅ Draft saved.', 'success');
    } catch (e) { showResult('publish-result', `❌ ${e.message}`, 'error'); }
  });

  document.getElementById('delete-draft-btn').addEventListener('click', async () => {
    const draft = currentDraft();
    if (!draft) return;
    if (!confirm('Delete this draft and its downloaded file?')) return;
    await api.bastyon.deleteDraft(draft.id);
    state.selectedDraftId = null;
    document.getElementById('draft-editor-card').style.display = 'none';
    await loadDrafts();
  });

  document.getElementById('new-post-btn').addEventListener('click', () => {
    state.selectedDraftId = null;
    document.getElementById('draft-editor-card').style.display = 'none';
    document.getElementById('bastyon-url').focus();
  });

  document.getElementById('publish-draft-btn').addEventListener('click', publishDraft);

  async function publishDraft() {
    const draft = currentDraft();
    if (!draft) return;
    if (!state.unlocked) {
      alert('The vault is locked. Unlock it first (Accounts card) to publish.');
      return;
    }
    if (draft.status === 'publishing') return;

    try {
      await saveDraftEdits();
    } catch (e) { showResult('publish-result', `❌ ${e.message}`, 'error'); return; }

    const progressSection = document.getElementById('publish-progress-section');
    const progressFill = document.getElementById('publish-progress-fill');
    const progressStep = document.getElementById('publish-progress-step');
    const progressDetail = document.getElementById('publish-progress-detail');
    progressSection.style.display = 'block';
    progressFill.style.width = '5%';
    progressStep.textContent = 'Preparing…';
    progressDetail.textContent = '';
    showResult('publish-result', '', 'none');
    state.publishing = true;
    document.getElementById('publish-draft-btn').disabled = true;

    try {
      const res = await api.bastyon.publishDraft(draft.id);
      progressFill.style.width = '100%';
      showResult('publish-result', `✅ Post published successfully on the Bastyon blockchain!\nTxID: ${res.txid}`, 'success');
      await loadDrafts();
    } catch (e) {
      progressSection.style.display = 'none';
      showResult('publish-result', `❌ ${e.message}`, 'error');
      await loadDrafts();
    } finally {
      state.publishing = false;
      document.getElementById('publish-draft-btn').disabled = false;
    }
  }

  function showResult(id, text, kind) {
    const box = document.getElementById(id);
    if (kind === 'none') { box.style.display = 'none'; return; }
    box.className = `alert alert-${kind}`;
    box.innerHTML = text.replace(/\n/g, '<br/>');
    box.style.display = 'flex';
  }

  // ---------------- Storage ----------------
  function renderStorage(data) {
    const container = document.getElementById('bastyon-storage-container');
    const diskPercent = data.disk.total > 0 ? ((data.disk.used / data.disk.total) * 100).toFixed(0) : 0;
    const diskColor = diskPercent > 90 ? 'var(--error)' : diskPercent > 70 ? '#f0ad4e' : 'var(--success)';
    container.innerHTML = `
      <div style="margin-bottom:8px;">
        <div class="file-meta" style="margin-bottom:4px;">Disk: ${fmtBytes(data.disk.used)} / ${fmtBytes(data.disk.total)} (${diskPercent}% used)</div>
        <div style="background:var(--bg-elevated); border-radius:4px; height:8px; overflow:hidden;">
          <div style="background:${diskColor}; height:100%; width:${diskPercent}%; transition:width 0.3s;"></div>
        </div>
      </div>
      <div class="file-meta" style="margin-bottom:2px;">Bastyon staging: ${fmtBytes(data.staging.size)} (${data.staging.files.length} item${data.staging.files.length === 1 ? '' : 's'})</div>
      ${data.staging.files.length ? `<div style="display:flex; flex-direction:column; gap:4px; margin-top:8px;">${data.staging.files.slice(0, 8).map((f) => `<div class="file-meta" style="margin:0;">${esc(f.name)} · ${fmtBytes(f.size)}</div>`).join('')}</div>` : ''}
    `;
  }

  document.getElementById('clear-staging-btn').addEventListener('click', async () => {
    const unfinished = state.drafts.filter((d) => d.status !== 'published').length;
    if (!confirm(`Clear the Bastyon staging folder? This deletes ${unfinished} unfinished draft(s) and their downloaded files.`)) return;
    try {
      const res = await api.bastyon.clearStaging();
      state.selectedDraftId = null;
      document.getElementById('draft-editor-card').style.display = 'none';
      await loadDrafts();
      refreshStorage();
      alert(`✅ ${res.message}`);
    } catch (e) { alert(`❌ ${e.message}`); }
  });

  // ---------------- Download flow ----------------
  const urlInput = document.getElementById('bastyon-url');
  const downloadBtn = document.getElementById('bastyon-download-btn');
  const progressSection = document.getElementById('bastyon-progress-section');
  const progressFill = document.getElementById('bastyon-progress-fill');
  const progressStep = document.getElementById('bastyon-progress-step');
  const progressDetail = document.getElementById('bastyon-progress-detail');

  let downloadActive = false;

  downloadBtn.addEventListener('click', startDownload);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startDownload(); });
  document.getElementById('bastyon-cancel-btn').addEventListener('click', async () => {
    if (!downloadActive) return;
    document.getElementById('bastyon-cancel-btn').disabled = true;
    document.getElementById('bastyon-cancel-btn').textContent = 'Stopping…';
    try { await api.bastyon.cancel(); } catch (e) { /* ignore */ }
  });

  async function startDownload() {
    const url = urlInput.value.trim();
    if (!url) { urlInput.focus(); return; }
    const accountId = document.getElementById('bastyon-account').value || null;
    const format = document.getElementById('bastyon-format').value;
    const quality = document.getElementById('bastyon-quality').value;
    const audioLanguage = document.getElementById('bastyon-audio-language').value;

    downloadActive = true;
    progressSection.style.display = 'block';
    progressFill.style.width = '5%';
    progressStep.textContent = 'Connecting…';
    progressDetail.textContent = '';
    downloadBtn.disabled = true;
    downloadBtn.innerHTML = '<span class="spinner"></span>';
    document.getElementById('bastyon-cancel-btn').disabled = false;
    document.getElementById('bastyon-cancel-btn').textContent = 'Stop';
    document.getElementById('bastyon-download-result').style.display = 'none';

    try {
      const res = await api.bastyon.download(url, accountId, format, quality, audioLanguage);
      progressFill.style.width = '100%';
      progressStep.textContent = 'Download complete!';
      await loadDrafts();
      await refreshStorage();
      selectDraft(res.draft.id);
      showResult('bastyon-download-result', `✅ Downloaded. Edit the draft and publish it to Bastyon.`, 'success');
    } catch (e) {
      progressSection.style.display = 'none';
      showResult('bastyon-download-result', `❌ ${e.message}`, 'error');
      await loadDrafts();
      await refreshStorage();
    } finally {
      downloadActive = false;
      downloadBtn.disabled = false;
      downloadBtn.textContent = 'Download & Create Post';
    }
  }

  // ---------------- SSE progress ----------------
  const evtSource = api.bastyon.openProgressStream();
  const publishStep = document.getElementById('publish-progress-step');
  const publishFill = document.getElementById('publish-progress-fill');
  const publishDetail = document.getElementById('publish-progress-detail');

  evtSource.addEventListener('status', (e) => {
    const data = JSON.parse(e.data);
    if (data.phase === 'download') {
      progressStep.textContent = 'Downloading…';
      progressFill.style.width = '15%';
    } else if (data.phase === 'trim') {
      publishStep.textContent = 'Trimming…';
    } else if (data.phase === 'transcode') {
      publishStep.textContent = 'Normalizing video…';
    } else if (data.phase === 'thumbnail') {
      publishStep.textContent = 'Fetching thumbnail…';
    } else if (data.phase === 'upload') {
      publishStep.textContent = 'Uploading to PeerTube…';
      publishFill.style.width = '50%';
    } else if (data.phase === 'broadcast') {
      publishStep.textContent = 'Broadcasting to blockchain…';
      publishFill.style.width = '85%';
    }
  });

  evtSource.addEventListener('progress', (e) => {
    const data = JSON.parse(e.data);
    if (data.phase === 'download') {
      if (data.line) progressDetail.textContent = data.line.substring(0, 120);
    } else if (data.phase === 'upload' && data.label) {
      publishDetail.textContent = data.label;
    } else if (data.phase === 'transcode' && data.percent != null) {
      const percent = Math.max(0, Math.min(100, Math.round(data.percent)));
      publishFill.style.width = `${15 + Math.round((percent / 100) * 30)}%`;
      publishDetail.textContent = `Normalizing… ${percent}%`;
    }
  });

  evtSource.addEventListener('done', (e) => {
    const data = JSON.parse(e.data);
    if (data.draftId === state.selectedDraftId) {
      document.getElementById('publish-progress-fill').style.width = '100%';
      document.getElementById('publish-progress-step').textContent = 'Complete!';
    }
  });

  evtSource.addEventListener('error', (e) => {
    // publish errors surface via the fetch rejection; nothing to do here
    console.log('[Bastyon SSE] error event', e.data);
  });

  // ---------------- Polling + cleanup ----------------
  refreshAll();
  const pollInterval = setInterval(refreshAll, 10000);
  const storagePoll = setInterval(refreshStorage, 15000);

  const originalOnNavigate = onNavigate;
  onNavigate = (target) => {
    clearInterval(pollInterval);
    clearInterval(storagePoll);
    evtSource.close();
    originalOnNavigate(target);
  };
}
