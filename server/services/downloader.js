import { existsSync, mkdirSync, mkdtempSync, readdirSync, createWriteStream, createReadStream, openSync, writeSync, closeSync, readFileSync, writeFileSync, unlinkSync, rmSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename, normalize } from 'path';
import { create } from 'youtube-dl-exec';
import axios from 'axios';
import WebTorrent from 'webtorrent';
import archiver from 'archiver';
import { loadSettings } from './settings.js';
import { getDiskUsage } from './system_utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const TMP_DIR = join(__dirname, '../../tmp');

function ensureTmpDir() {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
}

/**
 * Clear the tmp directory to reclaim space.
 */
export function clearTmp() {
  console.log(`🧹 Clearing temporary directory: ${TMP_DIR}`);
  try {
    if (existsSync(TMP_DIR)) {
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
    ensureTmpDir();
  } catch (err) {
    console.warn(`⚠️ Failed to clear tmp directory: ${err.message}`);
  }
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

    // Write filtered cookies to data/ directory to avoid triggering file watchers
    const dataDir = join(__dirname, '../../data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    const newPath = join(dataDir, 'cookies_filtered.txt');
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
 * Detect if a URL is a direct media/file link rather than a video page.
 * Direct links keep using the high-speed parallel downloader; everything else
 * is handed to yt-dlp, which supports the hundreds of sites listed in
 * yt-dlp_supportedsites.md (not just YouTube).
 */
const DIRECT_FILE_EXT_RE = /\.(mp4|mkv|webm|avi|mov|wmv|flv|3gp|m4v|mp3|wav|aac|ogg|m4a|opus|flac|wma|zip|rar|7z|tar|gz|bz2|xz|pdf|epub|jpg|jpeg|png|gif|webp|bmp|exe|msi|dmg|iso|apk|txt|md)$/i;

function isDirectFileUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    // YouTube stream URLs are direct media, not pages
    if (hostname.includes('googlevideo.com') || pathname.includes('videoplayback')) return true;
    const lastSegment = pathname.split('/').pop().split('?')[0].split('#')[0];
    return DIRECT_FILE_EXT_RE.test(lastSegment);
  } catch { return false; }
}

/**
 * Detect if a URL is a magnet link.
 */
function isMagnet(url) {
  return typeof url === 'string' && url.startsWith('magnet:?');
}

/**
 * Detect playlist-style URLs (YouTube list= params, /playlist paths).
 */
export function isPlaylistUrl(url) {
  try {
    const { searchParams, pathname } = new URL(url);
    if (pathname.includes('/playlist') || pathname.includes('/playlists')) return true;
    return !!searchParams.get('list');
  } catch { return false; }
}

/**
 * Audio track options for the auto-dub fix (mirrors the tinnitus-sound-therapy app).
 * 'original' relies on the `formatSort: ['lang', 'quality']` sort key, which ranks
 * the original-language stream above YouTube's auto-dubbed/region-selected tracks.
 */
export const AUDIO_LANGUAGES = {
  original: { code: null, label: 'Original (default)' },
  en: { code: 'en', label: 'English' },
  fa: { code: 'fa', label: 'Farsi' },
  ar: { code: 'ar', label: 'Arabic' },
  tr: { code: 'tr', label: 'Turkish' },
  fr: { code: 'fr', label: 'French' },
  de: { code: 'de', label: 'German' },
  es: { code: 'es', label: 'Spanish' },
  pt: { code: 'pt', label: 'Portuguese' },
  ru: { code: 'ru', label: 'Russian' },
  hi: { code: 'hi', label: 'Hindi' },
  ja: { code: 'ja', label: 'Japanese' },
  ko: { code: 'ko', label: 'Korean' },
};

/**
 * Build a yt-dlp `-f` format selector from format/quality/audio-track preferences.
 * The audio chain mirrors the proven tinnitus `audioFormatSelector`: prefer m4a,
 * restrict to the requested language via [language^=code], exclude DRC duplicates
 * ([format_id!*=drc]), then fall back to the original-track chain and finally to
 * plain bestaudio so a download never fails on format grounds.
 */
export function buildFormatSelector({ format = 'video', quality = 'best', audioLanguage = 'original' } = {}) {
  const lang = AUDIO_LANGUAGES[audioLanguage] || AUDIO_LANGUAGES.original;
  const noDrc = '[format_id!*=drc]';
  const alternatives = [];
  if (lang.code) {
    const langFilter = `[language^=${lang.code}]`;
    alternatives.push(`bestaudio[ext=m4a]${langFilter}${noDrc}`);
    alternatives.push(`bestaudio${langFilter}${noDrc}`);
    // Wanted language exists but without m4a/DRC constraints — still prefer it
    alternatives.push(`bestaudio${langFilter}`);
  }
  // Original-track chain ("-S lang" ranks the original first), doubling as the
  // fallback when the requested language is unavailable.
  alternatives.push(`bestaudio[ext=m4a]${noDrc}`);
  alternatives.push(`bestaudio${noDrc}`);
  alternatives.push('bestaudio');
  const audioSelector = alternatives.join('/');

  if (format === 'audio') return audioSelector;
  if (quality === 'worst') return 'worstvideo+worstaudio/worst';
  if (!quality || quality === 'best') return `bestvideo+${audioSelector}/best`;
  return `bestvideo[height<=${quality}]+${audioSelector}/best[height<=${quality}]`;
}

/**
 * Shared yt-dlp option builder. `formatSort: ['lang', 'quality']` makes every
 * bestaudio/merge prefer the ORIGINAL language track over auto-dubbed ones.
 */
function buildYtdlpOptions({ output, format, quality, audioLanguage, isLive, isPlaylistUrl, printJson = false }) {
  return {
    output,
    format: buildFormatSelector({ format, quality, audioLanguage }),
    newline: true,
    progress: true,
    formatSort: ['lang', 'quality'], // auto-dub fix: prefer original audio track
    ...(printJson ? { printJson: true } : {}),
    // Only add noPlaylist for non-playlist URLs; omitting the key entirely allows playlists through
    ...(isPlaylistUrl ? {} : { noPlaylist: true }),
    concurrentFragments: 10, // Speed up fragment-based downloads
    userAgent: DEFAULT_UA,
    noJsRuntimes: true,
    jsRuntimes: 'node',
    remoteComponents: 'ejs:github',
    socketTimeout: 120,
    noCheckCertificates: true,
    geoBypass: true,
    // Skip unavailable videos instead of crashing
    skipUnavailableFragments: true,
    ignoreErrors: true, // Instruct yt-dlp to skip unavailable videos rather than halting
    ...(isLive ? {
      liveFromStart: true,
      noPart: true,
      waitForVideo: 10,
    } : {
      matchFilters: '!is_live',
    }),
  };
}

function createYtdlpExec() {
  const binDir = join(__dirname, '../../bin');
  const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const localBin = join(binDir, binName);
  return existsSync(localBin) ? create(localBin) : create('yt-dlp');
}

/** True when yt-dlp reports the URL as unsupported (error string from the extractor). */
function isUnsupportedUrl(err) {
  const msg = String(err?.stderr || err?.message || '');
  return msg.includes('Unsupported URL') || msg.includes('unsupported URL');
}

/** Extract a concise user-facing message from a youtube-dl-exec error (its stderr). */
function cleanYtdlpError(err) {
  const stderr = String(err?.stderr || '');
  if (stderr) {
    const errorLines = stderr.split('\n').filter((l) => l.includes('ERROR:'));
    if (errorLines.length) return errorLines.join(' | ').slice(0, 500);
    return stderr.trim().slice(0, 500);
  }
  return String(err?.message || 'Download failed.');
}

/**
 * Run a yt-dlp subprocess with abort + progress wiring and return its stdout text.
 */
function runYtdlpExec(clean, options, { url, abortSignal, onProgress }) {
  const youtubedl = createYtdlpExec();
  console.log(`🚀 yt-dlp starting: ${clean}`);
  const subprocess = youtubedl.exec(clean, options);
  let stdoutText = '';

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
    const text = chunk.toString();
    stdoutText += text;
    const line = text.trim();
    if (line && onProgress) onProgress(line);
  });

  subprocess.stderr?.on('data', (chunk) => {
    console.error(`[yt-dlp] ${chunk.toString().trim()}`);
  });

  return (async () => {
    try {
      await subprocess;
    } finally {
      if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
    }
    return stdoutText;
  })();
}

