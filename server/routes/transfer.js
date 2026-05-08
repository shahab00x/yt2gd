import { Router } from 'express';
import { existsSync } from 'fs';
import { unlink, rm } from 'fs/promises';
import { basename } from 'path';
import { requireAuth } from './auth.js';
import { downloadFile } from '../services/downloader.js';
import { uploadToGDrive, uploadFolderToGDrive, getTodayFolderName } from '../services/gdrive.js';
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
 * Body: { url, format?, quality?, torrentMode? }
 *   format  — 'video' | 'audio'
 *   quality — 'best' | '1080' | '720' | '480' | '360' | 'worst'
 *   torrentMode — 'zip' | 'folder' (for magnet links)
 */
router.post('/', async (req, res) => {
  const { url, format = 'video', quality = 'best', isLive = false, torrentMode } = req.body;

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
  let downloadDir = null;
  try {
    // --- Download phase ---
    sendSSE('status', { phase: 'download', message: 'Starting download…' });

    // Resolve and filter cookies path from settings
    const settings = loadSettings();
    let cookiesPath = settings.cookiesPath && existsSync(settings.cookiesPath)
      ? settings.cookiesPath
      : null;
    
    if (cookiesPath) {
      const { filterCookies } = await import('../services/downloader.js');
      cookiesPath = filterCookies(cookiesPath);
    }

    // Determine if we should skip zipping for torrents
    const defaultTorrentMode = settings.torrentMode || 'zip';
    const effectiveTorrentMode = torrentMode || defaultTorrentMode;
    const skipZip = effectiveTorrentMode === 'folder';

    const downloadResult = await downloadFile(url, format, quality, cookiesPath, (line) => {
      sendSSE('progress', { phase: 'download', line });
    }, signal, isLive, skipZip);

    if (typeof downloadResult === 'string') {
      localPath = downloadResult;
    } else if (downloadResult.zipPath) {
      // Zip mode
      localPath = downloadResult.zipPath;
      downloadDir = downloadResult.downloadDir;
    } else if (downloadResult.downloadDir) {
      // Folder mode
      downloadDir = downloadResult.downloadDir;
    }

    // --- Upload phase ---
    sendSSE('status', { phase: 'upload', message: 'Uploading to Google Drive…' });

    let fileInfo;
    if (localPath) {
      // Single file upload (zip or regular file)
      fileInfo = await uploadToGDrive(localPath, ({ uploaded, total, speed, percent }) => {
        sendSSE('progress', {
          phase: 'upload',
          uploaded,
          total,
          speed,
          percent: Math.round(percent),
          label: `Uploading ${fmtBytes(uploaded)} / ${fmtBytes(total)} · ${fmtSpeed(speed)}`,
        });
      }, signal);
    } else if (downloadDir) {
      // Folder upload for torrents
      const folderName = basename(downloadDir);
      fileInfo = await uploadFolderToGDrive(downloadDir, folderName, ({ uploaded, total, speed, percent, currentFile }) => {
        sendSSE('progress', {
          phase: 'upload',
          uploaded,
          total,
          speed,
          percent: Math.round(percent),
          label: `Uploading ${fmtBytes(uploaded)} / ${fmtBytes(total)} · ${fmtSpeed(speed)} · ${currentFile}`,
        });
      }, signal);
    }

    // --- Cleanup ---
    if (localPath) await unlink(localPath);
    if (downloadDir) await rm(downloadDir, { recursive: true, force: true });
    
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
    if (downloadDir) {
      try { await rm(downloadDir, { recursive: true, force: true }); } catch (_) {}
    }

    sendSSE('error', { message: err.message });

    if (!res.headersSent) {
      return res.status(500).json({ error: err.message });
    }
    return res.end();
  }
});

export default router;
