/**
 * Pre-upload video normalization with ffmpeg.
 *
 * Ported from pocketnet.gui/js/electron/transcoding2.js (getVideoProbe +
 * spawnFfmpeg), adapted for a 2 vCPU server with a system ffmpeg/ffprobe:
 *   - no 4-core / 4 GB gate (the desktop client refuses to transcode below that)
 *   - no binary download (the desktop client installs ffmpeg via ffbinaries)
 *   - automatic thread selection (x264 uses all available cores)
 *
 * The scale filter is `scale=-2:min'(720,ih)'` — the single quotes are REQUIRED
 * ffmpeg quoting to protect the comma in the min() expression. It caps the
 * height at 720p but NEVER upscales: a 480p source stays 480p, which is the
 * intended flow for accounts whose PeerTube instances don't serve higher
 * resolutions.
 */

import { spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class TranscodeError extends Error {}

// Normalization caps (mirroring transcoding2.js)
export const TRANSCODE_CAPS = {
  maxHeight: 720,
  maxWidth: 1280,
  maxVideoBitrate: 2600, // kbps
  maxAudioBitrate: 256,  // kbps
  maxFps: 25,
};

export function isFfprobeAvailable() {
  return existsSync('/usr/bin/ffprobe') || existsSync('/usr/local/bin/ffprobe');
}

function toKbps(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n / 1000) : null;
}

/** Parse ffmpeg's `avg_frame_rate` ("30000/1001" or "25/1") into a float. */
function parseFrameRate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const parts = String(v).split('/');
  if (parts.length === 2) {
    const n = parseFloat(parts[0]);
    const d = parseFloat(parts[1]);
    return Number.isFinite(n) && d ? n / d : null;
  }
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Probe a video file with ffprobe and return the normalization-relevant stats.
 */
