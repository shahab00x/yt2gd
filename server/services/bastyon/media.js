/**
 * Media upload module for uploading images and videos to Bastyon proxies and PeerTube servers.
 * Ported 1:1 from bastyon-poster-linux/src/media.py
 */

import { createReadStream, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import axios from 'axios';
import FormData from 'form-data';
import { sha256, signRecoverableCompact } from './crypto.js';

export const PEERTUBE_HOSTS = [
  'https://peertube331.pocketnet.app',
  'https://peertube.pocketnet.app',
  'https://peertube.bastyon.com',
  'https://peertube101.pocketnet.app',
  'https://peertube1000.pocketnet.app',
  'https://peertube372.pocketnet.app',
  'https://peertube160.pocketnet.app',
];

// Live instance registry used by the official pocketnet.gui (proxy16/config.json:
// "peertubesListLink"). Maintained by the Bastyon team; each entry carries
// online/upload status so we can pick working upload targets dynamically.
export const PEERTUBE_LIST_URL =
  'https://raw.githubusercontent.com/shpingalet007/bastyon-peertubes/master/list.json';

const INSTANCE_LIST_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const PROBE_CONCURRENCY = 6;
const SIMPLE_UPLOAD_THRESHOLD = 50 * 1024 * 1024; // 50MB

let instanceCache = null;
let instanceCacheTime = 0;

/** Flatten the bastyon-peertubes list.json into upload-capable https host URLs. */
export function parsePeertubeList(list) {
  if (!list || typeof list !== 'object') return [];
  const hosts = [];
  for (const swarm of Object.values(list.swarms || {})) {
    if (!swarm || swarm.testnet) continue;
    for (const server of swarm.list || []) {
      if (server && server.host && server.upload === true && server.online === true && !server.special) {
        hosts.push(`https://${server.host}`);
      }
    }
  }
  return [...new Set(hosts)];
}

/** Fetch the live PeerTube instance list, cached per TTL. Returns [] on failure. */
export async function fetchPeertubeInstances() {
  if (instanceCache && Date.now() - instanceCacheTime < INSTANCE_LIST_TTL_MS) {
    return instanceCache;
  }
  try {
    const resp = await axios.get(PEERTUBE_LIST_URL, { timeout: 15_000 });
    const hosts = parsePeertubeList(resp.data);
    instanceCache = hosts;
    instanceCacheTime = Date.now();
    return hosts;
  } catch (e) {
    console.warn(`[Bastyon] Failed to fetch PeerTube instance list (${e.message}); using static fallback hosts.`);
    return [];
  }
}

/** Probe hosts with the cheap oauth-clients endpoint and order reachable ones first. */
export async function probePeertubeHosts(hosts, concurrency = PROBE_CONCURRENCY) {
  const results = [];
  let index = 0;
  const worker = async () => {
    while (index < hosts.length) {
      const host = hosts[index++];
      try {
        const resp = await axios.get(`${host}/api/v1/oauth-clients/local`, { timeout: 5000 });
        // axios follows redirects by default; a dead host can 301 to an unrelated site
        // and come back 200, falsely looking alive. Require the final response to come
        // from the same host (allows same-host http<->https redirects only).
        const probeUrl = new URL(`${host}/api/v1/oauth-clients/local`);
        const finalUrl = new URL(resp.request.res?.responseUrl || probeUrl.href);
        results.push({ host, alive: resp.status === 200 && finalUrl.host === probeUrl.host });
      } catch {
        results.push({ host, alive: false });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
  results.sort((a, b) => (b.alive ? 1 : 0) - (a.alive ? 1 : 0));
  return results.map((r) => r.host);
}

export class MediaUploadError extends Error {}

function guessMime(filePath) {
  const ext = extname(filePath).toLowerCase();
  const map = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
    '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  };
  return map[ext] || '';
}

/** Upload a local image file (PNG/JPEG) to Bastyon media proxies. Returns direct HTTP image URL. */
export async function uploadImage(filePath, nodeUrl = 'https://1.pocketnet.app:8899') {
  const { readFileSync } = await import('node:fs');
  if (!requireExists(filePath)) {
    throw new MediaUploadError(`Image file not found: ${filePath}`);
  }

  let mimeType = guessMime(filePath);
  if (!mimeType || !mimeType.startsWith('image/')) mimeType = 'image/jpeg';

  const fileBytes = readFileSync(filePath);
  const b64Data = `data:${mimeType};base64,` + fileBytes.toString('base64');

  // Primary: Bastyon PeerTube image proxy endpoint
  const primaryUrl = 'https://bastyon.com:8092/i/';
  try {
    const resp = await axios.post(primaryUrl, new URLSearchParams({ image: b64Data, action: 'upload' }), {
      timeout: 20_000,
      maxBodyLength: Infinity,
    });
    if (resp.status === 200) {
      const data = resp.data;
      if (data && typeof data === 'object') {
        const url = data.url || data.s || data.link;
        if (url) return url;
      }
    }
  } catch (e) {
    // fall through
  }

  // Fallback: Proxy node media upload endpoint
  const fallbackUrl = `${String(nodeUrl).replace(/\/+$/, '')}/public/image/upload`;
  try {
    const resp = await axios.post(fallbackUrl, { base64: b64Data }, { timeout: 20_000, maxBodyLength: Infinity });
    if (resp.status === 200) {
      const data = resp.data;
      if (data && typeof data === 'object' && data.url) return data.url;
    }
  } catch (e) {
    console.warn(`[Bastyon] Image upload failed (${e.message}). Using placeholder image URL.`);
    return 'https://dummyimage.com/600x400/000/fff&text=Placeholder+Image';
  }

  throw new MediaUploadError('All image upload endpoints failed.');
}

function requireExists(p) {
  try { statSync(p); return true; } catch { return false; }
}

/** Upload multiple local images sequentially and return their HTTP URLs. */
export async function uploadImages(filePaths, nodeUrl = 'https://1.pocketnet.app:8899') {
  const urls = [];
  for (const path of filePaths) {
    urls.push(await uploadImage(path, nodeUrl));
  }
  return urls;
}

/**
 * Perform Bastyon blockchain authentication with a PeerTube node to get an access token.
 */
export async function getPeertubeToken(account, host, timeout = 10) {
  const dt = new Date();
  const iso = dt.toISOString().slice(0, 19) + 'Z'; // seconds precision, UTC
  const nonce = `date=${iso},exp=360,s=7065657274756265`;
  const digest = sha256(Buffer.from(nonce, 'utf-8'));
  const sig64 = signRecoverableCompact(account.privateKeyBytes, digest).toString('hex');

  const data = {
    nonce,
    signature: sig64,
    pubkey: Buffer.from(account.publicKeyBytes).toString('hex'),
    address: account.address,
    v: 1,
  };

  // 1. Get client ID
  let clientData;
  try {
    const clientResp = await axios.get(`${host}/api/v1/oauth-clients/local`, { timeout: timeout * 1000 });
    if (clientResp.status !== 200) throw new MediaUploadError(`Failed to fetch oauth client: ${clientResp.statusText}`);
    clientData = clientResp.data;
  } catch (e) {
    if (e instanceof MediaUploadError) throw e;
    throw new MediaUploadError(`Failed to fetch oauth client: ${e.message}`);
  }

  // 2. Authenticate
  let authData;
  try {
    // Form-encoded, matching the Python reference's `requests.post(..., data=data)`. PeerTube's
    // blockchain-auth endpoint on the pocketnet fork rejects non-form bodies for valid tokens.
    const authResp = await axios.post(`${host}/api/v1/users/blockChainAuth`, new URLSearchParams(data), { timeout: timeout * 1000 });
    if (authResp.status !== 200) throw new MediaUploadError(`PeerTube blockchain auth failed: ${authResp.statusText}`);
    authData = authResp.data;
  } catch (e) {
    if (e instanceof MediaUploadError) throw e;
    throw new MediaUploadError(`PeerTube blockchain auth failed: ${e.message}`);
  }

  // 3. Get Token
  const tokenData = {
    client_id: clientData.client_id,
    client_secret: clientData.client_secret,
    response_type: 'code',
    grant_type: 'password',
    externalAuthToken: authData.externalAuthToken,
    username: authData.username,
  };
  if (!Object.values(tokenData).every((v) => v != null && v !== '')) {
    throw new MediaUploadError('PeerTube authentication response was missing token fields');
  }
  try {
    // CRITICAL: PeerTube's OAuth token endpoint ONLY accepts application/x-www-form-urlencoded.
    // axios serializes plain objects as JSON, which the server rejects with 400
    // "content must be application/x-www-form-urlencoded" once the bypass token is valid.
    const tokenResp = await axios.post(`${host}/api/v1/users/token`, new URLSearchParams(tokenData), { timeout: timeout * 1000 });
    if (tokenResp.status !== 200) throw new MediaUploadError(`PeerTube token request failed: ${tokenResp.statusText}`);
    const accessToken = tokenResp.data.access_token;
    if (!accessToken) throw new MediaUploadError('PeerTube token response was missing access_token');
    return accessToken;
  } catch (e) {
    if (e instanceof MediaUploadError) throw e;
    throw new MediaUploadError(`PeerTube token request failed: ${e.message}`);
  }
}

/** Fetch the first video channel ID for the authenticated PeerTube user. */
export async function getPeertubeChannelId(token, host, timeout = 10) {
  const headers = { Authorization: `Bearer ${token}` };
  let data;
  try {
    const resp = await axios.get(`${host}/api/v1/users/me`, { headers, timeout: timeout * 1000 });
    if (resp.status !== 200) throw new MediaUploadError(`Failed to fetch PeerTube user profile: ${resp.statusText}`);
    data = resp.data;
  } catch (e) {
    if (e instanceof MediaUploadError) throw e;
    throw new MediaUploadError(`Failed to fetch PeerTube user profile: ${e.message}`);
  }
  if (data.videoChannels && data.videoChannels[0] && data.videoChannels[0].id != null) {
    return data.videoChannels[0].id;
  }
  throw new MediaUploadError('PeerTube user has no video channels configured.');
}

/** Upload a video file to one PeerTube host via simple or resumable upload API. */
export async function uploadToPeertube(filePath, account, host, onProgress = null) {
  if (!requireExists(filePath)) throw new MediaUploadError(`Video file not found: ${filePath}`);

  const fileSize = statSync(filePath).size;
  let mimeType = guessMime(filePath);
  if (!mimeType || !mimeType.startsWith('video/')) mimeType = 'video/mp4';

  const normalizedHost = String(host).replace(/\/+$/, '');
  const fileSizeMb = fileSize / (1024 * 1024);

  // Step 1: Get Access Token & Channel ID
  let token, channelId;
  try {
    token = await getPeertubeToken(account, normalizedHost, 30);
    channelId = await getPeertubeChannelId(token, normalizedHost, 30);
  } catch (e) {
    if (e instanceof MediaUploadError) throw new MediaUploadError(`${normalizedHost}: ${e.message}`);
    throw new MediaUploadError(`${normalizedHost}: PeerTube authentication failed: ${e.message}`);
  }

  const uniqueName = `${basename(filePath, extname(filePath))}-${randomUUID().slice(0, 8)}`;
  const headers = { Authorization: `Bearer ${token}` };
  const hostDomain = normalizedHost.replace(/^https?:\/\//, '').split('/')[0];

  let respData = null;

  if (fileSize <= SIMPLE_UPLOAD_THRESHOLD) {
    // Simple multipart upload for small files (<= 50MB)
    if (onProgress) onProgress({ phase: 'upload', label: `Uploading video (${fileSizeMb.toFixed(2)}MB) via simple upload...` });
    const form = new FormData();
    form.append('videofile', createReadStream(filePath), {
      filename: basename(filePath),
      contentType: mimeType,
    });
    form.append('privacy', '1');
    form.append('channelId', String(channelId));
    form.append('name', uniqueName);

    const maxRetries = 3;
    let lastErr = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const uploadResp = await axios.post(`${normalizedHost}/api/v1/videos/upload`, form, {
          headers: { ...headers, ...form.getHeaders() },
          timeout: 600_000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        });
        if (uploadResp.status === 200) {
          respData = uploadResp.data;
        } else {
          throw new MediaUploadError(
            `${normalizedHost}: PeerTube upload failed (${uploadResp.status}): ${JSON.stringify(uploadResp.data).slice(0, 500)}`
          );
        }
        break;
      } catch (e) {
        lastErr = e;
        if (attempt < maxRetries - 1) {
          const wait = (2 ** attempt) * 5;
          if (onProgress) onProgress({ phase: 'upload', label: `Upload retry ${attempt + 1}/${maxRetries} after ${wait}s...` });
          await new Promise((r) => setTimeout(r, wait * 1000));
        }
      }
    }
    if (respData == null && lastErr) {
      throw new MediaUploadError(`${normalizedHost}: PeerTube upload failed after ${maxRetries} retries: ${lastErr.message}`);
    }
  } else {
    // Resumable upload for large files (> 50MB)
    if (onProgress) onProgress({ phase: 'upload', label: `Uploading video (${fileSizeMb.toFixed(2)}MB) via resumable upload...` });
    const initHeaders = {
      ...headers,
      'X-Upload-Content-Length': String(fileSize),
      'X-Upload-Content-Type': mimeType,
    };
    const initData = new URLSearchParams({
      filename: basename(filePath),
      name: uniqueName,
      channelId: String(channelId),
      privacy: '1',
    });

    let initResp;
    try {
      initResp = await axios.post(`${normalizedHost}/api/v1/videos/upload-resumable`, initData, {
        headers: initHeaders,
        timeout: 60_000,
      });
    } catch (e) {
      throw new MediaUploadError(`${normalizedHost}: Resumable upload init request failed: ${e.message}`);
    }
    if (![200, 201].includes(initResp.status)) {
      throw new MediaUploadError(
        `${normalizedHost}: Resumable upload init failed (${initResp.status}): ${JSON.stringify(initResp.data).slice(0, 500)}`
      );
    }

    const location = initResp.headers.location || initResp.headers.Location || '';
    const uploadIdMatch = location.match(/upload_id=([^&]+)/);
    if (!uploadIdMatch) {
      throw new MediaUploadError(`${normalizedHost}: Resumable upload init response missing upload_id in Location header: '${location}'`);
    }
    const uploadId = uploadIdMatch[1];

    const chunkSize = 1024 * 1024; // 1MB chunks
    const putUrl = `${normalizedHost}/api/v1/videos/upload-resumable?upload_id=${uploadId}`;
    let currentOffset = 0;
    let completed = false;

    while (currentOffset < fileSize) {
      const endByte = Math.min(currentOffset + chunkSize, fileSize) - 1;
      // The pocketnet.gui reference sends application/octet-stream on chunk PUTs.
      const chunkHeaders = {
        ...headers,
        'Content-Length': String(endByte - currentOffset + 1),
        'Content-Range': `bytes ${currentOffset}-${endByte}/${fileSize}`,
        'Content-Type': 'application/octet-stream',
      };

      const maxAttempts = 5;
      let success = false;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const putResp = await axios.put(putUrl, createReadStream(filePath, { start: currentOffset, end: endByte }), {
            headers: chunkHeaders,
            timeout: 120_000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            // PeerTube signals "continue" with HTTP 308, which axios would otherwise treat as an
            // error (its default validateStatus only accepts 2xx). Python's requests passes 3xx
            // through, so match that behavior.
            validateStatus: (s) => s >= 200 && s < 400,
          });
          if ([200, 308].includes(putResp.status)) {
            if (putResp.status === 200) {
              respData = putResp.data;
              completed = true;
            }
            currentOffset = endByte + 1;
            success = true;
            break;
          }
        } catch (e) {
          console.warn(`[Bastyon] Resumable chunk upload exception on attempt ${attempt + 1}/${maxAttempts}: ${e.message}`);
        }

        // Network drop or PUT failure — query GET status to resync current offset
        if (onProgress) onProgress({ phase: 'upload', label: `Interruption detected; checking progress for upload_id=${uploadId}...` });
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const statusResp = await axios.get(putUrl, { headers: { Authorization: `Bearer ${token}` }, timeout: 30_000 });
          if (statusResp.status === 200) {
            respData = statusResp.data;
            currentOffset = fileSize;
            completed = true;
            success = true;
            break;
          } else if (statusResp.status === 308) {
            const rangeHdr = statusResp.headers.range || statusResp.headers.Range || '';
            const rangeMatch = rangeHdr.match(/bytes=0-(\d+)/);
            if (rangeMatch) {
              currentOffset = parseInt(rangeMatch[1], 10) + 1;
              if (onProgress) onProgress({ phase: 'upload', label: `Resynced offset to byte ${currentOffset} from server Range header.` });
              success = true;
              break;
            }
          }
        } catch (getErr) {
          console.warn(`[Bastyon] GET status check error: ${getErr.message}`);
        }
      }

      if (!success) {
        throw new MediaUploadError(`${normalizedHost}: Resumable upload failed at byte ${currentOffset} after ${maxAttempts} attempts`);
      }
      if (onProgress && fileSize > 0) {
        onProgress({ phase: 'upload', percent: Math.round((currentOffset / fileSize) * 100) });
      }
    }

    if (!completed && respData == null) {
      throw new MediaUploadError(`${normalizedHost}: Resumable upload did not complete`);
    }
  }

  // Common UUID extraction logic
  let vuuid = null;
  if (respData && typeof respData === 'object') {
    vuuid =
      (respData.video && respData.video.uuid) ||
      respData.uuid ||
      respData.shortUUID ||
      respData.id ||
      null;
    if (!vuuid && respData.video && respData.video.videoCreated && respData.video.videoCreated.url) {
      vuuid = String(respData.video.videoCreated.url).replace(/\/+$/, '').split('/').pop();
    } else if (!vuuid && respData.url) {
      vuuid = String(respData.url).replace(/\/+$/, '').split('/').pop();
    }
  }

  if (vuuid) {
    return `peertube://${hostDomain}/${vuuid}`;
  }

  throw new MediaUploadError(`${normalizedHost}: PeerTube upload response missing video UUID: ${JSON.stringify(respData).slice(0, 500)}`);
}

