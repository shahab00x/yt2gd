/**
 * Bastyon Auto-Upload watcher store — persisted in data/bastyon-watchers.json.
 *
 * A watcher tracks EITHER a YouTube channel (new posted videos + finished
 * livestream VODs, never live/upcoming) OR a public YouTube playlist (newly
 * added videos) and uploads discoveries to a Bastyon account automatically.
 *
 * Dedup: `seenVideoIds` persists every evaluated video id, so a video is
 * never uploaded twice (playlists that only grow are safe).
 * Rate limit: `uploadLog` timestamps enforce a per-watcher rolling 24h cap.
 * First check after creation only SEEDS `seenVideoIds` (existing videos are
 * skipped — only future uploads are picked up).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AUDIO_LANGUAGES } from '../downloader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../../../data');
const WATCHERS_PATH = join(DATA_DIR, 'bastyon-watchers.json');

export const WATCHER_DEFAULTS = {
  format: 'video',
  quality: 'best',
  audioLanguage: 'original',
  checkIntervalMinutes: 15,
  dailyLimit: 5,
  enabled: true,
};

export const WATCHER_LIMITS = {
  intervalMin: 5, // minutes
  intervalMax: 1440, // 24h
  dailyMin: 1,
  dailyMax: 50,
  nameMax: 120,
};

export const FORMATS = ['video', 'audio'];
export const QUALITIES = ['best', '1080', '720', '480', '360', 'worst'];
export const WATCHER_TYPES = ['channel', 'playlist'];

/** Stable per-tab video listings (a bare channel URL reads the unstable home tab). */
export const CHANNEL_VIDEO_TABS = ['videos', 'shorts', 'streams', 'live'];

/** Thin-poll guard: abort checks returning less than this ratio of the historical max (with a floor). */
export const POLL_GUARD = { minHistory: 20, minRatio: 0.5 };

const MAX_SEEN_IDS = 2000;
const MAX_LOG_ENTRIES = 200;
const MAX_RECENT_ERRORS = 20;
/** Platform post tag limit — applies to default tags and the merged total. */
export const MAX_TAGS = 15;
export const MAX_TAG_LENGTH = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export class WatcherValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WatcherValidationError';
    this.statusCode = 400;
  }
}

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadWatchers() {
  ensureDataDir();
  if (!existsSync(WATCHERS_PATH)) return { watchers: [] };
  try {
    const parsed = JSON.parse(readFileSync(WATCHERS_PATH, 'utf-8'));
    if (!parsed || !Array.isArray(parsed.watchers)) return { watchers: [] };
    return parsed;
  } catch (e) {
    console.error('Failed to parse bastyon-watchers.json', e.message);
    return { watchers: [] };
  }
}

