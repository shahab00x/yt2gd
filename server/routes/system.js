import { Router } from 'express';
import { existsSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { requireAuth } from './auth.js';
import { TMP_DIR, clearTmp } from '../services/downloader.js';
import { getDiskUsage, getDirSize } from '../services/system_utils.js';

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

export default router;
