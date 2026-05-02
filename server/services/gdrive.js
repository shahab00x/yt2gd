import { google } from 'googleapis';
import { createReadStream, statSync } from 'fs';
import { basename } from 'path';
import { loadSettings } from './settings.js';
import progressStream from 'progress-stream';

/**
 * Create an authorized Google Drive OAuth2 client from stored settings.
 */
function getAuthClient() {
  const settings = loadSettings();
  const { clientId, clientSecret, redirectUri, refreshToken } = settings.googleDrive || {};

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Drive credentials are not configured. Please set them in Settings.');
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri || 'http://localhost');
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

/**
 * Find or create a folder in Google Drive by name under a given parent.
 * @param {object} drive - Google Drive client instance.
 * @param {string} name - Folder name to find or create.
 * @param {string|null} parentId - Parent folder ID, or null for root.
 * @returns {Promise<string>} - The folder ID.
 */
async function findOrCreateFolder(drive, name, parentId = null) {
  const query = [
    `name = '${name}'`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    `trashed = false`,
    parentId ? `'${parentId}' in parents` : `'root' in parents`
  ].join(' and ');

  const res = await drive.files.list({
    q: query,
    fields: 'files(id, name)',
    spaces: 'drive'
  });

  if (res.data.files.length > 0) {
    return res.data.files[0].id;
  }

  // Folder does not exist — create it
  const folderMeta = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: parentId ? [parentId] : []
  };
  const created = await drive.files.create({
    requestBody: folderMeta,
    fields: 'id'
  });
  console.log(`📁 Created folder "${name}" (${created.data.id})`);
  return created.data.id;
}

/**
 * Get the "Month_Day" date folder name for today.
 * e.g. "May_1"
 */
export function getTodayFolderName() {
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long' });
  const day = now.getDate();
  return `${month}_${day}`;
}

/**
 * Upload a local file to Google Drive under yt2gd/Month_Day/.
 * @param {string} filePath - Absolute path to the local file.
 * @param {function} onProgress - Called with { uploaded, total, speed, percent }
 * @param {AbortSignal} abortSignal - Optional signal to abort the upload.
 * @returns {Promise<object>} - Uploaded file metadata { id, name, webViewLink }.
 */
export async function uploadToGDrive(filePath, onProgress = null, abortSignal = null) {
  const auth = getAuthClient();
  const drive = google.drive({ version: 'v3', auth });

  // Ensure yt2gd root folder exists
  const rootFolderId = await findOrCreateFolder(drive, 'yt2gd', null);

  // Ensure today's date subfolder exists
  const dateFolderName = getTodayFolderName();
  const dateFolderId = await findOrCreateFolder(drive, dateFolderName, rootFolderId);

  const fileSize = statSync(filePath).size;
  const fileName = basename(filePath);

  console.log(`⬆️  Uploading "${fileName}" (${(fileSize / 1024 / 1024).toFixed(2)} MB)...`);

  // Wrap the read stream with progress tracking
  const prog = progressStream({ length: fileSize, time: 500 });
  prog.on('progress', (data) => {
    if (onProgress) {
      onProgress({
        uploaded: data.transferred,
        total: data.length,
        speed: data.speed,
        percent: data.percentage,
      });
    }
  });

  const rawStream = createReadStream(filePath);
  const body = rawStream.pipe(prog);

  // If aborted before we even start
  if (abortSignal?.aborted) {
    rawStream.destroy();
    throw new Error('Upload was cancelled by user.');
  }

  // Handle abort during upload
  const onAbort = () => {
    console.log(`🛑 Google Drive upload cancelled for ${fileName}`);
    rawStream.destroy();
  };
  if (abortSignal) abortSignal.addEventListener('abort', onAbort);

  try {
    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [dateFolderId]
      },
      media: { body },
      fields: 'id, name, webViewLink'
    }, {
      signal: abortSignal // Pass the abort signal directly to googleapis
    });

    console.log(`✅ Uploaded "${fileName}" → Drive ID: ${res.data.id}`);
    return res.data;
  } catch (err) {
    if (abortSignal?.aborted) throw new Error('Upload was cancelled by user.');
    throw err;
  } finally {
    if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
  }
}
