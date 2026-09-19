/**
 * Bastyon publisher — the single canonical publish pipeline, shared by the
 * manual "Publish to Bastyon" button (server/routes/bastyon.js) and the
 * Bastyon Auto-Upload scheduler (server/services/bastyon/scheduler.js).
 *
 * Flow: resolve account + decrypt WIF → fetch thumbnail → trim (optional) →
 * transcode/normalize (optional) → PeerTube upload → post image → UTXOs →
 * build + sign post transaction → broadcast → cleanup + mark published.
 *
 * Progress is reported through `onEvent(event, data)` with the same
 * `{ draftId, phase, ... }` shapes the SSE stream uses; pass null to silence.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import axios from 'axios';
import { Account } from './crypto.js';
import { buildPayload } from './payload.js';
import { buildAndSignPostTransaction } from './transaction.js';
import { BastyonRpcClient } from './rpc.js';
import { uploadVideo, uploadImage, MediaUploadError } from './media.js';
import { trimVideo, isFfmpegAvailable } from './trim.js';
import { transcodeVideo, probeVideo, needsTranscode, isFfprobeAvailable } from './transcode.js';
import * as vault from './vault.js';
import * as accounts from './accounts.js';
import * as drafts from './drafts.js';

/** Draft ids with a publish currently in flight (prevents double-posts). */
const publishingNow = new Set();

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function notFound(message) {
  const err = new Error(message);
  err.statusCode = 404;
  return err;
}

/**
 * Publish a draft to Bastyon. Resolves with { txid, imageWarning }.
 * State transitions mirror the manual flow: publishing → published, or back
 * to draft (vault locked) / failed (anything else, original file kept).
 */
