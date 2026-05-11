import { Router } from 'express';
import { existsSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { requireAuth } from './auth.js';
import { TMP_DIR, clearTmp } from '../services/downloader.js';

const router = Router();
router.use(requireAuth);

/**
 * Recursively calculate directory size in bytes.
 */
function getDirSize(dirPath) {
  if (!existsSync(dirPath)) return 0;
  let total = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirSize(fullPath);
      } else if (entry.isFile()) {
        try { total += statSync(fullPath).size; } catch (_) {}
      }
    }
  } catch (_) {}
  return total;
}

/**
 * Get disk usage for the partition where TMP_DIR resides.
 */
function getDiskUsage() {
  try {
    if (process.platform === 'win32') {
      // Windows: use wmic
      const drive = TMP_DIR.charAt(0).toUpperCase();
      const out = execSync(`wmic logicaldisk where "DeviceID='${drive}:'" get Size,FreeSpace /format:csv`, { encoding: 'utf-8' });
      const lines = out.trim().split('\n').filter(l => l.trim());
      const parts = lines[lines.length - 1].split(',');
      return { total: parseInt(parts[1]) || 0, free: parseInt(parts[2]) || 0 };
    } else {
      // Linux/Mac: use df
      const out = execSync(`df -B1 "${TMP_DIR}" | tail -1`, { encoding: 'utf-8' });
      const parts = out.trim().split(/\s+/);
      return { total: parseInt(parts[1]) || 0, free: parseInt(parts[3]) || 0 };
    }
  } catch (err) {
    console.warn('⚠️ Failed to get disk usage:', err.message);
    return { total: 0, free: 0 };
  }
}

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
