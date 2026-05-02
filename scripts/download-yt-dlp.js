#!/usr/bin/env node
/**
 * scripts/download-yt-dlp.js
 *
 * Downloads the correct yt-dlp binary for the current OS into the /bin directory.
 * Runs automatically as an `npm run postinstall` step.
 */

import { existsSync, mkdirSync, chmodSync, createWriteStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BIN_DIR = join(__dirname, '../bin');
const IS_WIN = process.platform === 'win32';
const BIN_NAME = IS_WIN ? 'yt-dlp.exe' : 'yt-dlp';
const BIN_PATH = join(BIN_DIR, BIN_NAME);
const DOWNLOAD_URL = IS_WIN
  ? 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp';

if (existsSync(BIN_PATH)) {
  console.log(`[yt-dlp] Binary already exists at ${BIN_PATH}, skipping download.`);
  process.exit(0);
}

if (!existsSync(BIN_DIR)) {
  mkdirSync(BIN_DIR, { recursive: true });
}

console.log(`[yt-dlp] Downloading binary for ${process.platform}...`);
console.log(`[yt-dlp] Source: ${DOWNLOAD_URL}`);

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const request = https.get(url, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    });
    request.on('error', (err) => {
      file.close();
      reject(err);
    });
  });
}

try {
  await download(DOWNLOAD_URL, BIN_PATH);
  if (!IS_WIN) {
    chmodSync(BIN_PATH, 0o755);
  }
  console.log(`[yt-dlp] ✅ Binary saved to ${BIN_PATH}`);
} catch (err) {
  console.error(`[yt-dlp] ❌ Failed to download binary: ${err.message}`);
  console.error('[yt-dlp] You can manually download yt-dlp from https://github.com/yt-dlp/yt-dlp/releases and place it in the /bin directory.');
  // Don't fail the install entirely — the app works without it for direct downloads
  process.exit(0);
}
