# Walkthrough: Torrent Batch Upload Fix

I have fixed the issue where torrent batch transfers were only partially uploading to Google Drive.

## Changes Made

### 1. Robust Upload Retry Logic
- **File**: `server/services/gdrive.js`
- **Fix**: Refactored the `withRetry` helper and the upload functions (`uploadToGDrive`, `uploadFolderToGDrive`) to recreate the file stream and progress tracker inside the retry loop.
- **Why**: Previously, if an upload failed once, the stream was already partially consumed. Subsequent retries would try to send a truncated stream, causing the upload to fail permanently or corrupt the file. Now, each retry starts with a fresh stream from the beginning of the file.

### 2. Improved Directory Detection
- **File**: `server/services/downloader.js`
- **Fix**: Replaced the strict directory name matching with a dynamic search for the first subfolder in the download directory.
- **Why**: WebTorrent automatically sanitizes torrent names on disk (e.g., removing characters like `:`). This fix ensures that the system finds the actual data directory even if it doesn't match the original torrent name exactly.

### 3. Loop Integrity
- **File**: `server/services/gdrive.js`
- **Fix**: Ensured that the individual file upload loop in `uploadFolderToGDrive` correctly handles retries per file, preventing a single transient failure from terminating the entire batch upload.

## Verification Results

- [x] **Syntax & Logic Check**: Verified that the refactored code correctly initializes streams inside the retry blocks.
- [x] **Export Validation**: Confirmed that service functions are correctly exported and accessible.
- [x] **Code Review**: Verified that the new `uploadSource` detection logic correctly handles both single-file and multi-file torrents.

The system is now much more resilient to network instability during large batch transfers.
