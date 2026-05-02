import { existsSync, mkdirSync, readdirSync, createWriteStream } from 'fs';
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

/**
 * High-speed Parallel Downloader for direct media URLs.
 * achieve "IDM-like" speeds by opening multiple range-based connections.
 */
class ParallelDownloader {
  constructor(url, outputPath, options = {}) {
    this.url = url;
    this.outputPath = outputPath;
    this.concurrency = options.concurrency || 5;
    this.chunkSize = options.chunkSize || 5 * 1024 * 1024; // 5MB
    this.onProgress = options.onProgress || (() => {});
    this.abortSignal = options.abortSignal;
    this.aborted = false;
    this.downloadedBytes = 0;
    this.totalBytes = 0;
    this.startTime = Date.now();
  }

  async download() {
    ensureTmpDir();
    
    // Get file size
    const head = await axios.head(this.url, { timeout: 10000 });
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

    console.log(`🚀 Starting parallel download: ${numChunks} chunks, ${this.concurrency} concurrent.`);

    const writeStream = createWriteStream(this.outputPath);
    
    // Simple pool implementation
    let active = 0;
    let nextIndex = 0;
    const results = [];

    return new Promise((resolve, reject) => {
      const downloadNext = async () => {
        if (this.aborted) return;
        if (nextIndex >= numChunks) {
          if (active === 0) resolve(this.outputPath);
          return;
        }

        const chunk = chunks[nextIndex++];
        active++;

        try {
          const response = await axios.get(this.url, {
            headers: { Range: `bytes=${chunk.start}-${chunk.end}` },
            responseType: 'arraybuffer',
            signal: this.abortSignal,
          });

          results[chunk.index] = response.data;
          this.downloadedBytes += response.data.byteLength;
          
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
          this.aborted = true;
          reject(err);
        }
      };

      // Start initial batch
      for (let i = 0; i < Math.min(this.concurrency, numChunks); i++) {
        downloadNext();
      }
    }).then(() => {
      // Merge results to file
      for (const buffer of results) {
        writeStream.write(buffer);
      }
      writeStream.end();
      return this.outputPath;
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

  const isYT = isYouTubePage(url);
  const baseName = `dl_${Date.now()}`;
  const localPath = join(TMP_DIR, `${baseName}.tmp`);

  if (!isYT) {
    // High-speed parallel path for direct URLs
    const downloader = new ParallelDownloader(url, localPath, {
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
    noWarnings: true,
    newline: true,
    progress: true,
    noPlaylist: true, // Avoid "NoneType" errors on videos in playlists
    concurrentFragments: 5, // Speed up fragment-based downloads
  };

  if (cookiesPath && existsSync(cookiesPath)) {
    options.cookies = cookiesPath;
  }

  const binDir = join(__dirname, '../../bin');
  const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const localBin = join(binDir, binName);
  const youtubedl = existsSync(localBin) ? create(localBin) : create('yt-dlp');

  console.log(`🚀 yt-dlp starting: ${url}`);

  const subprocess = youtubedl.exec(url, options);

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
