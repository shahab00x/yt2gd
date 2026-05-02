import { DownloaderHelper } from 'node-downloader-helper';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import youtubedl from 'youtube-dl-exec';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const TMP_DIR = join(__dirname, '../../tmp');

function ensureTmpDir() {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
}

/**
 * Detect if a URL is a standard YouTube watch page.
 */
export function isYouTubeUrl(url) {
  try {
    const { hostname } = new URL(url);
    return hostname.includes('youtube.com') || hostname.includes('youtu.be');
  } catch {
    return false;
  }
}

/**
 * Download a direct media file (e.g. googlevideo.com) using node-downloader-helper.
 * Emits progress via the onProgress callback.
 *
 * @param {string} url - Direct file URL
 * @param {function} onProgress - Called with { downloaded, total, speed, percent }
 * @returns {Promise<string>} - Absolute path to the downloaded file
 */
export function downloadFile(url, onProgress = null) {
  ensureTmpDir();

  return new Promise((resolve, reject) => {
    const dl = new DownloaderHelper(url, TMP_DIR, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
      },
      retry: { maxRetries: 3, delay: 1000 },
      resumeIfFileExists: false,
      override: true,
    });

    dl.on('progress', (stats) => {
      if (onProgress) {
        onProgress({
          downloaded: stats.downloadedSize,
          total: stats.totalSize,
          speed: stats.speed,
          percent: stats.progress,
        });
      }
    });

    dl.on('end', (info) => {
      console.log(`✅ Downloaded: ${info.fileName}`);
      resolve(info.filePath);
    });

    dl.on('error', (err) => {
      reject(new Error(`Download failed: ${err.message}`));
    });

    dl.start().catch(reject);
  });
}

/**
 * Download a YouTube URL using yt-dlp.
 * Emits raw yt-dlp stdout lines as progress via onProgress callback.
 *
 * @param {string} url - YouTube URL
 * @param {string} format - 'video' or 'audio'
 * @param {string} quality - 'best', 'worst', '1080', '720', '480', '360'
 * @param {string|null} cookiesPath - Path to a cookies.txt file (optional)
 * @param {function} onProgress - Called with a raw log line string
 * @returns {Promise<string>} - Absolute path to the downloaded file
 */
export async function downloadYtDlp(url, format = 'video', quality = 'best', cookiesPath = null, onProgress = null) {
  ensureTmpDir();

  const baseName = `ytdlp_${Date.now()}`;
  const outputTemplate = join(TMP_DIR, `${baseName}.%(ext)s`);

  let formatStr;
  if (format === 'audio') {
    formatStr = 'bestaudio/best';
  } else if (quality === 'best' || quality === 'worst') {
    formatStr = quality === 'best' ? 'bestvideo+bestaudio/best' : 'worstvideo+worstaudio/worst';
  } else {
    // e.g., '1080', '720'
    formatStr = `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]`;
  }

  // Find the yt-dlp binary path (may be placed by our postinstall script)
  const binDir = join(__dirname, '../../bin');
  const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const localBin = join(binDir, binName);

  const options = {
    output: outputTemplate,
    format: formatStr,
    noWarnings: true,
    newline: true,
    progress: true,
  };

  if (existsSync(localBin)) {
    options.executablePath = localBin;
  }

  if (cookiesPath && existsSync(cookiesPath)) {
    options.cookies = cookiesPath;
  }

  console.log(`🚀 yt-dlp starting: ${url} [format=${format}, quality=${quality}]`);

  // youtube-dl-exec streams stdout lines via the returned process
  const subprocess = youtubedl.exec(url, options);

  subprocess.stdout?.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line && onProgress) onProgress(line);
    console.log('[yt-dlp]', line);
  });

  subprocess.stderr?.on('data', (chunk) => {
    console.error('[yt-dlp stderr]', chunk.toString().trim());
  });

  await subprocess;

  // Find the file created during this run
  const files = readdirSync(TMP_DIR).filter(f => f.startsWith(baseName));
  if (!files.length) throw new Error('yt-dlp finished but no output file was found.');

  const finalPath = join(TMP_DIR, files[0]);
  console.log(`✅ yt-dlp downloaded: ${files[0]}`);
  return finalPath;
}
