import { existsSync, mkdirSync, readdirSync, createWriteStream, openSync, writeSync, closeSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { create } from 'youtube-dl-exec';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const TMP_DIR = join(__dirname, '../../tmp');

function ensureTmpDir() {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
}

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:146.0) Gecko/20100101 Firefox/146.0';

/**
 * Sanitize URL to handle potential markdown links or extra whitespace.
 */
function cleanUrl(rawUrl) {
  if (!rawUrl) return '';
  const trimmed = rawUrl.trim();
  // Strip markdown: [text](url) → url
  const match = trimmed.match(/^\[.*?\]\((https?:\/\/[^\)]+)\)$/);
  const url = match ? match[1] : trimmed;
  // Further strip any accidental markdown-like trailing chars
  return url.replace(/[\[\]\(\)]/g, '');
}

/**
 * High-speed Parallel Downloader for direct media URLs.
 */
class ParallelDownloader {
  constructor(url, outputPath, options = {}) {
    this.url = cleanUrl(url);
    this.outputPath = outputPath;
    this.concurrency = options.concurrency || 5;
    this.chunkSize = options.chunkSize || 5 * 1024 * 1024; // 5MB
    this.onProgress = options.onProgress || (() => { });
    this.abortSignal = options.abortSignal;
    this.aborted = false;
    this.downloadedBytes = 0;
    this.totalBytes = 0;
    this.startTime = Date.now();
    this.userAgent = options.userAgent || DEFAULT_UA;
    this.fd = null;
  }

  async download() {
    ensureTmpDir();

    // Get file size
    const head = await axios.head(this.url, {
      timeout: 15000,
      headers: { 'User-Agent': this.userAgent }
    });
    this.totalBytes = parseInt(head.headers['content-length'], 10);

    if (isNaN(this.totalBytes)) {
      throw new Error('Could not determine file size for parallel download.');
    }

    const numChunks = Math.ceil(this.totalBytes / this.chunkSize);
    const chunks = Array.from({ length: numChunks }, (_, i) => ({
      start: i * this.chunkSize,
      end: Math.min((i + 1) * this.chunkSize - 1, this.totalBytes - 1),
      index: i,
    }));

    console.log(`🚀 Starting parallel download: ${numChunks} chunks, ${this.concurrency} concurrent. Total size: ${(this.totalBytes / 1024 / 1024).toFixed(2)} MB`);

    this.fd = openSync(this.outputPath, 'w');
    let active = 0;
    let nextIndex = 0;
    let completedChunks = 0;

    return new Promise((resolve, reject) => {
      const downloadNext = async () => {
        if (this.aborted) return;
        if (nextIndex >= numChunks) {
          if (active === 0) {
            if (this.fd !== null) { closeSync(this.fd); this.fd = null; }
            resolve(this.outputPath);
          }
          return;
        }

        const chunk = chunks[nextIndex++];
        active++;

        try {
          const response = await axios.get(this.url, {
            headers: {
              'Range': `bytes=${chunk.start}-${chunk.end}`,
              'User-Agent': this.userAgent
            },
            responseType: 'arraybuffer',
            signal: this.abortSignal,
            timeout: 60000, // 60s timeout per chunk
          });

          // Write chunk to its specific position in the file
          if (this.fd !== null) {
            writeSync(this.fd, Buffer.from(response.data), 0, response.data.byteLength, chunk.start);
          }

          this.downloadedBytes += response.data.byteLength;
          completedChunks++;

          const elapsed = (Date.now() - this.startTime) / 1000;
          const speed = this.downloadedBytes / elapsed;
          const percent = (this.downloadedBytes / this.totalBytes) * 100;

          this.onProgress({
            downloaded: this.downloadedBytes,
            total: this.totalBytes,
            speed,
            percent,
            label: `Downloading: ${Math.round(percent)}% (${(speed / 1024 / 1024).toFixed(2)} MB/s)`
          });

          active--;
          downloadNext();
        } catch (err) {
          active--;
          if (!this.aborted) {
            this.aborted = true;
            if (this.fd !== null) {
              try { closeSync(this.fd); } catch (e) { }
              this.fd = null;
            }
            console.error(`❌ Chunk ${chunk.index} failed:`, err.message);
            reject(new Error(`Chunk download failed: ${err.message}`));
          }
        }
      };

      // Start initial batch
      for (let i = 0; i < Math.min(this.concurrency, numChunks); i++) {
        downloadNext();
      }
    });
  }
}

/**
 * Detect if a URL is a YouTube page or a direct media link.
 */
function isYouTubePage(url) {
  try {
    const { hostname, pathname } = new URL(url);
    const isYT = hostname.includes('youtube.com') || hostname.includes('youtu.be');
    // If it contains /videoplayback or rrX---sn, it's a direct stream URL, not the page.
    const isStream = hostname.includes('googlevideo.com') || pathname.includes('videoplayback');
    return isYT && !isStream;
  } catch { return false; }
}

/**
 * Download a URL using the best method available.
 */
export async function downloadFile(url, format = 'video', quality = 'best', cookiesPath = null, onProgress = null, abortSignal = null) {
  ensureTmpDir();

  const clean = cleanUrl(url);
  const isYT = isYouTubePage(url);
  const baseName = `dl_${Date.now()}`;
  const localPath = join(TMP_DIR, `${baseName}.tmp`);

  if (!isYT) {
    // High-speed parallel path for direct URLs
    const downloader = new ParallelDownloader(clean, localPath, {
      onProgress: (p) => onProgress && onProgress(p.label),
      abortSignal
    });
    return await downloader.download();
  }

  // yt-dlp path for YouTube pages
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
    // noWarnings: true,
    newline: true,
    progress: true,
    noPlaylist: true, // Avoid "NoneType" errors on videos in playlists
    concurrentFragments: 10, // Speed up fragment-based downloads
    userAgent: DEFAULT_UA,
    noJsRuntimes: true,     // → --no-js-runtimes (disables deno first)
    jsRuntimes: 'node',
    socketTimeout: 30,
    noCheckCertificates: true,
    geoBypass: true,
  };

  if (cookiesPath && existsSync(cookiesPath)) {
    options.cookies = cookiesPath;
  }

  const binDir = join(__dirname, '../../bin');
  const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const localBin = join(binDir, binName);
  const youtubedl = existsSync(localBin) ? create(localBin) : create('yt-dlp');

  console.log(`🚀 yt-dlp starting: ${clean}`);

  const subprocess = youtubedl.exec(clean, options);

  const onAbort = () => {
    console.log(`🛑 Cancellation triggered for ${url}`);
    if (subprocess && typeof subprocess.kill === 'function') {
      subprocess.kill('SIGKILL');
    }
  };

  if (abortSignal) {
    if (abortSignal.aborted) onAbort();
    else abortSignal.addEventListener('abort', onAbort);
  }

  subprocess.stdout?.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line && onProgress) onProgress(line);
  });

  subprocess.stderr?.on('data', (chunk) => {
    console.error(`[yt-dlp] ${chunk.toString().trim()}`);
  });

  try {
    await subprocess;
  } catch (err) {
    if (abortSignal?.aborted) throw new Error('Download was cancelled by user.');
    throw err;
  } finally {
    if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
  }

  const files = readdirSync(TMP_DIR).filter(f => f.startsWith(baseName));
  if (!files.length) throw new Error('Download finished but no output file found.');

  return join(TMP_DIR, files[0]);
}