function saveWatchers(data) {
  ensureDataDir();
  writeFileSync(WATCHERS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function isYouTubeHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be';
}

/**
 * Normalize a channel source URL to a stable listing tab. A bare channel URL
 * (`/@handle`, `/channel/…`, `/c/…`, `/user/…`) makes yt-dlp read the
 * channel HOME tab — a rotating mix of latest/popular/featured rails whose
 * video set changes over time and surfaces old videos as "new". Appending
 * `/videos` gives a stable reverse-chronological listing. Explicit
 * `/videos|/shorts|/streams|/live` tabs are left untouched; non-channel
 * types and unrecognized shapes pass through unchanged.
 */
export function normalizeSourceUrl(type, sourceUrl) {
  const url = String(sourceUrl || '').trim();
  if (type !== 'channel' || !url) return url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const segs = parsed.pathname.split('/').filter(Boolean);
  if (!segs.length) return url;
  const last = segs[segs.length - 1].toLowerCase();
  if (CHANNEL_VIDEO_TABS.includes(last)) return url;
  const first = segs[0].toLowerCase();
  // Channel roots only: /@handle (any depth without a listing tab),
  // /channel|/c|/user + id. Everything else (watch pages, feeds, search,
  // playlists) passes through for yt-dlp to resolve or reject loudly.
  const isChannelRoot =
    first.startsWith('@') || (['channel', 'c', 'user'].includes(first) && segs.length >= 2);
  if (!isChannelRoot) return url;
  parsed.pathname = `/${segs.join('/')}/videos`;
  return parsed.toString();
}

/**
 * Validate + normalize watcher input. `partial=true` allows a subset of
 * fields (PUT). Throws WatcherValidationError. Returns the normalized patch.
 */
export function validateWatcherInput(data, { partial = false } = {}) {
  const input = data && typeof data === 'object' ? data : {};
  const out = {};
  const need = (field) => !partial || input[field] !== undefined;

  if (need('type')) {
    const type = String(input.type || '').trim().toLowerCase();
    if (!WATCHER_TYPES.includes(type)) {
      throw new WatcherValidationError(`Type must be one of: ${WATCHER_TYPES.join(', ')}.`);
    }
    out.type = type;
  }

  if (need('name')) {
    const name = String(input.name || '').trim();
    if (!name) throw new WatcherValidationError('Watcher name is required.');
    if (name.length > WATCHER_LIMITS.nameMax) {
      throw new WatcherValidationError(`Watcher name must be ≤ ${WATCHER_LIMITS.nameMax} characters.`);
    }
    out.name = name;
  }

  if (need('sourceUrl')) {
    const sourceUrl = String(input.sourceUrl || '').trim();
    if (!sourceUrl) throw new WatcherValidationError('Source URL is required.');
    let parsed;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      throw new WatcherValidationError('Source URL is not a valid URL.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || !isYouTubeHost(parsed.hostname)) {
      throw new WatcherValidationError('Source URL must be a YouTube channel or playlist URL.');
    }
    const type = input.type !== undefined ? out.type : undefined;
    const hasList = !!parsed.searchParams.get('list');
    const isPlaylistPath = parsed.pathname.includes('/playlist');
    if (type === 'playlist' && !hasList && !isPlaylistPath) {
      throw new WatcherValidationError('Playlist watchers need a playlist URL (containing "list=" or "/playlist").');
    }
    if (type === 'channel' && parsed.pathname.startsWith('/playlist')) {
      throw new WatcherValidationError('Channel watchers need a channel URL (@handle, /channel/…, /c/…, /user/…), not a /playlist URL.');
    }
    out.sourceUrl = normalizeSourceUrl(type, sourceUrl);
  }

  if (need('accountId')) {
    const accountId = String(input.accountId || '').trim();
    if (!accountId) throw new WatcherValidationError('A Bastyon account is required.');
    out.accountId = accountId;
  }

  if (input.format !== undefined) {
    if (!FORMATS.includes(input.format)) {
      throw new WatcherValidationError(`Format must be one of: ${FORMATS.join(', ')}.`);
    }
    out.format = input.format;
  }

  if (input.quality !== undefined) {
    if (!QUALITIES.includes(String(input.quality))) {
      throw new WatcherValidationError(`Quality must be one of: ${QUALITIES.join(', ')}.`);
    }
    out.quality = String(input.quality);
  }

  if (input.audioLanguage !== undefined) {
    if (!AUDIO_LANGUAGES[String(input.audioLanguage)]) {
      throw new WatcherValidationError(`Unknown audio track: ${input.audioLanguage}.`);
    }
    out.audioLanguage = String(input.audioLanguage);
  }

  if (input.checkIntervalMinutes !== undefined) {
    const n = Number(input.checkIntervalMinutes);
    if (!Number.isInteger(n) || n < WATCHER_LIMITS.intervalMin || n > WATCHER_LIMITS.intervalMax) {
      throw new WatcherValidationError(
        `Check interval must be an integer between ${WATCHER_LIMITS.intervalMin} and ${WATCHER_LIMITS.intervalMax} minutes.`,
      );
    }
    out.checkIntervalMinutes = n;
  }

  if (input.dailyLimit !== undefined) {
    const n = Number(input.dailyLimit);
    if (!Number.isInteger(n) || n < WATCHER_LIMITS.dailyMin || n > WATCHER_LIMITS.dailyMax) {
      throw new WatcherValidationError(
        `Daily limit must be an integer between ${WATCHER_LIMITS.dailyMin} and ${WATCHER_LIMITS.dailyMax}.`,
      );
    }
    out.dailyLimit = n;
  }

  if (input.enabled !== undefined) out.enabled = Boolean(input.enabled);

  if (input.defaultTags !== undefined) out.defaultTags = normalizeTags(input.defaultTags);

  return out;
}

/**
 * Normalize a tags input (array or comma-separated string, mirroring the
 * drafts PUT convention) into a clean string array. Throws
 * WatcherValidationError on non-string entries, over-long tags, or more
 * than MAX_TAGS entries.
 */
export function normalizeTags(input) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(',');
  const tags = [];
  for (const t of raw) {
    if (typeof t !== 'string') {
      throw new WatcherValidationError('Tags must be strings (or a comma-separated string).');
    }
    const clean = t.trim();
    if (!clean) continue;
    if (clean.length > MAX_TAG_LENGTH) {
      throw new WatcherValidationError(`Tag "${clean.slice(0, 30)}…" exceeds ${MAX_TAG_LENGTH} characters.`);
    }
    tags.push(clean);
  }
  if (tags.length > MAX_TAGS) {
    throw new WatcherValidationError(`At most ${MAX_TAGS} default tags are allowed (platform post limit).`);
  }
  return tags;
}

