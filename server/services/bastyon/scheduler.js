/**
 * Bastyon Auto-Upload scheduler — periodically checks watchers for new
 * YouTube videos and auto-publishes them to Bastyon.
 *
 * Guarantees:
 * - Serial execution: watchers run one at a time; a watcher never runs twice
 *   concurrently (per-watcher in-flight guard + global tick guard).
 * - Stable sources: bare channel URLs self-heal to the /videos tab (the home
 *   tab's rotating rails would otherwise surface old videos as "new").
 * - No duplicates: every evaluated video id is remembered in `seenVideoIds`;
 *   successes are additionally logged with txid.
 * - Unstable polls are refused: listings far smaller than history abort the
 *   check instead of driving uploads or marks.
 * - Creation-date rule: candidates published before watcher creation are
 *   skipped (and marked seen) via a per-video upload_date lookup.
 * - Per-watcher rolling 24h cap (`dailyLimit`, default 5).
 * - Oldest-first ordering within a check (by YouTube publish timestamp).
 * - Vault-lock aware: checks are skipped (never crash) while the vault is
 *   locked. Download-phase failures (e.g. a stream that is still live) are
 *   retried on later checks so finished VODs still upload; post-download
 *   failures stay visible as `failed` drafts + watcher recentErrors.
 * - First check after watcher creation only SEEDS known ids (existing videos
 *   are skipped; only future videos upload).
 */

import { existsSync, statSync } from 'node:fs';
import { loadSettings } from '../settings.js';
import { filterCookies, downloadWithMetadata } from '../downloader.js';
import * as vault from './vault.js';
import * as accounts from './accounts.js';
import * as drafts from './drafts.js';
import * as watchers from './watchers.js';
import { MAX_TAGS } from './watchers.js';
import { fetchSourceListing, fetchUploadDate, diffNewEntries, sortOldestFirst } from './monitor.js';
import { publishDraftById } from './publisher.js';

const TICK_MS = 60 * 1000;

let ticker = null;
let tickRunning = false;
const activeRuns = new Set();

function resolveCookiesPath() {
  const settings = loadSettings();
  let cookiesPath = settings.cookiesPath && existsSync(settings.cookiesPath) ? settings.cookiesPath : null;
  if (cookiesPath) cookiesPath = filterCookies(cookiesPath);
  return cookiesPath;
}

/**
 * Merge watcher default tags with a video's own tags: defaults FIRST, then
 * video tags, deduped case-insensitively (first spelling wins), total capped
 * at MAX_TAGS (platform post limit — excess video tags are dropped).
 */