/** Parse all JSON objects embedded in yt-dlp stdout lines (--print-json emits one per entry). */
function parseJsonEntries(stdoutText) {
  const entries = [];
  for (const line of String(stdoutText || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') entries.push(parsed);
    } catch { /* not a JSON line */ }
  }
  return entries;
}

/** Extract the on-disk file path from --print-json metadata (filepath/_filename/requested_downloads). */
function metadataFilePath(metadata) {
  for (const key of ['filepath', '_filename']) {
    const v = metadata[key];
    if (typeof v === 'string' && v) return v;
  }
  const rd = metadata.requested_downloads;
  if (Array.isArray(rd)) {
    for (const dl of rd) {
      if (!dl || typeof dl !== 'object') continue;
      for (const key of ['filepath', '_filename']) {
        const v = dl[key];
        if (typeof v === 'string' && v) return v;
      }
    }
  }
  return null;
}

/** Newest file inside a directory, or null. */
function findLatestFile(dir) {
  try {
    const candidates = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
    if (!candidates.length) return null;
    candidates.sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs);
    return join(dir, candidates[0]);
  } catch { return null; }
}

/**
 * Zip a directory into a single file.
 */
export async function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(outPath));
    archive.on('error', (err) => reject(err));

    archive.pipe(output);
    const stats = statSync(sourceDir);
    if (stats.isFile()) {
      archive.file(sourceDir, { name: basename(sourceDir) });
    } else {
      archive.directory(sourceDir, false);
    }
    archive.finalize();
  });
}

