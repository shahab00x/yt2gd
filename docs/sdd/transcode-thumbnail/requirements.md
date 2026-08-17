# Requirements — Pre-upload Transcoding & Thumbnail Attachment

> All requirements use EARS (Easy Approach to Requirements Syntax).
> Scope: extend the existing Bastyon Uploader (`docs/sdd/bastyon-integration/`) so that
> (1) videos are optionally normalized with ffmpeg before upload to PeerTube, and
> (2) the YouTube thumbnail is attached to the PeerTube video as its cover/preview.
>
> **Environment:** the target server has 2 vCPUs and an SSD, with a system `ffmpeg` (and `ffprobe`)
> already installed. We do **not** download ffmpeg binaries (the Electron desktop client does that);
> we use the system binaries, and we do **not** enforce the desktop client's 4-core/4 GB RAM gate.

---

## 1. Pre-upload Transcoding (Normalization)

### REQ-TRX-1 — Normalization Step in the Publish Pipeline
When the user publishes a draft with normalization enabled, the system **shall** insert a transcode step between trimming and PeerTube upload that produces a normalized MP4 (H.264 video, MP3/AAC audio) capped at 720p height, 2600 kbps video, 256 kbps audio, and 25 fps.

### REQ-TRX-2 — Enabled by Default with a Per-Draft Toggle
When a draft is created, normalization **shall** be enabled by default. When the user edits a draft, the user **shall** be able to toggle normalization on or off, and the choice **shall** be persisted on the draft.

### REQ-TRX-3 — Skip When Already Compliant
When normalization is enabled, the system **shall** probe the input with `ffprobe`. When the source already satisfies every cap — height ≤ 720, width ≤ 1280, video bitrate ≤ 2600 kbps, audio bitrate ≤ 256 kbps (or no audio), fps ≤ 25, H.264 video codec, and AAC/MP3 audio codec when an audio stream is present — the system **shall** skip transcoding and upload the file as-is.

### REQ-TRX-4 — Codec Normalization
When the source uses a non-H.264 video codec (e.g. VP9/AV1) or a non-AAC/MP3 audio codec (e.g. Opus/Vorbis), the system **shall** transcode even when bitrate/resolution/fps are within limits, so the upload is always H.264 + AAC/MP3 in an MP4 container.

### REQ-TRX-5 — Never Upscale
When transcoding, the system **shall** scale with a maximum height of `min(720, source_height)`, so a source below 720p **shall** never be upscaled (matching the Bastyon desktop client's `scale=-2:min'(720,ih)'`).

### REQ-TRX-6 — Bitrate & Framerate Targeting
When transcoding, the system **shall** set the target video bitrate to `min(2600, source_video_bitrate)` kbps, the target audio bitrate to `min(256, source_audio_bitrate)` kbps, and the target frame rate to `min(25, source_fps)`.

### REQ-TRX-7 — Missing Bitrate Fallback
When `ffprobe` does not report a stream-level bitrate, the system **shall** fall back to the container-level bitrate. When both are unavailable, the system **shall** omit the bitrate cap and use constant-rate-factor (CRF) quality control instead of failing.

### REQ-TRX-8 — 2 vCPU / System ffmpeg Adaptation
When transcoding, the system **shall** use the system-installed `ffmpeg` (no binary download) and **shall** not enforce the desktop client's minimum-core/RAM requirements. It **shall** run with automatic thread selection over the available cores and the `veryfast` preset, accepting longer wall-clock time on a 2 vCPU server.

### REQ-TRX-9 — Temp Output & Cleanup
When transcoding, the system **shall** write the output to a temporary file in the draft's staging directory, **shall** leave the original downloaded file untouched, and **shall** delete the temporary file on both success and failure. On publish success the original downloaded file **shall** still be removed as it is today.

### REQ-TRX-10 — Disk Space Guard
Before transcoding, the system **shall** verify free disk space is at least 1.5× the input size and **shall** abort with a clear error when it is not.

### REQ-TRX-11 — Cancellation
When the user cancels a publish during transcoding, the system **shall** terminate the ffmpeg process and **shall** delete the partial output file.

### REQ-TRX-12 — Availability Check
When normalization is enabled and `ffmpeg` or `ffprobe` is not installed, the system **shall** surface a clear error at publish time (and when the toggle is enabled) rather than failing silently.

### REQ-TRX-13 — Transcode Failure Handling
When transcoding fails, the system **shall** fail the publish with a specific error, keep the draft editable, and retain the local file for retry (consistent with the existing publish-failure behavior).

---

## 2. Thumbnail / Cover Attachment

### REQ-THM-1 — Attach Thumbnail to the Video Upload
When a draft has a thumbnail URL and the thumbnail is fetched successfully, the system **shall** attach it to the PeerTube upload as **both** the `thumbnailfile` (cover/poster) and `previewfile` (preview) fields, using the same image file — exactly as the Bastyon desktop client does.

### REQ-THM-2 — Fetch Before Upload
When publishing, the system **shall** fetch the thumbnail **before** uploading the video, so it can be attached in the same upload request rather than in a follow-up call.

### REQ-THM-3 — Both Upload Paths
The system **shall** attach the thumbnail to both the simple upload (≤ 50 MB, `POST /api/v1/videos/upload`) and the resumable upload (> 50 MB, `POST /api/v1/videos/upload-resumable` init request).

### REQ-THM-4 — Resumable Init as Multipart
When attaching a thumbnail to the resumable upload, the system **shall** send the init request as `multipart/form-data` (matching the desktop client) so the file fields can be carried, while preserving the existing `X-Upload-Content-Length` / `X-Upload-Content-Type` headers.

### REQ-THM-5 — Reuse the File as the Post Image
When the thumbnail is attached to the video, the system **shall** reuse the same downloaded thumbnail file as the Pocketnet post image (existing REQ-PUB-2), avoiding a second download.

### REQ-THM-6 — Non-Fatal
When thumbnail fetch or attachment fails, the system **shall** continue publishing without a cover image (non-fatal), consistent with existing REQ-PUB-2.

### REQ-THM-7 — No Client-Side Resize
The system **shall** pass the thumbnail file to PeerTube as-is (PeerTube generates the derived sizes) and **shall** not attempt client-side resizing beyond ensuring a valid image filename/extension.

---

## 3. Video Title on PeerTube

### REQ-TIT-1 — Use the Draft Title
When uploading a video, the system **shall** set the PeerTube video `name` to the draft title (trimmed), rather than the current random `basename-uuid` value.

### REQ-TIT-2 — Fallback Name
When the draft title is empty, the system **shall** fall back to the source title or, failing that, the existing generated name.

---

## 4. Progress Reporting

### REQ-PRG-1 — Transcode Progress via SSE
When transcoding runs, the system **shall** stream a `transcode` phase with a percentage to the client via the existing Bastyon SSE stream.

### REQ-PRG-2 — Thumbnail Status
When fetching and attaching the thumbnail, the system **shall** report a brief status event via SSE.
