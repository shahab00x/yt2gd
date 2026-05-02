import { existsSync, mkdirSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { create } from 'youtube-dl-exec';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const TMP_DIR = join(__dirname, '../../tmp');

function ensureTmpDir() {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
}

/**
 * Download a URL (YouTube or Direct) using yt-dlp.
 * Emits raw yt-dlp stdout lines as progress via onProgress callback.
 * Can be cancelled via abortSignal.
 *
 * @param {string} url - The URL to download
 * @param {string} format - 'video' or 'audio'
 * @param {string} quality - 'best', 'worst', '1080', '720', '480', '360'
 * @param {string|null} cookiesPath - Path to a cookies.txt file (optional)
 * @param {function} onProgress - Called with a raw log line string
 * @param {AbortSignal} abortSignal - Signal to cancel the download
 * @returns {Promise<string>} - Absolute path to the downloaded file
 */
export async function downloadYtDlp(url, format = 'video', quality = 'best', cookiesPath = null, onProgress = null, abortSignal = null) {
  ensureTmpDir();

  const baseName = `ytdlp_${Date.now()}`;
  const outputTemplate = join(TMP_DIR, `${baseName}.%(ext)s`);

  let formatStr;
  if (format === 'audio') {
    formatStr = 'bestaudio/best';
  } else if (quality === 'best' || quality === 'worst') {
    formatStr = quality === 'best' ? 'bestvideo+bestaudio/best' : 'worstvideo+worstaudio/worst';
  } else {
    formatStr = `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]`;
  }

  const options = {
    output: outputTemplate,
    format: formatStr,
    noWarnings: true,
    newline: true,
    progress: true,
  };

  if (cookiesPath && existsSync(cookiesPath)) {
    options.cookies = cookiesPath;
  }

  // Find the yt-dlp binary path (placed by our postinstall script)
  const binDir = join(__dirname, '../../bin');
  const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const localBin = join(binDir, binName);

  // Use the wrapper's .create() to target the local executable cleanly
  const youtubedl = existsSync(localBin) ? create(localBin) : create('yt-dlp');

  console.log(`🚀 yt-dlp starting: ${url} [format=${format}, quality=${quality}]`);

  const subprocess = youtubedl.exec(url, options);

  // Handle Cancellation
  const onAbort = () => {
    console.log(`🛑 yt-dlp download cancelled for ${url}`);
    subprocess.cancel();
  };

  if (abortSignal) {
    if (abortSignal.aborted) onAbort();
    else abortSignal.addEventListener('abort', onAbort);
  }

  subprocess.stdout?.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line && onProgress) onProgress(line);
    // console.log('[yt-dlp]', line); // Optional: keep raw logs in terminal
  });

  subprocess.stderr?.on('data', (chunk) => {
    console.error('[yt-dlp stderr]', chunk.toString().trim());
  });

  try {
    await subprocess;
  } catch (err) {
    if (abortSignal?.aborted) {
      throw new Error('Download was cancelled by user.');
    }
    throw err;
  } finally {
    if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
  }

  // Find the file created during this run
  const files = readdirSync(TMP_DIR).filter(f => f.startsWith(baseName));
  
  if (!files.length) {
    if (abortSignal?.aborted) throw new Error('Download was cancelled by user.');
    throw new Error('yt-dlp finished but no output file was found.');
  }

  const finalPath = join(TMP_DIR, files[0]);
  console.log(`✅ yt-dlp downloaded: ${files[0]}`);
  return finalPath;
}