export async function publishDraftById(draftId, { abortSignal = null, onEvent = null } = {}) {
  const emit = (event, data) => {
    try {
      if (typeof onEvent === 'function') onEvent(event, data);
    } catch { /* progress reporting must never break publishing */ }
  };

  const draft = drafts.getDraft(draftId);
  if (!draft) throw notFound('Draft not found.');
  if (draft.status === 'publishing' || publishingNow.has(draftId)) {
    throw badRequest('This draft is already publishing.');
  }
  if (!draft.filePath || !existsSync(draft.filePath)) {
    throw badRequest('Draft file is missing. Delete this draft and download again.');
  }
  if (!draft.accountId) {
    throw badRequest('Select a Bastyon account for this draft first.');
  }

  publishingNow.add(draftId);
  drafts.updateDraft(draft.id, { status: 'publishing', error: '' });
  const stagingDir = drafts.draftStagingDir(draft.id);

  const cleanupTemp = async (paths) => {
    for (const p of paths) {
      if (!p) continue;
      try {
        if (existsSync(p)) await unlink(p);
      } catch { /* ignore */ }
    }
  };

  let trimmedPath = null;
  let transcodedPath = null;
  let thumbPath = null;

  try {
    // 1. Resolve account + decrypt WIF (requires unlocked vault)
    const accountRecord = accounts.getAccountById(draft.accountId);
    if (!accountRecord) throw badRequest('Account no longer exists. Re-assign this draft to another account.');
    let wif;
    try {
      wif = accounts.decryptAccountWif(accountRecord);
    } catch (e) {
      if (e instanceof vault.VaultLockedError) {
        drafts.updateDraft(draft.id, { status: 'draft' });
        throw e;
      }
      throw e;
    }
    const account = Account.fromWif(wif);

    // 2. Fetch thumbnail (best-effort, non-fatal) BEFORE upload so it can be
    //    attached to the video in the same request.
    const images = [];
    if (draft.thumbnailUrl) {
      try {
        emit('status', { draftId: draft.id, phase: 'thumbnail', message: 'Fetching thumbnail…' });
        thumbPath = join(stagingDir, `thumb_${Date.now()}.jpg`);
        const thumbResp = await axios.get(draft.thumbnailUrl, { responseType: 'arraybuffer', timeout: 20_000 });
        writeFileSync(thumbPath, Buffer.from(thumbResp.data));
      } catch (e) {
        thumbPath = null;
        console.warn('[Bastyon] Thumbnail fetch failed (continuing without it):', e.message);
      }
    }

    // 3. Trim (optional)
    let uploadPath = draft.filePath;
    if (draft.trimStart || draft.trimEnd) {
      if (!isFfmpegAvailable()) {
        throw badRequest('ffmpeg is not installed on this server, so trimming is unavailable. Clear the trim fields to publish as-is.');
      }
      emit('status', { draftId: draft.id, phase: 'trim', message: 'Trimming video…' });
      trimmedPath = await trimVideo(draft.filePath, { start: draft.trimStart || undefined, end: draft.trimEnd || undefined });
      uploadPath = trimmedPath;
    }

    // 4. Transcode / normalize (optional, enabled by default)
    if (draft.transcode !== false) {
      if (!isFfmpegAvailable() || !isFfprobeAvailable()) {
        throw badRequest('ffmpeg/ffprobe is not installed on this server, so normalization is unavailable. Disable "Normalize before upload" to publish as-is.');
      }
      emit('status', { draftId: draft.id, phase: 'transcode', message: 'Checking video…' });
      const probe = await probeVideo(uploadPath);
      if (needsTranscode(probe)) {
        emit('status', { draftId: draft.id, phase: 'transcode', message: 'Normalizing video…' });
        transcodedPath = await transcodeVideo(uploadPath, {
          outputPath: join(stagingDir, `transcode_${Date.now()}.mp4`),
          abortSignal,
          onProgress: (p) => {
            if (p && p.percent != null) emit('progress', { draftId: draft.id, phase: 'transcode', percent: Math.round(p.percent) });
          },
        });
        uploadPath = transcodedPath;
      }
    }

    if (abortSignal?.aborted) throw new Error('Publish was cancelled.');

    // 5. Upload video to PeerTube (attach thumbnail + title)
    emit('status', { draftId: draft.id, phase: 'upload', message: 'Authenticating with PeerTube…' });
    const peertubeUrl = await uploadVideo(uploadPath, account, null, (p) => {
      if (p && p.label) emit('progress', { draftId: draft.id, phase: 'upload', label: p.label });
    }, { thumbnailPath: thumbPath, title: draft.title });
    if (!peertubeUrl || !peertubeUrl.startsWith('peertube://')) {
      throw new MediaUploadError(`Video upload returned invalid URL: ${peertubeUrl}`);
    }

    // 6. Thumbnail as post image (reuse the already-downloaded file).
    //    Warn-only per policy: the video (with cover) already uploaded, so a
    //    post-image failure must not fail the publish — but it is surfaced.
    let imageWarning = '';
    if (thumbPath) {
      try {
        const imageUrl = await uploadImage(thumbPath, { account });
        if (imageUrl) images.push(imageUrl);
      } catch (e) {
        imageWarning = `Thumbnail post-image upload failed (video published without it): ${e.message}`;
        console.warn(`[Bastyon] ${imageWarning}`);
      }
    }

    // 7. UTXOs
    emit('status', { draftId: draft.id, phase: 'broadcast', message: 'Fetching account funds…' });
    const rpc = new BastyonRpcClient();
    const utxos = await rpc.getUtxos(account.address);
    if (!utxos.length) {
      throw new Error(`No confirmed UTXOs found for address ${account.address}. Ensure the account has a small PKOIN balance.`);
    }

    // 8. Payload + transaction
    const payload = buildPayload({
      message: draft.description || draft.title || '',
      caption: draft.title || '',
      tags: draft.tags || [],
      images,
      url: peertubeUrl,
      language: 'en',
    });
    const signedTx = buildAndSignPostTransaction({ account, utxos, payload, txType: 'video' });

    // 9. Broadcast
    emit('status', { draftId: draft.id, phase: 'broadcast', message: 'Broadcasting to the blockchain…' });
    const txid = await rpc.broadcast(signedTx);

    // 10. Success — clean up local files, mark published
    await cleanupTemp([trimmedPath, transcodedPath, thumbPath, draft.filePath]);
    drafts.updateDraft(draft.id, { status: 'published', txid, error: '', fileSize: 0 });

    emit('done', { draftId: draft.id, success: true, txid, imageWarning: imageWarning || undefined });
    return { txid, imageWarning };
  } catch (err) {
    console.error('[Bastyon] Publish failed:', err.message);
    // Keep the original downloaded file for retry; discard intermediate artifacts.
    await cleanupTemp([trimmedPath, transcodedPath, thumbPath]);
    if (err instanceof vault.VaultLockedError) {
      drafts.updateDraft(draft.id, { status: 'draft' });
    } else if (drafts.getDraft(draft.id)?.status === 'publishing') {
      drafts.updateDraft(draft.id, { status: 'failed', error: err.message });
    }
    emit('error', { draftId: draft.id, message: err.message });
    throw err;
  } finally {
    publishingNow.delete(draftId);
  }
}

/** True while a publish for this draft is in flight (any caller). */
export function isPublishing(draftId) {
  return publishingNow.has(draftId);
}
