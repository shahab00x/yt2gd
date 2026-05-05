import { existsSync, mkdirSync, readdirSync, createWriteStream, openSync, writeSync, closeSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
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
  let url = rawUrl.trim();

  // Strip markdown: [text](url) → url
  const match = url.match(/\[.*?\]\((https?:\/\/[^\)]+)\)/);
  if (match) url = match[1];

  // More aggressive: find the first http... and take it until a space, bracket, or paren
  const httpMatch = url.match(/(https?:\/\/[^\s\]\)\(\[>]+)/);
  if (httpMatch) url = httpMatch[1];

  return url;
}

/**
 * Filter cookies.txt to only include domains relevant to YouTube/Google.
 * This prevents "HTTP 413: Request Entity Too Large" errors.
 */
export function filterCookies(cookiesPath) {
  if (!cookiesPath || !existsSync(cookiesPath)) return cookiesPath;
  try {
    const content = readFileSync(cookiesPath, 'utf8');
    const lines = content.split('\n');
    const filtered = lines.filter(line => {
      if (line.startsWith('#') || !line.trim()) return true;
      const domain = line.split('\t')[0] || '';
      return domain.includes('youtube.com') ||
        domain.includes('google.com') ||
        domain.includes('googlevideo.com') ||
        domain.includes('youtube-nocookie.com');
    });

    const newPath = cookiesPath.replace('.txt', '_filtered.txt');
    writeFileSync(newPath, filtered.join('\n'));
    return newPath;
  } catch (err) {
    console.warn('⚠️ Cookie filtering failed, using raw file:', err.message);
    return cookiesPath;
  }
}