export function mergeTags(defaultTags, videoTags) {
  const out = [];
  const seen = new Set();
  for (const t of [...(defaultTags || []), ...(videoTags || [])]) {
    if (typeof t !== 'string') continue;
    const clean = t.trim();
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Local YYYYMMDD for a timestamp (used for the creation-date cutoff). */
function yyyymmdd(ts) {
  const d = new Date(ts || Date.now());
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}${m}${day}`;
}

/** Append a "link to the original" footer (idempotent). */
export function appendOriginalLink(description, originalUrl) {  const desc = String(description || '');
  const url = String(originalUrl || '');
  if (!url) return desc;
  if (desc.includes(url)) return desc;
  const footer = `🔗 Original: ${url}`;
  return desc ? `${desc}\n\n${footer}` : footer;
}

/** Start the 60s scheduler tick (idempotent; runs one immediate tick). */
export function startWatcherScheduler({ intervalMs = TICK_MS } = {}) {
  if (ticker) return ticker;
  console.log(`[Bastyon Auto] Scheduler started (tick every ${Math.round(intervalMs / 1000)}s).`);

  const tick = async () => {
    if (tickRunning) return;
    tickRunning = true;
    try {
      const due = watchers.listWatchers({ summaries: false }).filter((w) => watchers.isDue(w));
      for (const w of due) {
        try {
          await runWatcherCheck(w.id, { reason: 'schedule' });
        } catch (e) {
          console.error(`[Bastyon Auto] Scheduled check failed for watcher ${w.id}:`, e.message);
        }
      }
    } catch (e) {
      console.error('[Bastyon Auto] Scheduler tick failed:', e.message);
    } finally {
      tickRunning = false;
    }
  };

  tick();
  ticker = setInterval(tick, intervalMs);
  return ticker;
}

/** Stop the scheduler (used by tests). */
export function stopWatcherScheduler() {
  if (ticker) clearInterval(ticker);
  ticker = null;
  tickRunning = false;
  activeRuns.clear();
}

/**
 * Run a single watcher check: normalize source → poll → stability guard →
 * seed-or-diff → publish-date cutoff → download + publish new videos
 * (oldest-first, within the daily quota).
 *
 * The pipeline steps are injectable for tests:
 * `{ fetchListing, fetchDate, downloadVideo, publishVideo }` default to the
 * real implementations (monitor.fetchSourceListing, monitor.fetchUploadDate,
 * downloadWithMetadata, publishDraftById).
 */
export async function runWatcherCheck(watcherId, {
  reason = 'manual',
  fetchListing = fetchSourceListing,
  fetchDate = fetchUploadDate,
  downloadVideo = downloadWithMetadata,
  publishVideo = publishDraftById,
} = {}) {
  if (activeRuns.has(watcherId)) {
    const err = new Error('A check for this watcher is already running. Try again in a moment.');
    err.statusCode = 409;
    throw err;
  }

  let watcher = watchers.getWatcher(watcherId);
  if (!watcher) {
    const err = new Error('Watcher not found.');
    err.statusCode = 404;
    throw err;
  }
  if (!watcher.enabled && reason === 'schedule') return { skipped: true, reason: 'disabled' };

  activeRuns.add(watcherId);
  const abortController = new AbortController();
  try {
    // 0. Vault must be unlocked (keys are RAM-only by design).
    if (!vault.isUnlocked()) {
      watchers.recordCheck(watcherId, 'skipped_locked', 'Vault is locked. Unlock it in Bastyon Uploader to resume auto-uploads.');
      console.log(`[Bastyon Auto] Watcher "${watcher.name}" skipped — vault locked.`);
      return { skipped: true, reason: 'vault_locked' };
    }

    const account = accounts.getAccountById(watcher.accountId);
    if (!account) {
      const msg = 'Assigned Bastyon account no longer exists. Edit the watcher to pick another account.';
      watchers.recordCheck(watcherId, 'error', msg);
      return { checked: 0, new: 0, uploaded: [], failed: [{ error: msg }], skippedOverLimit: 0 };
    }

    // 1. Self-heal bare channel URLs to the stable /videos tab (a bare
    //    @handle reads the rotating home tab whose video set changes over
    //    time and surfaces old videos as "new"). Persisted once changed.
    const normalizedUrl = watchers.normalizeSourceUrl(watcher.type, watcher.sourceUrl);
    if (normalizedUrl && normalizedUrl !== watcher.sourceUrl) {
      watchers.updateWatcher(watcherId, { sourceUrl: normalizedUrl });
      watcher = watchers.getWatcher(watcherId);
      if (!watcher) throw Object.assign(new Error('Watcher was deleted during the check.'), { statusCode: 404 });
      console.log(`[Bastyon Auto] Normalized source URL for "${watcher.name}" → ${normalizedUrl}`);
    }

    // 2. Poll the source (metadata only).
    let entries;
    let filteredLiveIds = [];
    try {
      const listing = await fetchListing(watcher.sourceUrl, { abortSignal: abortController.signal });
      entries = listing.entries;
      filteredLiveIds = listing.filteredLiveIds || [];
    } catch (e) {
      watchers.recordCheck(watcherId, 'error', e.message);
      return { checked: 0, new: 0, uploaded: [], failed: [{ error: e.message }], skippedOverLimit: 0, dateSkipped: 0 };
    }
    watchers.updatePollStats(watcherId, entries.length);

    // 3. Stability guard: a throttled/truncated tab extraction that exits 0
    //    must never drive uploads or marks — abort loudly instead.
    watcher = watchers.getWatcher(watcherId);
    if (!watcher) throw Object.assign(new Error('Watcher was deleted during the check.'), { statusCode: 404 });
    if (watchers.isSuspiciouslySmall(watcher, entries.length)) {
      const msg = `Suspiciously small listing (${entries.length} videos vs usual ~${watcher.maxEntriesSeen}) — possible throttled/truncated poll. Skipping check; nothing uploaded or marked.`;
      watchers.recordCheck(watcherId, 'error', msg);
      console.warn(`[Bastyon Auto] Watcher "${watcher.name}": ${msg}`);
      return { checked: entries.length, new: 0, uploaded: [], failed: [], skippedOverLimit: 0, dateSkipped: 0, abortedUnstable: true };
    }

    // 4. First run seeds known ids without uploading — including ids that
    //    were live/upcoming at creation (they'd otherwise re-upload later).
    watcher = watchers.getWatcher(watcherId);
    if (!watcher) throw Object.assign(new Error('Watcher was deleted during the check.'), { statusCode: 404 });
    if (!watcher.seeded) {
      watchers.markSeeded(watcherId, [...entries.map((e) => e.videoId), ...filteredLiveIds]);
      watchers.recordCheck(watcherId, 'ok', '');
      console.log(`[Bastyon Auto] Watcher "${watcher.name}" seeded with ${entries.length} existing video(s). Future videos will upload.`);
      return { seeded: true, discovered: entries.length, checked: entries.length, new: 0, uploaded: [], failed: [], skippedOverLimit: 0, dateSkipped: 0 };
    }

    // 5. Diff + oldest-first. Timestamped entries sort ascending; flat
    //    channel tabs arrive newest-first WITHOUT timestamps, so reverse
    //    those to honor oldest-first. (Playlist order is curator-defined and
    //    kept as-is — for append-only playlists that is oldest-added first.)
    let fresh = sortOldestFirst(diffNewEntries(entries, new Set(watcher.seenVideoIds || [])));
    if (watcher.type === 'channel' && fresh.length > 1 && fresh.every((e) => !e.timestamp)) {
      fresh = [...fresh].reverse();
    }
    const result = { checked: entries.length, new: fresh.length, uploaded: [], failed: [], skippedOverLimit: 0, dateSkipped: 0 };
    if (!fresh.length) {
      watchers.recordCheck(watcherId, 'ok', '');
      return result;
    }

    // 6. Publish-date cutoff: flat listings can't date entries, so look up
    //    each candidate's upload_date and skip anything published before the
    //    watcher-creation day. Date-skipped videos are marked seen
    //    (evaluated-terminal — they can never qualify, so no retry spam).
    //    Date-lookup failures fail open to today's behavior.
    const cutoffDay = yyyymmdd(watcher.createdAt);
    const eligible = [];
    for (const entry of fresh) {
      let uploadDate = null;
      try {
        uploadDate = await fetchDate(entry.url, { abortSignal: abortController.signal });
      } catch {
        uploadDate = null;
      }
      if (uploadDate && uploadDate < cutoffDay) {
        watchers.markSeen(watcherId, [entry.videoId]);
        result.dateSkipped += 1;
        console.log(`[Bastyon Auto] Skipping "${entry.title}" (${entry.videoId}): published ${uploadDate}, before watcher creation.`);
        continue;
      }
      eligible.push(entry);
    }
    result.new = eligible.length;
    if (!eligible.length) {
      watchers.recordCheck(watcherId, 'ok', result.dateSkipped ? `${result.dateSkipped} old video(s) skipped by creation-date rule.` : '');
      return result;
    }
    fresh = eligible;

    // 7. Process each new video within the rolling 24h quota.
    const cookiesPath = resolveCookiesPath();
    for (const entry of fresh) {
      const current = watchers.getWatcher(watcherId);
      if (!current) break; // deleted mid-run
      if (watchers.uploadsInLast24h(current) >= current.dailyLimit) {
        result.skippedOverLimit = fresh.length - result.uploaded.length - result.failed.length;
        console.log(`[Bastyon Auto] Watcher "${current.name}" hit daily limit (${current.dailyLimit}/24h). ${result.skippedOverLimit} video(s) deferred.`);
        break;
      }

      console.log(`[Bastyon Auto] Watcher "${current.name}" uploading "${entry.title}" (${entry.videoId})…`);
      const draft = drafts.createDraft({
        sourceUrl: entry.url,
        accountId: current.accountId,
        accountName: account.name || current.accountName || '',
        status: 'downloading',
      });

      // Terminal = the video reached a state we must not revisit (downloaded,
      // published, or failed AFTER download). Videos whose download never
      // completes (e.g. a stream that is still live, a transient network
      // error) are NOT marked seen: the empty draft is dropped and a later
      // check retries them — so finished livestream VODs still get uploaded,
      // while successes can never upload twice.
      let terminal = false;
      try {
        const meta = await downloadVideo(entry.url, {
          format: current.format,
          quality: current.quality,
          audioLanguage: current.audioLanguage,
          cookiesPath,
          onProgress: null,
          abortSignal: abortController.signal,
          outputDir: drafts.draftStagingDir(draft.id),
        });

        const fileSize = existsSync(meta.filePath) ? statSync(meta.filePath).size : 0;
        drafts.updateDraft(draft.id, {
          status: 'draft',
          filePath: meta.filePath,
          fileSize,
          title: meta.title,
          description: appendOriginalLink(meta.description, meta.originalUrl),
          tags: mergeTags(current.defaultTags, meta.tags),
          thumbnailUrl: meta.thumbnail,
          sourceUrl: meta.originalUrl,
          error: '',
        });

        const { txid, imageWarning } = await publishVideo(draft.id, { abortSignal: abortController.signal });
        watchers.logUpload(watcherId, { videoId: entry.videoId, draftId: draft.id, txid, title: meta.title, warning: imageWarning || '' });
        result.uploaded.push({ videoId: entry.videoId, title: meta.title, draftId: draft.id, txid, imageWarning: imageWarning || undefined });
        console.log(`[Bastyon Auto] ✅ Published "${meta.title}" (txid ${txid}).${imageWarning ? ` [image warning: ${imageWarning}]` : ''}`);
        terminal = true;
      } catch (e) {
        console.error(`[Bastyon Auto] ❌ Failed "${entry.title}" (${entry.videoId}):`, e.message);
        const cur = drafts.getDraft(draft.id);
        if (cur && cur.status === 'downloading') {
          // Download phase never produced a file — drop the empty draft so
          // the Drafts list is not spammed; a later check retries the video.
          try { drafts.deleteDraft(draft.id); } catch { /* ignore */ }
          console.log(`[Bastyon Auto] ⏳ Will retry "${entry.title}" on a later check.`);
        } else {
          // Download completed but publish failed (file kept in the failed
          // draft for manual retry from Bastyon Uploader → Drafts).
          terminal = true;
        }
        watchers.recordFailure(watcherId, { videoId: entry.videoId, error: e.message });
        result.failed.push({ videoId: entry.videoId, title: entry.title, error: e.message });
      } finally {
        // Never evaluate a terminal video twice; non-terminal ones stay
        // unseen so future checks retry them.
        if (terminal) watchers.markSeen(watcherId, [entry.videoId]);
      }
    }

    const summaryError = result.failed.length
      ? `${result.failed.length} video(s) failed — see recent errors. Failed drafts can be retried from Bastyon Uploader → Drafts.`
      : '';
    watchers.recordCheck(watcherId, result.failed.length && !result.uploaded.length ? 'error' : 'ok', summaryError);
    return result;
  } finally {
    activeRuns.delete(watcherId);
  }
}