export function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath,
    ]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => reject(new TranscodeError(`ffprobe failed to start: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new TranscodeError(`ffprobe exited with code ${code}: ${stderr.trim().slice(0, 500)}`));
        return;
      }
      try {
        const meta = JSON.parse(stdout);
        const video = (meta.streams || []).find((s) => s.codec_type === 'video');
        if (!video) throw new TranscodeError('No video stream found');
        const audio = (meta.streams || []).find((s) => s.codec_type === 'audio');
        const videoBitrate = toKbps(video.bit_rate) ?? toKbps(meta.format?.bit_rate);
        resolve({
          width: Number(video.width) || 0,
          height: Number(video.height) || 0,
          frameRate: parseFrameRate(video.avg_frame_rate),
          videoBitrate,
          audioBitrate: audio ? toKbps(audio.bit_rate) : null,
          videoCodec: String(video.codec_name || '').toLowerCase(),
          audioCodec: audio ? String(audio.codec_name || '').toLowerCase() : null,
          durationSec: parseFloat(meta.format?.duration) || null,
        });
      } catch (e) {
        reject(e instanceof TranscodeError ? e : new TranscodeError(`Failed to parse ffprobe output: ${e.message}`));
      }
    });
  });
}

/**
 * Whether the source needs normalization. Includes the codec check, so a
 * VP9/AV1/Opus YouTube download is normalized even when resolution/bitrate/fps
 * are already within caps.
 */
export function needsTranscode(probe) {
  const { maxHeight, maxWidth, maxVideoBitrate, maxAudioBitrate, maxFps } = TRANSCODE_CAPS;
  return (
    probe.videoCodec !== 'h264'
    || (probe.audioCodec && !['aac', 'mp3'].includes(probe.audioCodec))
    || probe.height > maxHeight
    || probe.width > maxWidth
    || (probe.videoBitrate != null && probe.videoBitrate > maxVideoBitrate)
    || (probe.audioBitrate != null && probe.audioBitrate > maxAudioBitrate)
    || (probe.frameRate != null && probe.frameRate > maxFps)
  );
}

/** Compute the ffmpeg targets: never raise a value above the source's own. */
export function transcodeTargets(probe) {
  const { maxVideoBitrate, maxAudioBitrate, maxFps } = TRANSCODE_CAPS;
  return {
    videoBitrate: probe.videoBitrate != null ? Math.min(maxVideoBitrate, probe.videoBitrate) : null,
    audioBitrate: probe.audioBitrate != null ? Math.min(maxAudioBitrate, probe.audioBitrate) : null,
    fps: probe.frameRate != null ? Math.min(maxFps, probe.frameRate) : null,
  };
}

/**
 * Parse a line of ffmpeg's `-progress pipe:1` output into seconds (or null).
 * Handles out_time_us / out_time_ms (both microseconds in ffmpeg) and out_time.
 */
export function parseProgressTime(line) {
  if (typeof line !== 'string') return null;
  if (line.startsWith('out_time_us=')) return parseInt(line.slice(12), 10) / 1e6;
  if (line.startsWith('out_time_ms=')) return parseInt(line.slice(12), 10) / 1e6;
  if (line.startsWith('out_time=')) {
    const t = line.slice(9).trim();
    if (!t || t === 'N/A') return null;
    const parts = t.split(':').map(Number);
    if (parts.some((n) => Number.isNaN(n))) return null;
    return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : null;
  }
  return null;
}

/**
 * Normalize a video with the system ffmpeg. Mirrors transcoding2.js parameters,
 * adapted: automatic threads, no suboptimal-size rejection (size reduction is
 * not the goal), and `-an` when the source has no audio stream.
 *
 * Returns the output path. The output is written to `outputPath` or a temp
 * `.transcode_*.mp4` next to the input.
 */
export async function transcodeVideo(inputPath, { outputPath = null, onProgress = null, abortSignal = null } = {}) {
  if (!existsSync(inputPath)) throw new TranscodeError(`Input file not found: ${inputPath}`);
  if (!isFfprobeAvailable()) throw new TranscodeError('ffprobe is not installed on this server, so normalization is unavailable.');

  const probe = await probeVideo(inputPath);
  const targets = transcodeTargets(probe);
  const outPath = outputPath || join(dirname(inputPath), `.transcode_${randomUUID()}.mp4`);

  const args = [
    '-y', '-v', 'error', '-i', inputPath,
    '-c:v', 'libx264',
  ];
  if (probe.audioCodec) {
    args.push('-c:a', 'libmp3lame');
    if (targets.audioBitrate != null) args.push('-b:a', `${targets.audioBitrate}k`);
  } else {
    args.push('-an');
  }
  args.push('-vf', `scale=-2:min'(${TRANSCODE_CAPS.maxHeight},ih)'`);
  args.push('-qmin', '25', '-qmax', '35');
  args.push('-preset', 'veryfast');
  if (targets.videoBitrate != null) args.push('-b:v', `${targets.videoBitrate}k`);
  if (targets.fps != null) args.push('-r', String(targets.fps));
  args.push('-movflags', '+faststart');
  args.push('-progress', 'pipe:1', '-nostats');
  args.push(outPath);

  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdoutBuffer = '';
    let stderr = '';
    let settled = false;

    const cleanup = () => {
      try { if (existsSync(outPath)) unlinkSync(outPath); } catch { /* ignore */ }
    };
    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
      if (err) {
        cleanup();
        reject(err);
      } else {
        resolve(outPath);
      }
    };
    const onAbort = () => {
      child.kill('SIGKILL');
      finish(new TranscodeError('Transcode cancelled.'));
    };

    if (abortSignal) {
      if (abortSignal.aborted) { reject(new TranscodeError('Transcode cancelled.')); return; }
      abortSignal.addEventListener('abort', onAbort);
    }

    child.stdout.on('data', (d) => {
      stdoutBuffer += d.toString();
      let idx;
      while ((idx = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, idx).trim();
        stdoutBuffer = stdoutBuffer.slice(idx + 1);
        const secs = parseProgressTime(line);
        if (secs != null && onProgress) {
          const duration = probe.durationSec || 0;
          const percent = duration > 0 ? Math.max(0, Math.min(100, (secs / duration) * 100)) : null;
          onProgress({ percent });
        }
      }
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => finish(new TranscodeError(`ffmpeg failed to start: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) {
        if (!existsSync(outPath)) {
          finish(new TranscodeError('ffmpeg finished but no output file was produced.'));
          return;
        }
        if (onProgress) onProgress({ percent: 100 });
        finish(null);
      } else {
        const msg = stderr.trim().split('\n').filter(Boolean).slice(-8).join(' | ').slice(0, 500);
        finish(new TranscodeError(`ffmpeg exited with code ${code}: ${msg}`));
      }
    });
  });
}
