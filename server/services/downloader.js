import axios from 'axios';
import { createWriteStream, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import { pipeline } from 'stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TMP_DIR = join(__dirname, '../../tmp');

/**
 * Download a file from a URL, save it to /tmp, return the local path.
 * Streams the file to avoid loading large files into memory.
 * @param {string} url - The URL of the file to download.
 * @returns {Promise<string>} - Absolute path of the saved file.
 */
export async function downloadFile(url) {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }

  // Extract filename from URL, fallback to timestamp
  let filename;
  try {
    const urlObj = new URL(url);
    filename = basename(urlObj.pathname) || `download_${Date.now()}`;
    // Strip any query string characters from filename
    filename = filename.split('?')[0];
  } catch {
    filename = `download_${Date.now()}`;
  }

  if (!filename || filename === '/') {
    filename = `download_${Date.now()}`;
  }

  const destPath = join(TMP_DIR, filename);

  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 60000 * 5, // 5 minute timeout
    headers: {
      'User-Agent': 'yt2gd/1.0'
    }
  });

  // Try to get a better filename from Content-Disposition header
  const contentDisposition = response.headers['content-disposition'];
  if (contentDisposition) {
    const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (match && match[1]) {
      const cdFilename = match[1].replace(/['"]/g, '').trim();
      if (cdFilename) {
        filename = cdFilename;
      }
    }
  }

  const finalPath = join(TMP_DIR, filename);
  const writer = createWriteStream(finalPath);
  await pipeline(response.data, writer);

  console.log(`✅ Downloaded: ${filename} (${finalPath})`);
  return finalPath;
}