/**
 * Download a torrent via magnet link and optionally zip it.
 * Implements batching for large torrents in folder mode.
 */
export async function downloadTorrent(magnetUrl, onProgress = null, abortSignal = null, skipZip = false, onBatchComplete = null, startBatchIndex = 0) {
  const settings = loadSettings();
  const batchLimitBytes = (settings.torrentBatchSizeGB || 12) * 1024 * 1024 * 1024;

  return new Promise((resolve, reject) => {
    let client;
    const safeDestroy = () => {
      if (client && !client.destroyed) {
        try {
          client.destroy();
        } catch (e) {
          console.warn('⚠️ Error destroying client:', e.message);
        }
      }
    };
    try {
      client = new WebTorrent();
    } catch (err) {
      return reject(err);
    }

    // Swallow non-fatal peer/UTP errors so they don't crash the process
    client.on('error', (err) => {
      const msg = err?.message || '';
      if (msg.includes('UTP_') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT')) {
        console.warn(`⚠️  WebTorrent peer error (ignored): ${msg}`);
      } else {
        console.error(`❌ WebTorrent error: ${msg}`);
        safeDestroy();
        reject(err);
      }
    });

    const torrentId = `torrent_${Date.now()}`;
    const downloadDir = join(TMP_DIR, torrentId);
    if (!existsSync(downloadDir)) mkdirSync(downloadDir, { recursive: true });

    client.add(magnetUrl, { path: downloadDir }, async (torrent) => {
      console.log(`🧲 Torrent metadata received: ${torrent.name} (${(torrent.length / 1024 / 1024).toFixed(2)} MB)`);

      const updateProgress = (batchIndex, totalBatches) => {
        if (onProgress) {
          const speed = (torrent.downloadSpeed / 1024 / 1024).toFixed(2);
          const percent = (torrent.progress * 100).toFixed(1);
          const batchInfo = totalBatches > 1 ? ` [Batch ${batchIndex + 1}/${totalBatches}]` : '';
          onProgress(`Downloading${batchInfo}: ${percent}% (${speed} MB/s) · Peers: ${torrent.numPeers}`);
        }
      };

      // For zip mode or small torrents, download everything at once
      if (!skipZip || torrent.length <= batchLimitBytes) {
        torrent.on('download', () => updateProgress(0, 1));
        torrent.on('done', async () => {
          console.log(`✅ Torrent download complete: ${torrent.name}`);
          
          const safeName = (torrent.name || torrentId).replace(/[^a-z0-9. _-]/gi, '_');
          // If it's a folder-style torrent, the actual files are in a subfolder named torrent.name
          const actualDataDir = join(downloadDir, torrent.name || '');
          // If actualDataDir is a file, we use downloadDir as uploadPath to avoid ENOTDIR
          let uploadPath = downloadDir;
          if (existsSync(actualDataDir) && statSync(actualDataDir).isDirectory()) {
            uploadPath = actualDataDir;
          }

          if (skipZip) {
            safeDestroy();
            resolve({ downloadDir: uploadPath, torrentName: torrent.name, parentDir: downloadDir });
            return;
          }

          const zipPath = join(TMP_DIR, `${safeName}.zip`);
          try {
            if (onProgress) onProgress(`Packaging into ZIP...`);
            await zipDirectory(uploadPath, zipPath);
            safeDestroy();
            resolve({ zipPath, downloadDir, torrentName: torrent.name });
          } catch (err) {
            safeDestroy();
            reject(err);
          }
        });
      } else {
        // --- BATCHING LOGIC for large torrents in folder mode ---
        console.log(`📦 Large torrent detected. Processing in ${settings.torrentBatchSizeGB}GB batches.`);
        
        try {
          // --- STRICT PIECE-LEVEL BATCHING ---
          const tName = torrent.name || torrentId;

          // 1. Deselect ALL pieces in the torrent immediately to stop all background activity
          // This prevents WebTorrent from requesting any data for unselected files.
          torrent.deselect(0, torrent.pieces.length - 1, false);

          // 2. Group files into batches (deterministic calculation)
          const batches = [];
          let currentBatch = [];
          let currentBatchSize = 0;

          for (const file of torrent.files) {
            if (currentBatchSize + file.length > batchLimitBytes && currentBatch.length > 0) {
              batches.push(currentBatch);
              currentBatch = [];
              currentBatchSize = 0;
            }
            currentBatch.push(file);
            currentBatchSize += file.length;
          }
          if (currentBatch.length > 0) batches.push(currentBatch);

          // 3. Process ONLY the requested batch
          if (startBatchIndex >= batches.length) {
            safeDestroy();
            resolve({ completed: true, torrentName: tName });
            return;
          }

          const batch = batches[startBatchIndex];
          
          // 4. Calculate piece range for the current batch
          // We find the byte range of the entire batch and select all pieces that overlap it
          const firstFile = batch[0];
          const lastFile = batch[batch.length - 1];
          const startByte = firstFile.offset;
          const endByte = lastFile.offset + lastFile.length - 1;
          
          const startPiece = Math.floor(startByte / torrent.pieceLength);
          const endPiece = Math.floor(endByte / torrent.pieceLength);

          console.log(`🚀 Starting Batch ${startBatchIndex + 1}/${batches.length} (${batch.length} files, Pieces ${startPiece}-${endPiece})`);

          // 5. Select ONLY the pieces for this batch (Strict Piece Blocking)
          torrent.select(startPiece, endPiece, 1); // Priority 1

          // Also select the files themselves for WebTorrent's internal tracking
          batch.forEach(f => f.select());

          // Wait for batch to download
          await new Promise((res, rej) => {
            const onDownload = () => updateProgress(startBatchIndex, batches.length);
            torrent.on('download', onDownload);

            // Instant abort detection via signal listener
            const onAbort = () => {
              cleanup();
              rej(new Error('Download cancelled by user.'));
            };
            if (abortSignal) abortSignal.addEventListener('abort', onAbort);

            const checkDone = setInterval(() => {
              // --- DISK SPACE FAILSAFE ---
              // Check if free space is below 500MB
              try {
                const usage = getDiskUsage();
                if (usage.free > 0 && usage.free < 500 * 1024 * 1024) {
                  cleanup();
                  rej(new Error('DISK_SPACE_LOW: Less than 500MB remaining on VPS. Pausing for safety.'));
                }
              } catch (e) { /* ignore check errors */ }

              const batchDone = batch.every(f => f.progress === 1);
              if (batchDone) {
                cleanup();
                res();
              }
            }, 1000);

            function cleanup() {
              clearInterval(checkDone);
              torrent.removeListener('download', onDownload);
              if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
            }
          });

          console.log(`✅ Batch ${startBatchIndex + 1} complete. Preparing for upload...`);
          
          // Extract necessary data before destroying the client
          let uploadSource = downloadDir;
          let foundDirName = null;
          try {
            const items = readdirSync(downloadDir);
            const foundDir = items.find(i => {
              try {
                return statSync(join(downloadDir, i)).isDirectory();
              } catch { return false; }
            });
            if (foundDir) {
              uploadSource = join(downloadDir, foundDir);
              foundDirName = foundDir;
              console.log(`📁 Detected data directory: ${foundDir}`);
            }
          } catch (e) {
            console.warn(`⚠️ Could not list downloadDir for detection: ${e.message}`);
          }
          const mappedFiles = batch.map(f => {
            if (foundDirName) {
              const parts = f.path.split(/[/\\]/);
              if (parts.length > 1) {
                parts[0] = foundDirName;
                return normalize(join(downloadDir, ...parts));
              }
            }
            return normalize(join(downloadDir, f.path));
          });

          // **CRITICAL FIX**: Completely destroy the client BEFORE uploading.
          // torrent.pause() is not enough; WebTorrent continues to allocate sparse files 
          // and write pieces in the background, which fills the disk and starves the upload I/O.
          safeDestroy(); 
          console.log(`🛑 WebTorrent client destroyed to free disk I/O and prevent further allocation.`);

          if (onBatchComplete) {
            await onBatchComplete({
              dir: uploadSource,
              name: tName,
              batchIndex: startBatchIndex,
              totalBatches: batches.length,
              files: mappedFiles
            });
          }

          // Cleanup entire download directory to free disk space
          try {
            if (existsSync(downloadDir)) rmSync(downloadDir, { recursive: true, force: true });
            console.log(`🧹 Cleaned up download directory: ${downloadDir}`);
          } catch (e) {
            console.warn(`⚠️ Failed to clean download dir: ${e.message}`);
          }


          console.log(`🔍 Batch check: startBatchIndex=${startBatchIndex}, batches.length=${batches.length}, moreBatches=${startBatchIndex + 1 < batches.length}`);
          if (startBatchIndex + 1 < batches.length) {
            console.log(`✅ Returning batchPaused=true for next batch`);
            resolve({ batchPaused: true, torrentName: tName, downloadDir });
          } else {
            console.log(`✅ All batches completed, returning completed=true`);
            resolve({ completed: true, torrentName: tName, downloadDir });
          }

        } catch (err) {
          safeDestroy();
          reject(err);
        }
      }
    });

    client.on('error', (err) => {
      console.error('❌ WebTorrent error:', err.message);
      safeDestroy();
      reject(err);
    });

    if (abortSignal) {
      const onAbort = () => {
        console.log('🛑 Torrent download aborted.');
        safeDestroy();
        reject(new Error('Download was cancelled by user.'));
      };
      if (abortSignal.aborted) onAbort();
      else abortSignal.addEventListener('abort', onAbort);
    }
  });
}

