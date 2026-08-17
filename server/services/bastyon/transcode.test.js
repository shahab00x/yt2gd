/**
 * Unit tests for pre-upload video normalization (transcode.js).
 * Run: node --test server/services/bastyon/transcode.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { needsTranscode, transcodeTargets, parseProgressTime, TRANSCODE_CAPS } from './transcode.js';

function probe(overrides = {}) {
  return {
    width: 640,
    height: 360,
    frameRate: 25,
    videoBitrate: 1200,
    audioBitrate: 128,
    videoCodec: 'h264',
    audioCodec: 'aac',
    durationSec: 60,
    ...overrides,
  };
}

// --- needsTranscode ---

test('compliant H.264+AAC source does not need transcoding', () => {
  assert.equal(needsTranscode(probe()), false);
});

test('MP3 audio is accepted as compliant', () => {
  assert.equal(needsTranscode(probe({ audioCodec: 'mp3' })), false);
});

test('VP9 video triggers transcoding even within caps', () => {
  assert.equal(needsTranscode(probe({ videoCodec: 'vp9' })), true);
});

test('Opus audio triggers transcoding', () => {
  assert.equal(needsTranscode(probe({ audioCodec: 'opus' })), true);
});

test('height above 720 triggers transcoding', () => {
  assert.equal(needsTranscode(probe({ width: 1920, height: 1080 })), true);
});

test('video bitrate above 2600 kbps triggers transcoding', () => {
  assert.equal(needsTranscode(probe({ videoBitrate: 4000 })), true);
});

test('audio bitrate above 256 kbps triggers transcoding', () => {
  assert.equal(needsTranscode(probe({ audioBitrate: 320 })), true);
});

test('fps above 25 triggers transcoding', () => {
  assert.equal(needsTranscode(probe({ frameRate: 30 })), true);
});

test('missing audio stream is compliant (video-only)', () => {
  assert.equal(needsTranscode(probe({ audioCodec: null, audioBitrate: null })), false);
});

test('missing bitrate fields do not trigger transcoding on their own', () => {
  assert.equal(needsTranscode(probe({ videoBitrate: null, audioBitrate: null })), false);
});

// --- transcodeTargets ---

test('targets never raise values above the source', () => {
  const t = transcodeTargets(probe({ videoBitrate: 1200, audioBitrate: 128, frameRate: 24 }));
  assert.deepEqual(t, { videoBitrate: 1200, audioBitrate: 128, fps: 24 });
});

test('targets clamp to the caps', () => {
  const t = transcodeTargets(probe({ videoBitrate: 8000, audioBitrate: 320, frameRate: 60 }));
  assert.deepEqual(t, { videoBitrate: 2600, audioBitrate: 256, fps: 25 });
});

test('missing bitrate/fps targets stay null', () => {
  const t = transcodeTargets(probe({ videoBitrate: null, audioBitrate: null, frameRate: null }));
  assert.deepEqual(t, { videoBitrate: null, audioBitrate: null, fps: null });
});

// --- parseProgressTime ---

test('parses out_time_us as microseconds', () => {
  assert.equal(parseProgressTime('out_time_us=1500000'), 1.5);
});

test('parses out_time_ms as microseconds (ffmpeg legacy naming)', () => {
  assert.equal(parseProgressTime('out_time_ms=2000000'), 2);
});

test('parses out_time HH:MM:SS.microseconds', () => {
  assert.equal(parseProgressTime('out_time=00:01:02.500000'), 62.5);
});

test('ignores N/A and unrelated lines', () => {
  assert.equal(parseProgressTime('out_time=N/A'), null);
  assert.equal(parseProgressTime('frame=100'), null);
});

test('caps are the values documented in the SDD', () => {
  assert.deepEqual(TRANSCODE_CAPS, {
    maxHeight: 720,
    maxWidth: 1280,
    maxVideoBitrate: 2600,
    maxAudioBitrate: 256,
    maxFps: 25,
  });
});
