import { Router } from 'express';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { requireAuth } from './auth.js';
import { downloadYtDlp } from '../services/downloader.js';
import { uploadToGDrive, getTodayFolderName } from '../services/gdrive.js';
import { loadSettings } from '../services/settings.js';

const router = Router();
router.use(requireAuth);

// Initialize a store for active abort controllers globally on the app
router.use((req, res, next) => {
  if (!req.app.locals.activeTransfers) req.app.locals.activeTransfers = {};
  next();
});

/**
 * Helper: format bytes to a human-readable string.
 */
function fmtBytes(b) {
  if (!b || b <= 0) return '?';
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function fmtSpeed(bps) {
  if (!bps || bps <= 0) return '';
  return `${fmtBytes(bps)}/s`;
}

/**
 * GET /api/transfer/progress
 * SSE stream — client connects before starting a transfer.
 * Events are pushed into req.app.locals.sseClients keyed by session id.
 */
router.get('/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sessionId = req.session.id;
  if (!req.app.locals.sseClients) req.app.locals.sseClients = {};
  req.app.locals.sseClients[sessionId] = res;

  // Heartbeat every 15s to keep the connection alive
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    delete req.app.locals.sseClients[sessionId];
  });
});

/**
 * POST /api/transfer/cancel
 * Aborts the current active transfer for the session.
 */
router.post('/cancel', (req, res) => {
  const sessionId = req.session.id;
  const controller = req.app.locals.activeTransfers[sessionId];
  
  if (controller) {
    controller.abort();
    delete req.app.locals.activeTransfers[sessionId];
    return res.json({ success: true, message: 'Transfer cancelled.' });
  }
  return res.json({ success: false, message: 'No active transfer to cancel.' });
});

/**
 * POST /api/transfer
 * Body: { url, format?, quality? }
 *   format  — 'video' | 'audio'
 *   quality — 'best' | '1080' | '720' | '480' | '360' | 'worst'
 */
router.post('/', async (req, res) => {
  const { url, format = 'video', quality = 'best' } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'A valid URL is required.' });
  }

  const sessionId = req.session.id;

  // Initialize cancellation controller
  const abortController = new AbortController();
  req.app.locals.activeTransfers[sessionId] = abortController;
  const signal = abortController.signal;

  /** Push a progress event to the SSE connection for this session */
  function sendSSE(event, data) {
    const client = req.app.locals.sseClients?.[sessionId];
    if (client) {
      client.write(`event: ${event}\n`);
      client.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  }

  let localPath = null;
  try {
    // --- Download phase ---
    sendSSE('status', { phase: 'download', message: 'Starting download…' });

    // Resolve cookies path from settings
    const settings = loadSettings();
    const cookiesPath = settings.cookiesPath && existsSync(settings.cookiesPath)
      ? settings.cookiesPath
      : null;

    localPath = await downloadYtDlp(url, format, quality, cookiesPath, (line) => {
      sendSSE('progress', { phase: 'download', line });
    }, signal);

    // --- Upload phase ---
    sendSSE('status', { phase: 'upload', message: 'Uploading to Google Drive…' });

    const fileInfo = await uploadToGDrive(localPath, ({ uploaded, total, speed, percent }) => {
      sendSSE('progress', {
        phase: 'upload',
        uploaded,
        total,
        speed,
        percent: Math.round(percent),
        label: `Uploading ${fmtBytes(uploaded)} / ${fmtBytes(total)} · ${fmtSpeed(speed)}`,
      });
    }, signal);

    // --- Cleanup ---
    await unlink(localPath);
    localPath = null;

    const result = {
      success: true,
      fileName: fileInfo.name,
      driveId: fileInfo.id,
      folder: `yt2gd/${getTodayFolderName()}`,
      webViewLink: fileInfo.webViewLink || null,
    };

    // Remove from active transfers on success
    delete req.app.locals.activeTransfers[sessionId];

    sendSSE('done', result);
    return res.json(result);

  } catch (err) {
    console.error('Transfer failed/cancelled:', err.message);

    // Remove from active transfers on error/cancel
    delete req.app.locals.activeTransfers[sessionId];

    if (localPath) {
      try { await unlink(localPath); } catch (_) {}
    }

    sendSSE('error', { message: err.message });

    if (!res.headersSent) {
      return res.status(500).json({ error: err.message });
    }
    return res.end();
  }
});

export default router;