/**
 * High-speed Parallel Downloader for direct media URLs.
 * Uses individual fragment files to avoid "ESPIPE: invalid seek" errors on Linux.
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
    this.fragmentDir = join(dirname(outputPath), `fragments_${Date.now()}`);
  }

  async download() {
    ensureTmpDir();
    if (!existsSync(this.fragmentDir)) mkdirSync(this.fragmentDir, { recursive: true });

    let headResponse;
    try {
      headResponse = await axios.head(this.url, {
        timeout: 15000,
        headers: { 'User-Agent': this.userAgent }
      });
      this.updateOutputPath(headResponse.headers);
    } catch (e) {
      console.warn(`⚠️ HEAD request failed, falling back to stream download:`, e.message);
      return this.streamDownload();
    }

    this.totalBytes = headResponse?.headers ? parseInt(headResponse.headers['content-length'], 10) : NaN;
    const acceptRanges = headResponse?.headers['accept-ranges'] === 'bytes';

    if (isNaN(this.totalBytes) || this.totalBytes <= 0 || !acceptRanges) {
      console.warn(`⚠️ Parallel download not supported (size: ${this.totalBytes}, ranges: ${acceptRanges}), falling back to stream download`);
      return this.streamDownload();
    }

    const numChunks = Math.ceil(this.totalBytes / this.chunkSize);
    const chunks = Array.from({ length: numChunks }, (_, i) => ({
      start: i * this.chunkSize,
      end: Math.min((i + 1) * this.chunkSize - 1, this.totalBytes - 1),
      index: i,
      path: join(this.fragmentDir, `part_${i}.tmp`)
    }));

    console.log(`🚀 Starting parallel download: ${numChunks} chunks, ${this.concurrency} concurrent.`);

    let active = 0;
    let nextIndex = 0;

    return new Promise((resolve, reject) => {
      const downloadNext = async () => {
        if (this.aborted) return;
        if (nextIndex >= numChunks) {
          if (active === 0) resolve(this.mergeFragments(chunks));
          return;
        }

        const chunk = chunks[nextIndex++];
        active++;

        try {
          const response = await axios.get(this.url, {
            headers: { 'Range': `bytes=${chunk.start}-${chunk.end}`, 'User-Agent': this.userAgent },
            responseType: 'arraybuffer',
            signal: this.abortSignal,
            timeout: 60000,
          });

          writeFileSync(chunk.path, Buffer.from(response.data));
          this.downloadedBytes += response.data.byteLength;

          const speed = this.downloadedBytes / ((Date.now() - this.startTime) / 1000);
          const percent = (this.downloadedBytes / this.totalBytes) * 100;

          this.onProgress({
            label: `Downloading: ${Math.round(percent)}% (${(speed / 1024 / 1024).toFixed(2)} MB/s)`
          });

          active--;
          downloadNext();
        } catch (err) {
          active--;
          if (!this.aborted) {
            this.aborted = true;
            reject(err);
          }
        }
      };

      for (let i = 0; i < Math.min(this.concurrency, numChunks); i++) downloadNext();
    });
  }

  updateOutputPath(headers) {
    try {
      const cd = headers['content-disposition'];
      let filename = '';
      if (cd && cd.includes('filename=')) {
        // Simple extraction, handles filename="name.ext" or filename=name.ext
        filename = cd.split('filename=')[1].split(';')[0].replace(/['"]/g, '').trim();
      } else {
        const urlObj = new URL(this.url);
        filename = basename(urlObj.pathname);
      }
      if (filename && filename !== '/' && filename.includes('.')) {
        this.outputPath = join(dirname(this.outputPath), filename);
        console.log(`📁 Target filename preserved: ${filename}`);
      }
    } catch (err) {
      console.warn('⚠️ Could not determine original filename:', err.message);
    }
  }

  async streamDownload() {
    console.log(`🚀 Starting single-stream download.`);
    return new Promise(async (resolve, reject) => {
      try {
        const response = await axios({
          method: 'GET',
          url: this.url,
          responseType: 'stream',
          headers: { 'User-Agent': this.userAgent },
          signal: this.abortSignal,
          timeout: 60000,
        });

        this.updateOutputPath(response.headers);
        if (response.headers['content-length']) {
           this.totalBytes = parseInt(response.headers['content-length'], 10) || 0;
        }

        const writer = createWriteStream(this.outputPath);
        response.data.pipe(writer);

        response.data.on('data', (chunk) => {
          if (this.aborted) {
             response.data.destroy();
             return;
          }
          this.downloadedBytes += chunk.length;
          const speed = this.downloadedBytes / ((Date.now() - this.startTime) / 1000);
          
          let progressStr = `${(this.downloadedBytes / 1024 / 1024).toFixed(2)} MB downloaded`;
          if (this.totalBytes) {
             const percent = (this.downloadedBytes / this.totalBytes) * 100;
             progressStr = `${Math.round(percent)}%`;
          }
          this.onProgress({
            label: `Downloading: ${progressStr} (${(speed / 1024 / 1024).toFixed(2)} MB/s)`
          });
        });

        writer.on('finish', () => resolve(this.outputPath));
        writer.on('error', reject);
        response.data.on('error', reject);
      } catch (err) {
        if (!this.aborted) {
          this.aborted = true;
          reject(err);
        }
      }
    });
  }

  async mergeFragments(chunks) {
    console.log(`🔄 Merging ${chunks.length} fragments into ${basename(this.outputPath)}...`);
    const fd = openSync(this.outputPath, 'w');
    for (const chunk of chunks) {
      const buffer = readFileSync(chunk.path);
      writeSync(fd, buffer);
      unlinkSync(chunk.path);
    }
    closeSync(fd);
    // Clean up dir
    try { readdirSync(this.fragmentDir).forEach(f => unlinkSync(join(this.fragmentDir, f))); } catch { }
    return this.outputPath;
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
export async function downloadFile(url, format = 'video', quality = 'best', cookiesPath = null, onProgress = null, abortSignal = null, isLive = false) {
  ensureTmpDir();

  const clean = cleanUrl(url);
  const isYT = isYouTubePage(url);
  
  const d = new Date();
  const day = d.getDate().toString().padStart(2, '0');
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  const baseName = `${day}${h}${m}${s}`;
  
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
  // const outputTemplate = join(TMP_DIR, `${baseName}.%(ext)s`);
  // const outputTemplate = join(TMP_DIR, `${baseName}_%(title)s.%(ext)s`);
  const outputTemplate = join(TMP_DIR, `${baseName} - %(channel)s - %(title)s.%(ext)s`);

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
    remoteComponents: 'ejs:github', // Auto-download solver scripts
    socketTimeout: 120,
    noCheckCertificates: true,
    geoBypass: true,
    // Workaround for ended live streams and preventing sticking on active ones
    ...(isLive ? {
      liveFromStart: true,
      noPart: true,
      waitForVideo: 10,
    } : {
      matchFilters: '!is_live', // Reject active live streams to prevent getting stuck
    }),
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

  // const files = readdirSync(TMP_DIR).filter(f => f.startsWith(baseName));
  const files = readdirSync(TMP_DIR).filter(f => f.startsWith(`${baseName} - `));

  if (!files.length) throw new Error('Download finished but no output file found.');

  return join(TMP_DIR, files[0]);
}
