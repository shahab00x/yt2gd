# Tasks — Pre-upload Transcoding & Thumbnail Attachment

> Each task lists the file(s) to touch and a verification step. This builds on the completed
> `docs/sdd/bastyon-integration/` work; all referenced modules already exist.

## Phase 1: Normalization module

- [ ] Task 1.1: Create `server/services/bastyon/transcode.js` — `isFfprobeAvailable()`, `probeVideo()`, `needsTranscode()`, `transcodeVideo()`
  - **File Path**: `server/services/bastyon/transcode.js`
  - **Verification Step**: `probeVideo` on a known-good file returns width/height/fps/bitrates/codecs; `needsTranscode` returns false for a ≤720p H.264+AAC/MP3 file and true for a VP9/Opus file or a >2600 kbps file; `transcodeVideo` produces a playable `.mp4` with `ffprobe` reporting `h264`/`mp3` and the expected caps.

- [ ] Task 1.2: Add `transcode.test.js` unit tests for `needsTranscode` and the target-value math
  - **File Path**: `server/services/bastyon/transcode.test.js`
  - **Verification Step**: `node --test server/services/bastyon/transcode.test.js` passes; edge cases covered (no audio, missing bitrate, codec-only trigger, at-cap values).

## Phase 2: Thumbnail + title on the upload

- [ ] Task 2.1: Extend `uploadToPeertube`/`uploadVideo` to accept `{ thumbnailPath, title }` and attach `thumbnailfile` + `previewfile` on the simple upload path; set `name` from the title
  - **File Path**: `server/services/bastyon/media.js`
  - **Verification Step**: A small-file upload attaches both image fields (verify with a mocked axios capture of the multipart body) and uses the draft title as `name`.

- [ ] Task 2.2: Switch the resumable-upload init request from `URLSearchParams` to `form-data` and attach the same image fields, preserving the `X-Upload-Content-Length` / `X-Upload-Content-Type` headers and the existing upload_id/offset-resync flow
  - **File Path**: `server/services/bastyon/media.js`
  - **Verification Step**: Mocked init request is multipart with `filename`/`name`/`channelId`/`privacy`/`thumbnailfile`/`previewfile`; chunk PUTs and GET-range resync still behave as before.

## Phase 3: Publish orchestration

- [ ] Task 3.1: Reorder the publish flow — fetch the thumbnail **before** upload and reuse the same local file for both the video cover and the post image
  - **File Path**: `server/routes/bastyon.js`
  - **Verification Step**: With a valid `thumbnailUrl`, the thumbnail is fetched once, attached to the upload, and passed to `uploadImage`; with a bad URL, publish continues without a cover.

- [ ] Task 3.2: Insert the transcode step between trim and upload when `draft.transcode` is true and `needsTranscode(probe)` is true; thread the AbortSignal and SSE `transcode` progress
  - **File Path**: `server/routes/bastyon.js`
  - **Verification Step**: A VP9/AV1 source is transcoded before upload; an already-compliant source is skipped; cancel during transcode kills ffmpeg and removes the partial file; transcode failure leaves the draft editable with the file retained.

- [ ] Task 3.3: Update cleanup to include the transcode temp file, and ensure the original downloaded file is still removed on success
  - **File Path**: `server/routes/bastyon.js`
  - **Verification Step**: After a successful publish, staging contains no leftover transcode/trim/thumb temp files and the original is gone; after a failed transcode the original remains.

- [ ] Task 3.4: Add the `transcode` field to `PUT /api/bastyon/drafts/:id` and default it to `true` on draft creation
  - **File Path**: `server/routes/bastyon.js`, `server/services/bastyon/drafts.js`
  - **Verification Step**: New drafts carry `"transcode": true`; toggling it via the API persists and is returned by `GET /api/bastyon/drafts/:id`.

## Phase 4: Client

- [ ] Task 4.1: Add a "Normalize video before upload" checkbox to the draft editor (default checked) and persist it through the existing draft-update wrapper
  - **File Path**: `client/src/views/bastyon.js`, `client/src/api.js`
  - **Verification Step**: The checkbox reflects the draft's `transcode` value, saves on edit, and the server round-trips the value.

- [ ] Task 4.2: Render the `transcode` SSE phase (percent) and the thumbnail-fetch status in the publish progress area
  - **File Path**: `client/src/views/bastyon.js`
  - **Verification Step**: During a publish, the progress UI shows "Normalizing… x%" and a brief "Attaching thumbnail…" status.

## Phase 5: Verification & hardening

- [ ] Task 5.1: Run the existing Bastyon unit tests and add coverage for the new module; build the client
  - **Verification Step**: `node --test server/services/bastyon/bastyon.test.js` and `node --test server/services/bastyon/transcode.test.js` pass; `npm run build:client` succeeds.

- [ ] Task 5.2: End-to-end manual publish on the 2 vCPU server
  - **Verification Step**: Publish a YouTube download (default settings) → video is normalized to H.264/MP3 ≤720p with the YouTube thumbnail as the PeerTube cover; a second publish with the toggle off uploads the file unmodified; a VP9 source with the toggle off still succeeds (PeerTube re-encodes server-side).

- [ ] Task 5.3: Confirm no regression in trim-only and no-trim paths
  - **Verification Step**: A draft with trim and transcode both set trims first then normalizes; a draft with neither uploads as-is (aside from the new title/thumbnail fields).

## Verification Log

_(to be filled in after implementation — see `docs/sdd/bastyon-integration/tasks.md` for the log format)_
