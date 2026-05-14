# Tasks: Torrent Batch Upload Fix

## Phase 1: Research & Diagnosis
- [x] Task 1.1: Analyze `gdrive.js` for stream reuse issues in `withRetry`.
  - **File Path**: `server/services/gdrive.js`
  - **Verification Step**: Logic review (Done).
- [x] Task 1.2: Analyze `downloader.js` for path mapping issues.
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: Logic review (Done).

## Phase 2: Implementation - Google Drive Service
- [ ] Task 2.1: Refactor `withRetry` to support fresh stream recreation.
  - **File Path**: `server/services/gdrive.js`
  - **Verification Step**: Code review of the retry loop.
- [ ] Task 2.2: Update `uploadToGDrive` to recreate stream on retry.
  - **File Path**: `server/services/gdrive.js`
  - **Verification Step**: Mock a failure and verify the second attempt starts a new stream.
- [ ] Task 2.3: Update `uploadFolderToGDrive` to recreate stream on retry for each file.
  - **File Path**: `server/services/gdrive.js`
  - **Verification Step**: Verify loop integrity for multi-file uploads.

## Phase 3: Implementation - Downloader Service
- [ ] Task 3.1: Improve directory detection to handle sanitized folder names.
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: Test with a torrent name containing special characters like `:`.

## Phase 4: Verification
- [ ] Task 4.1: Run a test upload with a simulated network failure.
  - **File Path**: `scratch/test-upload-retry.js`
  - **Verification Step**: Verify the file is correctly uploaded to GDrive despite the failure.
- [ ] Task 4.2: Verify batching logic with a multi-file torrent.
  - **File Path**: `server/routes/transfer.js`
  - **Verification Step**: Manual test via UI or SSE capture.
