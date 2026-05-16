import { Router } from 'express';
import { existsSync, statSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, exec } from 'child_process';
import { requireAuth } from './auth.js';
import { TMP_DIR, clearTmp } from '../services/downloader.js';
import { getDiskUsage, getDirSize } from '../services/system_utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();
router.use(requireAuth);


/**
 * GET /api/system/status
 * Returns disk usage and tmp folder size.
 */
router.get('/status', (req, res) => {
  const disk = getDiskUsage();
  const tmpSize = getDirSize(TMP_DIR);

  // List contents of tmp folder
  let tmpContents = [];
  try {
    if (existsSync(TMP_DIR)) {
      tmpContents = readdirSync(TMP_DIR, { withFileTypes: true }).map(entry => {
        const fullPath = join(TMP_DIR, entry.name);
        const size = entry.isDirectory() ? getDirSize(fullPath) : (statSync(fullPath).size || 0);
        return { name: entry.name, isDir: entry.isDirectory(), size };
      });
    }
  } catch (_) {}

  res.json({
    disk: {
      total: disk.total,
      free: disk.free,
      used: disk.total - disk.free,
    },
    tmp: {
      path: TMP_DIR,
      size: tmpSize,
      contents: tmpContents,
    }
  });
});

/**
 * POST /api/system/clear-tmp
 * Wipes the entire tmp directory.
 */
router.post('/clear-tmp', (req, res) => {
  clearTmp();
  res.json({ success: true, message: 'Temporary folder cleared.' });
});

/**
 * GET /api/system/ytdlp-version
 * Returns the installed yt-dlp version string.
 */
router.get('/ytdlp-version', (req, res) => {
  const binDir = join(__dirname, '../../bin');
  const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const localBin = join(binDir, binName);
  
  const cmd = existsSync(localBin) ? `"${localBin}" --version` : 'yt-dlp --version';
  
  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.warn(`Failed to get yt-dlp version: ${stderr || error.message}`);
      return res.json({ success: false, version: 'Not Installed / Error' });
    }
    res.json({ success: true, version: stdout.trim() });
  });
});

/**
 * POST /api/system/update-ytdlp
 * Triggers the download-yt-dlp.js script with --force to update yt-dlp.
 */
router.post('/update-ytdlp', (req, res) => {
  const scriptPath = join(__dirname, '../../scripts/download-yt-dlp.js');
  
  exec(`node "${scriptPath}" --force`, (error, stdout, stderr) => {
    if (error) {
      console.error(`yt-dlp update error: ${stderr || error.message}`);
      return res.status(500).json({ success: false, error: stderr || error.message });
    }
    res.json({ success: true, message: 'yt-dlp updated successfully.', output: stdout });
  });
});

export default router;