/**
 * Download a URL using the best method available.
 * For playlists, skips unavailable videos instead of crashing.
 */
export async function downloadFile(url, format = 'video', quality = 'best', cookiesPath = null, onProgress = null, abortSignal = null, isLive = false, skipZip = false, onBatchComplete = null, startBatchIndex = 0, audioLanguage = 'original') {
  ensureTmpDir();

  const clean = cleanUrl(url);
  const isDirect = isDirectFileUrl(clean);
  const isMag = isMagnet(url);

  if (isMag) {
    return await downloadTorrent(url, onProgress, abortSignal, skipZip, onBatchComplete, startBatchIndex);
  }

  const d = new Date();
  const day = d.getDate().toString().padStart(2, '0');
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  const baseName = `${day}${h}${m}${s}`;

  const localPath = join(TMP_DIR, `${baseName}.tmp`);

  if (isDirect) {
    // High-speed parallel path for direct media URLs
    const downloader = new ParallelDownloader(clean, localPath, {
      onProgress: (p) => onProgress && onProgress(p.label),
      abortSignal
    });
    return await downloader.download();
  }

  // yt-dlp path for ANY supported site (not just YouTube)
  const outputTemplate = join(TMP_DIR, `${baseName} - %(channel)s - %(title)s.%(ext)s`);
  const isPlaylistUrl = clean.includes('list=');
  const options = buildYtdlpOptions({
    output: outputTemplate,
    format,
    quality,
    audioLanguage,
    isLive,
    isPlaylistUrl,
  });

  if (cookiesPath && existsSync(cookiesPath)) {
    options.cookies = cookiesPath;
  }

  const finalizeFiles = async () => {
    const files = readdirSync(TMP_DIR).filter(f => f.startsWith(`${baseName} - `));

    if (!files.length) throw new Error('Download finished but no output file found.');

    // --- FIX: Handle multiple files (playlists) ---
    if (files.length > 1) {
      console.log(`📂 Playlist detected: ${files.length} videos downloaded`);

      const playlistFolderId = `playlist_${Date.now()}`;
      const playlistDir = join(TMP_DIR, playlistFolderId);

      if (!existsSync(playlistDir)) mkdirSync(playlistDir, { recursive: true });

      // Move all files into the playlist folder
      for (const file of files) {
        const srcPath = join(TMP_DIR, file);
        const destPath = join(playlistDir, file);
        try {
          const fs = await import('fs/promises');
          await fs.rename(srcPath, destPath);
        } catch (err) {
          console.warn(`⚠️ Could not rename ${file}, using copy instead`);
          const fs = await import('fs/promises');
          await fs.copyFile(srcPath, destPath);
          await fs.unlink(srcPath);
        }
      }

      console.log(`✅ Organized playlist files in ${playlistFolderId}`);

      return {
        downloadDir: playlistDir,
        torrentName: `Playlist_${Date.now()}`,
        parentDir: playlistDir,
        isPlaylist: true
      };
    }

    return join(TMP_DIR, files[0]);
  };

  try {
    await runYtdlpExec(clean, options, { url, abortSignal, onProgress });
    return await finalizeFiles();
  } catch (err) {
    if (abortSignal?.aborted) throw new Error('Download was cancelled by user.');
    if (isUnsupportedUrl(err)) {
      console.warn(`⚠️ yt-dlp does not support "${clean}", falling back to direct download.`);
      const downloader = new ParallelDownloader(clean, localPath, {
        onProgress: (p) => onProgress && onProgress(p.label),
        abortSignal
      });
      return await downloader.download();
    }
    // Partial playlist downloads should still be organized/uploaded instead of crashing
    const files = readdirSync(TMP_DIR).filter(f => f.startsWith(`${baseName} - `));
    if (files.length > 0) {
      console.warn(`⚠️ yt-dlp exited with an error, but ${files.length} files were downloaded successfully. Continuing. Error:`, cleanYtdlpError(err));
      return await finalizeFiles();
    }
    throw new Error(cleanYtdlpError(err));
  }
}

