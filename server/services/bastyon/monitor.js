/**
 * Bastyon Auto-Upload source monitor — cheap polling of YouTube channels and
 * playlists via yt-dlp `--flat-playlist --dump-single-json` (metadata only,
 * no media is downloaded during a check).
 *
 * Live filtering: entries explicitly flagged as currently-live or upcoming
 * (`live_status === 'is_live' / 'is_upcoming'`, `is_live === true`) are
 * dropped. Everything else — regular uploads AND finished livestream VODs
 * (`was_live` / `not_live` / unknown) — is kept.
 */

import { existsSync } from 'node:fs';
import { loadSettings } from '../settings.js';
import {
  DEFAULT_UA,
  cleanUrl,
  runYtdlpExec,
  parseJsonEntries,
  filterCookies,
} from '../downloader.js';

/**
 * Fetch the current listing of a channel or playlist URL.
 * Returns { entries, filteredLiveIds }: normalized video entries plus the
 * ids dropped SOLELY by the live/upcoming filter (used to seed them at
 * watcher-creation time so long-scheduled streams don't re-upload later).
 */
export async function fetchSourceListing(sourceUrl, { abortSignal = null } = {}) {
  const clean = cleanUrl(sourceUrl);
  if (!clean) throw new Error('Source URL is empty.');

  const settings = loadSettings();
  let cookiesPath = settings.cookiesPath && existsSync(settings.cookiesPath) ? settings.cookiesPath : null;
  if (cookiesPath) cookiesPath = filterCookies(cookiesPath);

  const options = {
    dumpSingleJson: true,
    flatPlaylist: true,
    skipDownload: true,
    noCheckCertificates: true,
    geoBypass: true,
    socketTimeout: 120,
    userAgent: DEFAULT_UA,
    noWarnings: true,
    ...(cookiesPath && existsSync(cookiesPath) ? { cookies: cookiesPath } : {}),
  };

  let stdoutText;
  try {
    stdoutText = await runYtdlpExec(clean, options, { url: clean, abortSignal, onProgress: null });
  } catch (err) {
    if (abortSignal?.aborted) throw new Error('Source check was cancelled.');
    throw new Error(cleanYtdlpError(err));
  }

  const root = parseSingleJson(stdoutText);
  const rawEntries = root && Array.isArray(root.entries) ? root.entries : [];
  const entries = [];
  const filteredLiveIds = [];
  for (const raw of rawEntries) {
    const normalized = normalizeEntry(raw);
    if (normalized) {
      entries.push(normalized);
    } else if (isLiveFiltered(raw)) {
      const id = typeof raw?.id === 'string' && raw.id ? raw.id : null;
      if (id) filteredLiveIds.push(id);
    }
  }
  return { entries, filteredLiveIds };
}

/** True when a raw entry is dropped ONLY by the live/upcoming filter. */
function isLiveFiltered(e) {
  if (!e || typeof e !== 'object') return false;
  if (typeof e.id !== 'string' || !e.id) return false;
  if (e.is_live === true) return true;
  return e.live_status === 'is_live' || e.live_status === 'is_upcoming';
}

/**
 * Fetch the current entries of a channel or playlist URL.
 * Returns normalized [{ videoId, url, title, liveStatus, timestamp }].
 */
export async function fetchSourceEntries(sourceUrl, { abortSignal = null } = {}) {
  const { entries } = await fetchSourceListing(sourceUrl, { abortSignal });
  return entries;
}

/**
 * Fetch a single video's publish date (YYYYMMDD) via a cheap metadata-only
 * lookup. Returns the date string, or null when unavailable. Used to enforce
 * the "only videos posted after watcher creation upload" rule for candidates
 * that flat listings can't date (timestamps are null in flat mode).
 */
export async function fetchUploadDate(videoUrl, { abortSignal = null } = {}) {
  const clean = cleanUrl(videoUrl);
  if (!clean) return null;

  const settings = loadSettings();
  let cookiesPath = settings.cookiesPath && existsSync(settings.cookiesPath) ? settings.cookiesPath : null;
  if (cookiesPath) cookiesPath = filterCookies(cookiesPath);

  const options = {
    skipDownload: true,
    noPlaylist: true,
    print: 'upload_date',
    noCheckCertificates: true,
    socketTimeout: 60,
    userAgent: DEFAULT_UA,
    noWarnings: true,
    ...(cookiesPath && existsSync(cookiesPath) ? { cookies: cookiesPath } : {}),
  };

  try {
    const stdoutText = await runYtdlpExec(clean, options, { url: clean, abortSignal, onProgress: null });
    const match = String(stdoutText || '').match(/(\d{8})/);
    return match ? match[1] : null;
  } catch {
    return null; // best-effort: callers fail open to today's behavior
  }
}

/** yt-dlp --dump-single-json prints ONE big JSON object (not JSON lines). */
function parseSingleJson(stdoutText) {
  const text = String(stdoutText || '').trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* fall through to line-based parse */ }
  const lines = parseJsonEntries(text);
  if (lines.length === 1) return lines[0];
  if (lines.length > 1) return { entries: lines };
  // Single-video URL (not a channel/playlist): treat the video itself as the entry.
  if (lines.length === 0) return null;
  return null;
}

function normalizeEntry(e) {
  if (!e || typeof e !== 'object') return null;
  // Type guards: only video-ish entries (skip premieres-as-playlists etc.)
  if (e._type && !['video', 'url', 'url_transparent'].includes(e._type)) return null;

  const videoId = typeof e.id === 'string' && e.id ? e.id : null;
  if (!videoId) return null;

  // --- Live filtering: drop currently-live and upcoming only ---
  if (e.is_live === true) return null;
  const liveStatus = typeof e.live_status === 'string' ? e.live_status : null;
  if (liveStatus === 'is_live' || liveStatus === 'is_upcoming') return null;

  let url = `https://www.youtube.com/watch?v=${videoId}`;
  if (typeof e.webpage_url === 'string' && e.webpage_url.startsWith('http')) url = e.webpage_url;
  else if (typeof e.url === 'string' && e.url.startsWith('http')) url = e.url;
  else if (typeof e.original_url === 'string' && e.original_url.startsWith('http')) url = e.original_url;

  const timestamp =
    typeof e.timestamp === 'number' ? e.timestamp
    : typeof e.release_timestamp === 'number' ? e.release_timestamp
    : null;

  return {
    videoId,
    url,
    title: typeof e.title === 'string' && e.title ? e.title : videoId,
    liveStatus,
    timestamp,
  };
}

/** Entries whose videoId is not in the seen set. */
export function diffNewEntries(entries, seenSet) {
  const seen = seenSet instanceof Set ? seenSet : new Set(seenSet || []);
  return (entries || []).filter((e) => e && !seen.has(e.videoId));
}

/** Oldest-first by publish timestamp (unknown timestamps sort first — they are older-or-unknown, retried deterministically). */
export function sortOldestFirst(entries) {
  return [...(entries || [])].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

function cleanYtdlpError(err) {
  const stderr = String(err?.stderr || '');
  if (stderr) {
    const errorLines = stderr.split('\n').filter((l) => l.includes('ERROR:'));
    if (errorLines.length) return errorLines.join(' | ').slice(0, 500);
    return stderr.trim().slice(0, 500);
  }
  return String(err?.message || 'Source check failed.');
}

// Re-exported for unit tests (avoids importing youtube-dl-exec paths elsewhere).
export const __testables = { normalizeEntry, parseSingleJson, isLiveFiltered };
