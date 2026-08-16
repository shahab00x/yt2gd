import { Router } from 'express';
import { existsSync, statSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, exec } from 'child_process';
import { requireAuth } from './auth.js';
import { TMP_DIR, clearTmp } from '../services/downloader.js';
import { getDiskUsage, getDirSize } from '../services/system_utils.js';
import { uploadFolderToGDrive } from '../services/gdrive.js';

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
 * POST /api/system/upload-files
 * Manually uploads files/folders from tmp to Google Drive.
 * Body: { targetName: string } - name of folder or file in tmp dir
 */
router.post('/upload-files', async (req, res) => {
  const { targetName } = req.body;
  
  if (!targetName || typeof targetName !== 'string') {
    return res.status(400).json({ error: 'Target name is required.' });
  }

  const targetPath = join(TMP_DIR, targetName);

  // Security check: ensure target is within TMP_DIR
  if (!targetPath.startsWith(TMP_DIR)) {
    return res.status(403).json({ error: 'Access denied.' });
  }

  if (!existsSync(targetPath)) {
    return res.status(404).json({ error: `Target not found: ${targetName}` });
  }

  try {
    const stats = statSync(targetPath);
    const abortSignal = new AbortController().signal;

    let result;
    if (stats.isDirectory()) {
      // Upload as folder
      console.log(`📂 Uploading folder: ${targetName}`);
      result = await uploadFolderToGDrive(targetPath, targetName, ({ uploaded, total, speed, percent, currentFile }) => {
        console.log(`[Upload] ${currentFile}: ${Math.round(percent)}%`);
      }, abortSignal);
    } else {
      // Upload as single file
      const { uploadToGDrive } = await import('../services/gdrive.js');
      console.log(`📄 Uploading file: ${targetName}`);
      result = await uploadToGDrive(targetPath, ({ uploaded, total, speed, percent }) => {
        console.log(`[Upload] ${Math.round(percent)}%`);
      }, abortSignal);
    }

    res.json({
      success: true,
      message: `Successfully uploaded "${targetName}" to Google Drive.`,
      fileInfo: result
    });
  } catch (err) {
    console.error(`Failed to upload ${targetName}:`, err.message);
    res.status(500).json({ 
      success: false, 
      error: `Upload failed: ${err.message}` 
    });
  }
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

/**
 * Helper to run a sequence of commands sequentially.
 */
function runCommandChain(commands) {
  return new Promise((resolve, reject) => {
    const runNext = (index) => {
      if (index >= commands.length) return resolve();
      const cmd = commands[index];
      console.log(`[SYSTEM] Executing: ${cmd}`);
      exec(cmd, { cwd: join(__dirname, '../..') }, (error, stdout, stderr) => {
        if (error) {
          console.error(`[SYSTEM] Command failed: ${cmd}\nError: ${stderr || error.message}`);
          return reject(new Error(stderr || error.message));
        }
        runNext(index + 1);
      });
    };
    runNext(0);
  });
}

/**
 * GET /api/system/commits
 * Returns the last 5 commits, noting which one is currently active.
 */
router.get('/commits', (req, res) => {
  exec('git log -5 --pretty=format:"%H|%h|%s|%cr|%d"', { cwd: join(__dirname, '../..') }, (error, stdout, stderr) => {
    if (error) {
      console.error(`Failed to get git log: ${stderr || error.message}`);
      return res.status(500).json({ success: false, error: stderr || error.message });
    }
    const lines = stdout.trim().split('\n').filter(Boolean);
    const commits = lines.map(line => {
      const [hash, shortHash, subject, date, refs] = line.split('|');
      const isActive = !!(refs && refs.includes('HEAD'));
      return { hash, shortHash, subject, date, isActive };
    });
    res.json({ success: true, commits });
  });
});

/**
 * POST /api/system/update-app
 * Pulls the latest commits, installs dependencies, rebuilds client, and restarts via PM2.
 */
router.post('/update-app', async (req, res) => {
  console.log('[SYSTEM] Triggering application self-update...');
  const commands = [
    'git reset --hard',
    'git pull',
    'npm install',
    'npm run build:client'
  ];

  try {
    await runCommandChain(commands);
    console.log('[SYSTEM] Self-update successful! Restarting server in 1.5s...');
    res.json({ success: true, message: 'Application updated successfully. Server is restarting...' });
    
    setTimeout(() => {
      process.exit(0);
    }, 1500);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/system/rollback-app
 * Checks out a specific commit hash, installs dependencies, rebuilds client, and restarts.
 */
router.post('/rollback-app', async (req, res) => {
  const { hash } = req.body;
  if (!hash) {
    return res.status(400).json({ success: false, error: 'Commit hash is required.' });
  }

  console.log(`[SYSTEM] Triggering rollback/checkout to commit ${hash}...`);
  const commands = [
    'git reset --hard',
    `git checkout ${hash}`,
    'npm install',
    'npm run build:client'
  ];

  try {
    await runCommandChain(commands);
    console.log(`[SYSTEM] Rollback to ${hash} successful! Restarting server in 1.5s...`);
    res.json({ success: true, message: `Checked out commit ${hash.substring(0, 7)} successfully. Server is restarting...` });
    
    setTimeout(() => {
      process.exit(0);
    }, 1500);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
