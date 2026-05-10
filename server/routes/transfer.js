import { Router } from 'express';
import { existsSync } from 'fs';
import { unlink, rm } from 'fs/promises';
import { basename } from 'path';
import { requireAuth } from './auth.js';
import { downloadFile } from '../services/downloader.js';
import { uploadToGDrive, uploadFolderToGDrive, getTodayFolderName } from '../services/gdrive.js';
import { loadSettings } from '../services/settings.js';
import { saveTransfer, deleteTransfer, updateTransferStatus, getTransfers } from '../services/store.js';

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
 * GET /api/transfer/list
 * Returns all active and paused transfers.
 */
router.get('/list', (req, res) => {
  res.json(getTransfers());
});

/**
 * POST /api/transfer
 */
router.post('/', async (req, res) => {
  const { url, format = 'video', quality = 'best', isLive = false, torrentMode, startBatchIndex = 0 } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'A valid URL is required.' });
  }

  const sessionId = req.session.id;
  const transferId = `tr_${Date.now()}`;

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

  saveTransfer(transferId, { url, type: 'download', status: 'initializing' });

  let localPath = null;
  let downloadDir = null;
  let parentDir = null;

  try {
    // --- Download phase ---
    sendSSE('status', { phase: 'download', message: 'Starting download…' });
    updateTransferStatus(transferId, 'downloading');

    // Resolve and filter cookies path from settings
    const settings = loadSettings();
    let cookiesPath = settings.cookiesPath && existsSync(settings.cookiesPath)
      ? settings.cookiesPath
      : null;
    
    if (cookiesPath) {
      const { filterCookies } = await import('../services/downloader.js');
      cookiesPath = filterCookies(cookiesPath);
    }

    const defaultTorrentMode = settings.torrentMode || 'zip';
    const effectiveTorrentMode = torrentMode || defaultTorrentMode;
    const skipZip = effectiveTorrentMode === 'folder';

    // onBatchComplete callback for large torrents
    const onBatchComplete = async (batch) => {
      sendSSE('status', { phase: 'upload', message: `Uploading batch ${batch.batchIndex + 1}/${batch.totalBatches}…` });
      updateTransferStatus(transferId, 'uploading', { 
        batch: batch.batchIndex + 1, 
        totalBatches: batch.totalBatches,
        name: batch.name
      });

      await uploadFolderToGDrive(batch.dir, batch.name, ({ uploaded, total, speed, percent, currentFile }) => {
        sendSSE('progress', {
          phase: 'upload',
          uploaded,
          total,
          speed,
          percent: Math.round(percent),
          label: `Uploading batch ${batch.batchIndex + 1} · ${currentFile}`,
        });
      }, signal, batch.files);
    };

    const downloadResult = await downloadFile(url, format, quality, cookiesPath, (line) => {
      sendSSE('progress', { phase: 'download', line });
    }, signal, isLive, skipZip, onBatchComplete, startBatchIndex);

    if (downloadResult.completed) {
      // Large torrent batching finished
      deleteTransfer(transferId);
      const result = { success: true, fileName: downloadResult.torrentName, message: 'Torrent batch transfer complete.' };
      sendSSE('done', result);
      return res.json(result);
    } else if (downloadResult.batchPaused) {
      // One batch finished, waiting for user to resume next
      updateTransferStatus(transferId, 'paused_user', { error: 'Waiting for user to resume next batch' });
      // We send an 'error' event with a specific message to stop the client UI spinner,
      // but because the status is 'paused_user', it will show up as resumable in the Active Transfers list.
      sendSSE('error', { message: 'Batch complete. Please clear space and click Resume for the next batch.' });
      return res.json({ success: true, message: 'Batch paused for user.' });
    }

    if (typeof downloadResult === 'string') {
      localPath = downloadResult;
    } else if (downloadResult.zipPath) {
      localPath = downloadResult.zipPath;
      downloadDir = downloadResult.downloadDir;
    } else if (downloadResult.downloadDir) {
      downloadDir = downloadResult.downloadDir;
      parentDir = downloadResult.parentDir;
    }

    // --- Upload phase (for non-batched files) ---
    sendSSE('status', { phase: 'upload', message: 'Uploading to Google Drive…' });
    updateTransferStatus(transferId, 'uploading');

    let fileInfo;
    if (localPath) {
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
      const folderName = downloadResult.torrentName || basename(downloadDir);
      fileInfo = await uploadFolderToGDrive(downloadDir, folderName, ({ uploaded, total, speed, percent, currentFile }) => {
        sendSSE('progress', {
          phase: 'upload',
          uploaded,
          total,
          speed,
          percent: Math.round(percent),
          label: `Uploading ${fmtBytes(uploaded)} / ${fmtBytes(total)} · ${currentFile}`,
        });
      }, signal);
    }

    // --- Cleanup ---
    if (localPath) await unlink(localPath);
    if (parentDir) await rm(parentDir, { recursive: true, force: true });
    else if (downloadDir) await rm(downloadDir, { recursive: true, force: true });
    
    deleteTransfer(transferId);

    const result = {
      success: true,
      fileName: fileInfo.name,
      driveId: fileInfo.id,
      folder: `yt2gd/${getTodayFolderName()}`,
      webViewLink: fileInfo.webViewLink || null,
    };

    delete req.app.locals.activeTransfers[sessionId];
    sendSSE('done', result);
    return res.json(result);

  } catch (err) {
    console.error('Transfer failed/cancelled:', err.message);
    
    if (err.message === 'GOOGLE_DRIVE_QUOTA_EXCEEDED') {
      updateTransferStatus(transferId, 'paused_quota', { error: 'Google Drive Quota Exceeded' });
    } else {
      deleteTransfer(transferId);
    }

    delete req.app.locals.activeTransfers[sessionId];

    if (localPath) {
      try { await unlink(localPath); } catch (_) {}
    }
    if (parentDir) {
      try { await rm(parentDir, { recursive: true, force: true }); } catch (_) {}
    } else if (downloadDir) {
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