/** Public summary for list views (omits the potentially large seenVideoIds). */
export function toSummary(w) {
  return {
    id: w.id,
    type: w.type,
    name: w.name,
    sourceUrl: w.sourceUrl,
    accountId: w.accountId,
    accountName: w.accountName || '',
    format: w.format,
    quality: w.quality,
    audioLanguage: w.audioLanguage,
    checkIntervalMinutes: w.checkIntervalMinutes,
    dailyLimit: w.dailyLimit,
    enabled: w.enabled,
    defaultTags: w.defaultTags || [],
    seeded: w.seeded,
    seenCount: (w.seenVideoIds || []).length,
    uploadsToday: uploadsInLast24h(w),
    lastEntryCount: w.lastEntryCount || 0,
    maxEntriesSeen: w.maxEntriesSeen || 0,
    recentErrors: w.recentErrors || [],
    lastCheckAt: w.lastCheckAt || 0,
    lastStatus: w.lastStatus || 'never',
    lastError: w.lastError || '',
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

/** Full list (summaries) or raw records. */
export function listWatchers({ summaries = true } = {}) {
  const { watchers } = loadWatchers();
  return summaries ? watchers.map(toSummary) : watchers;
}

export function getWatcher(id) {
  return loadWatchers().watchers.find((w) => w.id === id) || null;
}

export function createWatcher(data) {
  const clean = validateWatcherInput(data, { partial: false });
  const store = loadWatchers();
  const now = Date.now();
  const watcher = {
    id: `watch_${now}_${randomUUID().slice(0, 8)}`,
    type: clean.type,
    name: clean.name,
    sourceUrl: clean.sourceUrl,
    accountId: clean.accountId,
    accountName: data.accountName || '',
    format: clean.format || WATCHER_DEFAULTS.format,
    quality: clean.quality || WATCHER_DEFAULTS.quality,
    audioLanguage: clean.audioLanguage || WATCHER_DEFAULTS.audioLanguage,
    checkIntervalMinutes: clean.checkIntervalMinutes ?? WATCHER_DEFAULTS.checkIntervalMinutes,
    dailyLimit: clean.dailyLimit ?? WATCHER_DEFAULTS.dailyLimit,
    enabled: clean.enabled ?? WATCHER_DEFAULTS.enabled,
    defaultTags: clean.defaultTags || [],
    seeded: false,
    seenVideoIds: [],
    uploadLog: [],
    recentErrors: [],
    lastEntryCount: 0,
    maxEntriesSeen: 0,
    lastCheckAt: 0,
    lastStatus: 'never',
    lastError: '',
    createdAt: now,
    updatedAt: now,
  };
  store.watchers.unshift(watcher);
  saveWatchers(store);
  return watcher;
}

export function updateWatcher(id, patch) {
  const clean = validateWatcherInput(patch, { partial: true });
  const store = loadWatchers();
  const watcher = store.watchers.find((w) => w.id === id);
  if (!watcher) return null;
  if (clean.accountId !== undefined && patch.accountName !== undefined) {
    watcher.accountName = String(patch.accountName || '');
  }
  Object.assign(watcher, clean, { updatedAt: Date.now() });
  saveWatchers(store);
  return watcher;
}

/** Update only the denormalized account name (used when accounts change). */
export function setWatcherAccountName(id, accountName) {
  const store = loadWatchers();
  const watcher = store.watchers.find((w) => w.id === id);
  if (!watcher) return null;
  watcher.accountName = String(accountName || '');
  watcher.updatedAt = Date.now();
  saveWatchers(store);
  return watcher;
}

export function deleteWatcher(id) {
  const store = loadWatchers();
  const before = store.watchers.length;
  store.watchers = store.watchers.filter((w) => w.id !== id);
  if (store.watchers.length !== before) {
    saveWatchers(store);
    return true;
  }
  return false;
}

/** Number of successful uploads in the trailing 24h window. */
export function uploadsInLast24h(watcher) {
  const cutoff = Date.now() - DAY_MS;
  return (watcher.uploadLog || []).filter((e) => e && e.at > cutoff).length;
}

export function remainingQuota(watcher) {
  return Math.max(0, (watcher.dailyLimit || 0) - uploadsInLast24h(watcher));
}

/** Whether a scheduled tick should run this watcher now. */
export function isDue(watcher, now = Date.now()) {
  if (!watcher.enabled) return false;
  const intervalMs = (watcher.checkIntervalMinutes || WATCHER_DEFAULTS.checkIntervalMinutes) * 60 * 1000;
  return now - (watcher.lastCheckAt || 0) >= intervalMs;
}

/** Record a check outcome (always bumps lastCheckAt). */
export function recordCheck(id, status, error = '') {
  const store = loadWatchers();
  const watcher = store.watchers.find((w) => w.id === id);
  if (!watcher) return null;
  watcher.lastCheckAt = Date.now();
  watcher.lastStatus = status;
  watcher.lastError = String(error || '');
  watcher.updatedAt = Date.now();
  saveWatchers(store);
  return watcher;
}

/**
 * Record a successful poll's entry count and track the historical maximum.
 * Deliberately kept across history resets (it describes the source, not the
 * seen state) so a post-reset partial poll can't poison a fresh seed.
 */
export function updatePollStats(id, entryCount) {
  const store = loadWatchers();
  const watcher = store.watchers.find((w) => w.id === id);
  if (!watcher) return null;
  const n = Number(entryCount) || 0;
  watcher.lastEntryCount = n;
  watcher.maxEntriesSeen = Math.max(watcher.maxEntriesSeen || 0, n);
  watcher.updatedAt = Date.now();
  saveWatchers(store);
  return watcher;
}

/**
 * True when a poll returned suspiciously few entries vs. history — a sign of
 * a throttled/truncated tab extraction. Guards small sources with a floor:
 * only applies once the historical max reaches POLL_GUARD.minHistory.
 */
export function isSuspiciouslySmall(watcher, entryCount) {
  const max = watcher?.maxEntriesSeen || 0;
  return max >= POLL_GUARD.minHistory && (Number(entryCount) || 0) < max * POLL_GUARD.minRatio;
}

/** First-run seeding: remember current ids WITHOUT uploading. */
export function markSeeded(id, videoIds) {
  const store = loadWatchers();
  const watcher = store.watchers.find((w) => w.id === id);
  if (!watcher) return null;
  watcher.seenVideoIds = uniqueCapped([...(watcher.seenVideoIds || []), ...videoIds]);
  watcher.seeded = true;
  watcher.updatedAt = Date.now();
  saveWatchers(store);
  return watcher;
}

/** Remember evaluated video ids (success or permanent failure — never retry silently). */
export function markSeen(id, videoIds) {
  const store = loadWatchers();
  const watcher = store.watchers.find((w) => w.id === id);
  if (!watcher) return null;
  watcher.seenVideoIds = uniqueCapped([...(watcher.seenVideoIds || []), ...videoIds]);
  watcher.updatedAt = Date.now();
  saveWatchers(store);
  return watcher;
}

/** Log a successful auto-upload (drives the rolling 24h cap). */
export function logUpload(id, { videoId, draftId = '', txid = '', title = '', warning = '' }) {
  const store = loadWatchers();
  const watcher = store.watchers.find((w) => w.id === id);
  if (!watcher) return null;
  watcher.uploadLog = [...(watcher.uploadLog || []), { videoId, draftId, txid, title, warning: String(warning || ''), at: Date.now() }].slice(-MAX_LOG_ENTRIES);
  watcher.updatedAt = Date.now();
  saveWatchers(store);
  return watcher;
}

/** Keep the last N failures visible for the UI (surfaced next to the watcher). */
export function recordFailure(id, { videoId = '', error = '' }) {
  const store = loadWatchers();
  const watcher = store.watchers.find((w) => w.id === id);
  if (!watcher) return null;
  watcher.recentErrors = [{ videoId, error: String(error || ''), at: Date.now() }, ...(watcher.recentErrors || [])].slice(0, MAX_RECENT_ERRORS);
  watcher.updatedAt = Date.now();
  saveWatchers(store);
  return watcher;
}

/** Recent upload history for the detail view (newest first). */
export function getUploadLog(id, limit = 50) {
  const watcher = getWatcher(id);
  if (!watcher) return null;
  return [...(watcher.uploadLog || [])].reverse().slice(0, limit);
}

/**
 * Reset a watcher's history (seen ids, seed flag, upload log, recent
 * errors) while KEEPING its configuration. The next check reseeds from the
 * current source state without uploading, then monitoring resumes. Use when
 * videos may have been missed (e.g. long vault-locked/server-down periods).
 */
export function resetHistory(id) {
  const store = loadWatchers();
  const watcher = store.watchers.find((w) => w.id === id);
  if (!watcher) return null;
  watcher.seenVideoIds = [];
  watcher.seeded = false;
  watcher.uploadLog = [];
  watcher.recentErrors = [];
  watcher.lastStatus = 'never';
  watcher.lastError = '';
  watcher.lastCheckAt = 0;
  watcher.updatedAt = Date.now();
  saveWatchers(store);
  return watcher;
}

function uniqueCapped(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(-MAX_SEEN_IDS);
}
