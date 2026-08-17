/**
 * Bastyon Uploader routes — accounts (encrypted WIF vault), drafts,
 * download-with-metadata, publish (PeerTube + blockchain), and storage.
 */

import { Router } from 'express';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import axios from 'axios';
import { requireAuth } from './auth.js';
import { loadSettings } from '../services/settings.js';
import { getDiskUsage } from '../services/system_utils.js';
import { downloadWithMetadata, filterCookies } from '../services/downloader.js';
import { Account } from '../services/bastyon/crypto.js';
import { buildPayload } from '../services/bastyon/payload.js';
import { buildAndSignPostTransaction } from '../services/bastyon/transaction.js';
import { BastyonRpcClient } from '../services/bastyon/rpc.js';
import { uploadVideo, uploadImage, MediaUploadError } from '../services/bastyon/media.js';
import { trimVideo, isFfmpegAvailable } from '../services/bastyon/trim.js';
import { transcodeVideo, probeVideo, needsTranscode, isFfprobeAvailable } from '../services/bastyon/transcode.js';
import * as vault from '../services/bastyon/vault.js';
import * as accounts from '../services/bastyon/accounts.js';
import * as drafts from '../services/bastyon/drafts.js';
import { unlink } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();
router.use(requireAuth);

// Per-session abort controllers + SSE clients for the Bastyon flow
router.use((req, res, next) => {
  if (!req.app.locals.bastyonActive) req.app.locals.bastyonActive = {};
  if (!req.app.locals.bastyonSseClients) req.app.locals.bastyonSseClients = {};
  next();
});