/**
 * Download a single video with yt-dlp and return BOTH the local file path and the
 * extracted metadata (title/description/tags/thumbnail/original URL), using
 * --print-json. Used by the Bastyon Uploader to build an editable draft post.
 * Playlist and torrent/direct-file URLs are rejected up front.
 */
export async function downloadWithMetadata(url, { format = 'video', quality = 'best', audioLanguage = 'original', cookiesPath = null, onProgress = null, abortSignal = null, outputDir = null } = {}) {
  ensureTmpDir();

  const clean = cleanUrl(url);
  if (isMagnet(clean)) {
    throw new Error('Torrent/magnet links are not supported in the Bastyon Uploader.');
  }
  if (isDirectFileUrl(clean)) {
    throw new Error('Direct file URLs are not supported in the Bastyon Uploader — paste a video page URL instead.');
  }
  if (isPlaylistUrl(clean)) {
    throw new Error('Playlist URLs are not supported in the Bastyon Uploader. Use the Dashboard to download playlists.');
  }

  const targetDir = outputDir || mkdtempSync(join(TMP_DIR, 'bastyon-'));
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
  const outputTemplate = join(targetDir, '%(title)s.%(ext)s');
  const options = buildYtdlpOptions({
    output: outputTemplate,
    format,
    quality,
    audioLanguage,
    isLive: false,
    isPlaylistUrl: false,
    printJson: true,
  });
  if (cookiesPath && existsSync(cookiesPath)) {
    options.cookies = cookiesPath;
  }

  let stdoutText;
  try {
    stdoutText = await runYtdlpExec(clean, options, { url: clean, abortSignal, onProgress });
  } catch (err) {
    if (abortSignal?.aborted) throw new Error('Download was cancelled by user.');
    throw new Error(cleanYtdlpError(err));
  }

  const jsonEntries = parseJsonEntries(stdoutText);
  if (!jsonEntries.length) throw new Error('yt-dlp did not return parseable metadata.');
  if (jsonEntries.length > 1) {
    throw new Error('Playlist URLs are not supported in the Bastyon Uploader. Use the Dashboard to download playlists.');
  }
  const metadata = jsonEntries[jsonEntries.length - 1];

  const filePath = metadataFilePath(metadata) || findLatestFile(targetDir);
  if (!filePath || !existsSync(filePath)) {
    throw new Error('Download finished but no output file found.');
  }

  const tags = Array.isArray(metadata.tags) ? metadata.tags.map(String) : [];
  return {
    filePath,
    title: String(metadata.title || ''),
    description: String(metadata.description || ''),
    tags,
    thumbnail: String(metadata.thumbnail || ''),
    originalUrl: String(metadata.original_url || metadata.webpage_url || clean),
  };
}
