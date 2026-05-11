import { execSync } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { TMP_DIR } from './downloader.js';

/**
 * Get disk usage for the partition where TMP_DIR resides.
 */
export function getDiskUsage() {
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
 * Recursively calculate directory size in bytes.
 */
export function getDirSize(dirPath) {
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