/** Upload a video file to PeerTube, trying fallback hosts unless one is specified. */
export async function uploadVideo(filePath, account, peertubeHost = null, onProgress = null) {
  if (!requireExists(filePath)) throw new MediaUploadError(`Video file not found: ${filePath}`);

  let hosts;
  if (peertubeHost) {
    hosts = [peertubeHost];
  } else {
    const dynamic = await fetchPeertubeInstances();
    const probed = dynamic.length ? await probePeertubeHosts(dynamic) : [];
    // Static verified hosts (incl. peertube331) always remain as a guaranteed
    // fallback tail — the dynamic list excludes them (flagged upload:false) but
    // they accept uploads in practice.
    hosts = [...probed, ...PEERTUBE_HOSTS].filter((h, i, arr) => arr.indexOf(h) === i);
  }
  const failures = [];
  for (const host of hosts) {
    const normalizedHost = String(host).replace(/\/+$/, '');
    try {
      return await uploadToPeertube(filePath, account, normalizedHost, onProgress);
    } catch (e) {
      // uploadToPeertube already prefixes some errors with the host — avoid doubling it.
      const msg = e.message || String(e);
      const failure = msg.startsWith(normalizedHost) ? msg : `${normalizedHost}: ${msg}`;
      failures.push(failure);
      console.warn(`[Bastyon] PeerTube upload failed on ${normalizedHost}: ${msg}`);
    }
  }
  throw new MediaUploadError('All PeerTube hosts failed: ' + failures.join('; '));
}
