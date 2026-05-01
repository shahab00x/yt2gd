import { Router } from 'express';
import { unlink } from 'fs/promises';
import { requireAuth } from './auth.js';
import { downloadFile } from '../services/downloader.js';
import { uploadToGDrive, getTodayFolderName } from '../services/gdrive.js';

const router = Router();

// All transfer routes require a valid session
router.use(requireAuth);

/**
 * POST /api/transfer
 * Body: { url: string }
 * Downloads the file at `url` then uploads it to Google Drive.
 */
router.post('/', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'A valid URL is required.' });
  }

  let localPath = null;
  try {
    // Step 1 — Download
    res.writeHead(200, {
      'Content-Type': 'application/json',
    });

    localPath = await downloadFile(url);

    // Step 2 — Upload to Google Drive
    const fileInfo = await uploadToGDrive(localPath);

    // Step 3 — Clean up local temp file
    await unlink(localPath);
    localPath = null;

    return res.end(JSON.stringify({
      success: true,
      fileName: fileInfo.name,
      driveId: fileInfo.id,
      folder: `yt2gd/${getTodayFolderName()}`,
      webViewLink: fileInfo.webViewLink || null
    }));

  } catch (err) {
    console.error('Transfer failed:', err.message);

    // Attempt cleanup even on failure
    if (localPath) {
      try { await unlink(localPath); } catch (_) {}
    }

    if (!res.headersSent) {
      return res.status(500).json({ error: err.message });
    }

    return res.end(JSON.stringify({ success: false, error: err.message }));
  }
});

export default router;
