/**
 * Video trimming with ffmpeg. Ported from bastyon-poster-linux/src/video_edit.py
 * (trim_video + parse_time_to_seconds). Trim is applied at publish time so the
 * draft's downloaded file is never destructively modified.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

export class TrimError extends Error {}

/**
 * Parse a time string (SS, MM:SS, HH:MM:SS) or number to seconds.
 */
export function parseTimeToSeconds(value) {
  if (typeof value === 'number') return value;
  const str = String(value).trim();
  if (!str) throw new TrimError('Empty time string');

  const parts = str.split(':');
  if (parts.length > 3) throw new TrimError(`Invalid time format: ${str}`);

  let seconds = 0;
  for (const part of parts) {
    const num = parseFloat(part);
    if (Number.isNaN(num)) throw new TrimError(`Invalid time format: ${str}`);
    seconds = seconds * 60 + num;
  }
  return seconds;
}

/**
 * Whether ffmpeg is available on the server.
 */
export function isFfmpegAvailable() {
  return existsSync('/usr/bin/ffmpeg') || existsSync('/usr/local/bin/ffmpeg');
}

/**
 * Trim a video file with ffmpeg.
 * - Fast path: `-ss`/`-to` with `-c copy` (stream copy, no re-encode).
 * - Fallback: full re-encode when the container doesn't support copy cuts.
 * Returns the path to the trimmed file (a temp file in the same directory when
 * outputPath is not given).
 */
export async function trimVideo(inputPath, { outputPath = null, start = null, end = null } = {}) {
  if (!existsSync(inputPath)) throw new TrimError(`Input file not found: ${inputPath}`);

  if (!start && !end) return inputPath;

  if (start != null) parseTimeToSeconds(start);
  if (end != null) parseTimeToSeconds(end);

  const outPath = outputPath || join(dirname(inputPath), `.trim_${randomUUID()}${inputPath.slice(inputPath.lastIndexOf('.')) || '.mp4'}`);

  const buildArgs = (copy) => {
    const args = ['-y'];
    if (start != null) args.push('-ss', String(start));
    if (end != null) args.push('-to', String(end));
    args.push('-i', inputPath);
    if (copy) args.push('-c', 'copy');
    args.push(outPath);
    return args;
  };

  try {
    await execFileAsync('ffmpeg', buildArgs(true), { timeout: 0, maxBuffer: 10 * 1024 * 1024 });
  } catch (err) {
    // Stream-copy failed (e.g. timestamp issues) — fall back to re-encode
    try {
      await execFileAsync('ffmpeg', buildArgs(false), { timeout: 0, maxBuffer: 10 * 1024 * 1024 });
    } catch (reencodeErr) {
      throw new TrimError(`ffmpeg failed: ${ffmpegErrorMessage(reencodeErr)}`);
    }
  }

  return outPath;
}

/** Pull the meaningful lines out of ffmpeg's verbose stderr (skip the version banner). */
function ffmpegErrorMessage(err) {
  const stderr = String(err?.stderr || err?.message || 'ffmpeg error');
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  const meaningful = lines.filter((l) => /error|invalid|failed|no such|not found/i.test(l));
  const pick = meaningful.length ? meaningful : lines.slice(-5);
  return pick.slice(-8).join(' | ').slice(0, 500);
}
