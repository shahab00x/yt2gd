import axios from 'axios';
import { createWriteStream, mkdirSync, existsSync, promises as fsPromises } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import { pipeline } from 'stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TMP_DIR = join(__dirname, '../../tmp');
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
const MAX_CONCURRENT = 5; // Download 5 chunks at a time

// Helper to limit concurrency
async function asyncPool(poolLimit, array, iteratorFn) {
  const ret = [];
  const executing = [];
  for (const item of array) {
    const p = Promise.resolve().then(() => iteratorFn(item, array));
    ret.push(p);
    if (poolLimit <= array.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= poolLimit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(ret);
}

/**
 * Download a file from a URL, save it to /tmp, return the local path.
 * Supports chunked downloading for speed improvements.
 * @param {string} url - The URL of the file to download.
 * @returns {Promise<string>} - Absolute path of the saved file.
 */
export async function downloadFile(url) {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }

  // Extract filename
  let filename;
  try {
    const urlObj = new URL(url);
    filename = basename(urlObj.pathname) || `download_${Date.now()}`;
    filename = filename.split('?')[0];
  } catch {
    filename = `download_${Date.now()}`;
  }

  if (!filename || filename === '/') {
    filename = `download_${Date.now()}`;
  }

  const standardHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Connection': 'keep-alive'
  };

  // 1. HEAD request to check size and range support
  let contentLength = null;
  let supportsRange = false;
  try {
    const headRes = await axios.head(url, { headers: standardHeaders, timeout: 10000 });
    if (headRes.headers['content-length']) {
      contentLength = parseInt(headRes.headers['content-length'], 10);
    }
    if (headRes.headers['accept-ranges'] === 'bytes') {
      supportsRange = true;
    }
    
    // Better filename extraction
    const contentDisposition = headRes.headers['content-disposition'];
    if (contentDisposition) {
      const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (match && match[1]) {
        const cdFilename = match[1].replace(/['"]/g, '').trim();
        if (cdFilename) filename = cdFilename;
      }
    }
  } catch (err) {
    console.log("HEAD request failed, falling back to GET check:", err.message);
  }

  const finalPath = join(TMP_DIR, filename);

  // 2. Decide download strategy
  if (supportsRange && contentLength && contentLength > CHUNK_SIZE) {
    console.log(`🚀 Starting chunked download: ${filename} (${(contentLength / 1024 / 1024).toFixed(2)} MB)`);
    
    const chunks = [];
    for (let i = 0; i < contentLength; i += CHUNK_SIZE) {
      const end = Math.min(i + CHUNK_SIZE - 1, contentLength - 1);
      chunks.push({ start: i, end, index: chunks.length });
    }

    // Download chunks concurrently
    await asyncPool(MAX_CONCURRENT, chunks, async (chunk) => {
      const chunkPath = `${finalPath}.part${chunk.index}`;
      const res = await axios.get(url, {
        headers: { ...standardHeaders, 'Range': `bytes=${chunk.start}-${chunk.end}` },
        responseType: 'stream',
        timeout: 60000
      });
      const writer = createWriteStream(chunkPath);
      await pipeline(res.data, writer);
    });

    console.log(`🧩 All chunks downloaded for ${filename}. Merging...`);
    // Merge chunks
    const finalWriter = createWriteStream(finalPath);
    for (const chunk of chunks) {
      const chunkPath = `${finalPath}.part${chunk.index}`;
      const data = await fsPromises.readFile(chunkPath);
      finalWriter.write(data);
      await fsPromises.unlink(chunkPath); // Clean up part
    }
    finalWriter.end();
    
    // Wait for writer to finish
    await new Promise(resolve => finalWriter.on('finish', resolve));
    
  } else {
    // Fallback: Single stream download
    console.log(`⬇️ Starting standard download: ${filename}`);
    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: 60000 * 5,
      headers: standardHeaders
    });

    const writer = createWriteStream(finalPath);
    await pipeline(response.data, writer);
  }

  console.log(`✅ Downloaded: ${filename} (${finalPath})`);
  return finalPath;
}