function sendBastyonSSE(req, event, data) {
  const client = req.app.locals.bastyonSseClients?.[req.session.id];
  if (client) {
    client.write(`event: ${event}\n`);
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

// ---------------------------------------------------------------------------
// Vault (passphrase) endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/bastyon/vault/status
 */
router.get('/vault/status', (req, res) => {
  res.json({ hasAccounts: accounts.listAccounts().length > 0, unlocked: vault.isUnlocked() });
});

/**
 * POST /api/bastyon/vault/unlock  { passphrase }
 */
router.post('/vault/unlock', (req, res) => {
  const { passphrase } = req.body || {};
  if (!passphrase) return res.status(400).json({ error: 'Passphrase is required.' });

  const store = accounts.loadStore();
  if (!store.salt) return res.status(400).json({ error: 'No passphrase set yet. Set one first.' });

  vault.unlock(passphrase, store.salt);

  // Verify by decrypting the first account (GCM auth-tag check)
  if (store.accounts.length > 0) {
    try {
      vault.decryptWif(store.accounts[0].encryptedWif);
    } catch (e) {
      vault.lock();
      return res.status(401).json({ error: 'Wrong passphrase.' });
    }
  }
  res.json({ success: true, unlocked: true });
});

/**
 * POST /api/bastyon/vault/lock
 */
router.post('/vault/lock', (req, res) => {
  vault.lock();
  res.json({ success: true, unlocked: false });
});

/**
 * POST /api/bastyon/vault/passphrase  { passphrase }
 * Set on first use, or rotate (re-encrypt all accounts) while unlocked.
 */
router.post('/vault/passphrase', (req, res) => {
  const { passphrase } = req.body || {};
  if (!passphrase || String(passphrase).length < 4) {
    return res.status(400).json({ error: 'Passphrase must be at least 4 characters.' });
  }

  const store = accounts.loadStore();
  if (store.accounts.length > 0 && !vault.isUnlocked()) {
    return res.status(400).json({ error: 'Unlock the vault first to change the passphrase.' });
  }

  try {
    // Decrypt all keys with the CURRENT in-memory key BEFORE rotating
    const oldWifs = store.accounts.map((a) => vault.decryptWif(a.encryptedWif));
    const newSalt = vault.rotate(passphrase);
    store.accounts.forEach((a, i) => {
      a.encryptedWif = vault.encryptWif(oldWifs[i]);
    });
    store.salt = newSalt;
    accounts.saveStoreExposed(store);
    res.json({ success: true, unlocked: true });
  } catch (e) {
    vault.lock();
    res.status(400).json({ error: `Could not set passphrase: ${e.message}` });
  }
});

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/**
 * GET /api/bastyon/accounts — names only, never the WIF.
 */
router.get('/accounts', (req, res) => {
  res.json({ accounts: accounts.listAccounts() });
});

/**
 * POST /api/bastyon/accounts  { name, wif }  (vault must be unlocked)
 */
router.post('/accounts', (req, res) => {
  const { name, wif } = req.body || {};
  try {
    const created = accounts.createAccount({ name, wif });
    res.json({ success: true, account: created });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * DELETE /api/bastyon/accounts/:id
 */
router.delete('/accounts/:id', (req, res) => {
  const removed = accounts.deleteAccount(req.params.id);
  res.json({ success: removed, message: removed ? 'Account removed.' : 'Account not found.' });
});

// ---------------------------------------------------------------------------
// Downloads (SSE progress) & drafts
// ---------------------------------------------------------------------------

/**
 * POST /api/bastyon/cancel — aborts the active bastyon download/publish for this session.
 */
router.post('/cancel', (req, res) => {
  const controller = req.app.locals.bastyonActive?.[req.session.id];
  if (controller) {
    controller.abort();
    delete req.app.locals.bastyonActive[req.session.id];
    return res.json({ success: true, message: 'Bastyon operation cancelled.' });
  }
  return res.json({ success: true, message: 'No active Bastyon operation to cancel.' });
});

/**
 * POST /api/bastyon/download
 * Body: { url, accountId?, format?, quality?, audioLanguage? }
 * Downloads a single video with yt-dlp (any supported site), extracts metadata,
 * creates a persisted draft, and resolves with the draft.
 */
router.post('/download', async (req, res) => {
  const { url, accountId = null, format = 'video', quality = 'best', audioLanguage = 'original' } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'A valid URL is required.' });
  }

  const sessionId = req.session.id;
  const abortController = new AbortController();
  req.app.locals.bastyonActive[sessionId] = abortController;
  const signal = abortController.signal;

  // Create the draft up-front so it appears in the UI while downloading
  let draft = drafts.createDraft({
    sourceUrl: url,
    accountId,
    accountName: accountId ? (accounts.getAccountById(accountId)?.name || '') : '',
    status: 'downloading',
  });

  const stagingDir = drafts.draftStagingDir(draft.id);

  try {
    sendBastyonSSE(req, 'status', { draftId: draft.id, phase: 'download', message: 'Starting download…' });

    // Reuse the SAME cookie file uploaded in Settings (filtered like the Dashboard does)
    const settings = loadSettings();
    let cookiesPath = settings.cookiesPath && existsSync(settings.cookiesPath) ? settings.cookiesPath : null;
    if (cookiesPath) cookiesPath = filterCookies(cookiesPath);

    const result = await downloadWithMetadata(url, {
      format,
      quality,
      audioLanguage,
      cookiesPath,
      onProgress: (line) => {
        sendBastyonSSE(req, 'progress', { draftId: draft.id, phase: 'download', line });
      },
      abortSignal: signal,
      outputDir: stagingDir,
    });

    const fileSize = existsSync(result.filePath) ? statSync(result.filePath).size : 0;
    draft = drafts.updateDraft(draft.id, {
      status: 'draft',
      filePath: result.filePath,
      fileSize,
      title: result.title,
      description: result.description,
      tags: result.tags,
      thumbnailUrl: result.thumbnail,
      sourceUrl: result.originalUrl,
      accountId,
      accountName: accountId ? (accounts.getAccountById(accountId)?.name || '') : '',
      error: '',
    });

    sendBastyonSSE(req, 'done', { draftId: draft.id, draft });
    delete req.app.locals.bastyonActive[sessionId];
    return res.json({ success: true, draft });
  } catch (err) {
    console.error('[Bastyon] Download failed:', err.message);
    draft = drafts.updateDraft(draft.id, { status: 'failed', error: err.message });
    delete req.app.locals.bastyonActive[sessionId];
    sendBastyonSSE(req, 'error', { draftId: draft.id, message: err.message });
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/bastyon/drafts
 */
router.get('/drafts', (req, res) => {
  res.json({ drafts: drafts.listDrafts() });
});

/**
 * GET /api/bastyon/drafts/:id
 */
router.get('/drafts/:id', (req, res) => {
  const draft = drafts.getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: 'Draft not found.' });
  res.json({ draft });
});

/**
 * PUT /api/bastyon/drafts/:id — edit title/description/tags/account/trim
 */
router.put('/drafts/:id', (req, res) => {
  const draft = drafts.getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: 'Draft not found.' });
  if (draft.status === 'published' || draft.status === 'publishing') {
    return res.status(400).json({ error: `Cannot edit a ${draft.status} draft.` });
  }

  const { title, description, tags, accountId, trimStart, trimEnd, transcode } = req.body || {};
  const patch = {};

  if (title !== undefined) patch.title = String(title);
  if (description !== undefined) patch.description = String(description);
  if (tags !== undefined) patch.tags = Array.isArray(tags) ? tags.map(String) : String(tags).split(',').map((t) => t.trim()).filter(Boolean);
  if (trimStart !== undefined) patch.trimStart = String(trimStart || '');
  if (trimEnd !== undefined) patch.trimEnd = String(trimEnd || '');
  if (transcode !== undefined) patch.transcode = Boolean(transcode);
  if (accountId !== undefined) {
    const acc = accounts.getAccountById(accountId);
    if (accountId && !acc) return res.status(400).json({ error: 'Selected account not found.' });
    patch.accountId = accountId;
    patch.accountName = acc ? acc.name : '';
  }

  const updated = drafts.updateDraft(draft.id, patch);
  res.json({ success: true, draft: updated });
});

/**
 * DELETE /api/bastyon/drafts/:id — removes the record + its file.
 */
router.delete('/drafts/:id', (req, res) => {
  const removed = drafts.deleteDraft(req.params.id);
  res.json({ success: removed, message: removed ? 'Draft deleted.' : 'Draft not found.' });
});

// ---------------------------------------------------------------------------
// Publish (SSE progress)
// ---------------------------------------------------------------------------

/**
 * POST /api/bastyon/drafts/:id/publish
 * Fetch thumbnail → trim (if set) → transcode (if enabled & needed) →
 * upload video (with thumbnail + title) → post image → sign & broadcast.
 */
router.post('/drafts/:id/publish', async (req, res) => {
  const draft = drafts.getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: 'Draft not found.' });
  if (draft.status === 'publishing') return res.status(400).json({ error: 'This draft is already publishing.' });
  if (!draft.filePath || !existsSync(draft.filePath)) {
    return res.status(400).json({ error: 'Draft file is missing. Delete this draft and download again.' });
  }
  if (!draft.accountId) {
    return res.status(400).json({ error: 'Select a Bastyon account for this draft first.' });
  }

  const sessionId = req.session.id;
  const abortController = new AbortController();
  req.app.locals.bastyonActive[sessionId] = abortController;
  const signal = abortController.signal;

  drafts.updateDraft(draft.id, { status: 'publishing', error: '' });
  const stagingDir = drafts.draftStagingDir(draft.id);

  const cleanupTemp = async (paths) => {
    for (const p of paths) {
      if (!p) continue;
      try {
        if (existsSync(p)) await unlink(p);
      } catch (e) { /* ignore */ }
    }
  };

  let trimmedPath = null;
  let transcodedPath = null;
  let thumbPath = null;

  try {
    // 1. Resolve account + decrypt WIF (requires unlocked vault)
    const accountRecord = accounts.getAccountById(draft.accountId);
    if (!accountRecord) throw new Error('Account no longer exists. Re-assign this draft to another account.');
    let wif;
    try {
      wif = accounts.decryptAccountWif(accountRecord);
    } catch (e) {
      if (e instanceof vault.VaultLockedError) {
        drafts.updateDraft(draft.id, { status: 'draft' });
        return res.status(400).json({ error: e.message });
      }
      throw e;
    }
    const account = Account.fromWif(wif);

    // 2. Fetch thumbnail (best-effort, non-fatal) BEFORE upload so it can be
    //    attached to the video in the same request.
    const images = [];
    if (draft.thumbnailUrl) {
      try {
        sendBastyonSSE(req, 'status', { draftId: draft.id, phase: 'thumbnail', message: 'Fetching thumbnail…' });
        thumbPath = join(stagingDir, `thumb_${Date.now()}.jpg`);
        const thumbResp = await axios.get(draft.thumbnailUrl, { responseType: 'arraybuffer', timeout: 20_000 });
        writeFileSync(thumbPath, Buffer.from(thumbResp.data));
      } catch (e) {
        thumbPath = null;
        console.warn('[Bastyon] Thumbnail fetch failed (continuing without it):', e.message);
      }
    }

    // 3. Trim (optional)
    let uploadPath = draft.filePath;
    if (draft.trimStart || draft.trimEnd) {
      if (!isFfmpegAvailable()) {
        throw new Error('ffmpeg is not installed on this server, so trimming is unavailable. Clear the trim fields to publish as-is.');
      }
      sendBastyonSSE(req, 'status', { draftId: draft.id, phase: 'trim', message: 'Trimming video…' });
      trimmedPath = await trimVideo(draft.filePath, { start: draft.trimStart || undefined, end: draft.trimEnd || undefined });
      uploadPath = trimmedPath;
    }

    // 4. Transcode / normalize (optional, enabled by default)
    if (draft.transcode !== false) {
      if (!isFfmpegAvailable() || !isFfprobeAvailable()) {
        throw new Error('ffmpeg/ffprobe is not installed on this server, so normalization is unavailable. Disable "Normalize before upload" to publish as-is.');
      }
      sendBastyonSSE(req, 'status', { draftId: draft.id, phase: 'transcode', message: 'Checking video…' });
      const probe = await probeVideo(uploadPath);
      if (needsTranscode(probe)) {
        sendBastyonSSE(req, 'status', { draftId: draft.id, phase: 'transcode', message: 'Normalizing video…' });
        transcodedPath = await transcodeVideo(uploadPath, {
          outputPath: join(stagingDir, `transcode_${Date.now()}.mp4`),
          abortSignal: signal,
          onProgress: (p) => {
            if (p && p.percent != null) sendBastyonSSE(req, 'progress', { draftId: draft.id, phase: 'transcode', percent: Math.round(p.percent) });
          },
        });
        uploadPath = transcodedPath;
      }
    }

    // 5. Upload video to PeerTube (attach thumbnail + title)
    sendBastyonSSE(req, 'status', { draftId: draft.id, phase: 'upload', message: 'Authenticating with PeerTube…' });
    const peertubeUrl = await uploadVideo(uploadPath, account, null, (p) => {
      if (p && p.label) sendBastyonSSE(req, 'progress', { draftId: draft.id, phase: 'upload', label: p.label });
    }, { thumbnailPath: thumbPath, title: draft.title });
    if (!peertubeUrl || !peertubeUrl.startsWith('peertube://')) {
      throw new MediaUploadError(`Video upload returned invalid URL: ${peertubeUrl}`);
    }

    // 6. Thumbnail as post image (reuse the already-downloaded file)
    if (thumbPath) {
      try {
        const imageUrl = await uploadImage(thumbPath);
        if (imageUrl) images.push(imageUrl);
      } catch (e) {
        console.warn('[Bastyon] Thumbnail upload as post image failed (continuing without it):', e.message);
      }
    }

    // 7. UTXOs
    sendBastyonSSE(req, 'status', { draftId: draft.id, phase: 'broadcast', message: 'Fetching account funds…' });
    const rpc = new BastyonRpcClient();
    const utxos = await rpc.getUtxos(account.address);
    if (!utxos.length) {
      throw new Error(`No confirmed UTXOs found for address ${account.address}. Ensure the account has a small PKOIN balance.`);
    }

    // 8. Payload + transaction
    const payload = buildPayload({
      message: draft.description || draft.title || '',
      caption: draft.title || '',
      tags: draft.tags || [],
      images,
      url: peertubeUrl,
      language: 'en',
    });
    const signedTx = buildAndSignPostTransaction({ account, utxos, payload, txType: 'video' });

    // 9. Broadcast
    sendBastyonSSE(req, 'status', { draftId: draft.id, phase: 'broadcast', message: 'Broadcasting to the blockchain…' });
    const txid = await rpc.broadcast(signedTx);

    // 10. Success — clean up local files, mark published
    await cleanupTemp([trimmedPath, transcodedPath, thumbPath, draft.filePath]);
    drafts.updateDraft(draft.id, { status: 'published', txid, error: '', fileSize: 0 });

    sendBastyonSSE(req, 'done', { draftId: draft.id, success: true, txid });
    delete req.app.locals.bastyonActive[sessionId];
    return res.json({ success: true, txid });
  } catch (err) {
    console.error('[Bastyon] Publish failed:', err.message);
    // Keep the original downloaded file for retry; discard intermediate artifacts.
    await cleanupTemp([trimmedPath, transcodedPath, thumbPath]);
    const status = err instanceof vault.VaultLockedError ? 'draft' : 'failed';
    drafts.updateDraft(draft.id, { status, error: err.message });
    delete req.app.locals.bastyonActive[sessionId];
    sendBastyonSSE(req, 'error', { draftId: draft.id, message: err.message });
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message });
    }
    return res.end();
  }
});

// ---------------------------------------------------------------------------
// Storage & staging cleanup
// ---------------------------------------------------------------------------

/**
 * GET /api/bastyon/storage — disk + staging info for the storage indicator.
 */
router.get('/storage', (req, res) => {
  const disk = getDiskUsage();
  res.json({
    disk: { total: disk.total, free: disk.free, used: disk.total - disk.free },
    staging: drafts.stagingInfo(),
  });
});

/**
 * POST /api/bastyon/staging/clear — wipe staging + remove non-published drafts.
 */
router.post('/staging/clear', (req, res) => {
  const removed = drafts.clearStaging();
  res.json({ success: true, removedDrafts: removed, message: `Cleared staging. Removed ${removed} unfinished draft(s).` });
});

// ---------------------------------------------------------------------------
// SSE progress stream (separate from /api/transfer/progress)
// ---------------------------------------------------------------------------

/**
 * GET /api/bastyon/progress
 */
router.get('/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sessionId = req.session.id;
  req.app.locals.bastyonSseClients[sessionId] = res;

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    delete req.app.locals.bastyonSseClients[sessionId];
  });
});

export default router;
