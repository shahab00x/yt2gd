# Tasks

## Phase 1: Client & UI Enhancements for Manual Uploads
- [x] Task 1.1: Add `uploadFiles` method to `client/src/api.js`
  - **File Path**: `client/src/api.js`
  - **Verification Step**: Inspect code to ensure `uploadFiles` correctly formats the POST request to `/system/upload-files`.
- [x] Task 1.2: Enhance the "System Status" card in `client/src/views/dashboard.js` to render the stranded files with an "Upload" button and bind the click handler
  - **File Path**: `client/src/views/dashboard.js`
  - **Verification Step**: Load the dashboard UI, verify that files in `tmp` are rendered inside beautiful `.history-item` container boxes with an "Upload" button, and clicking it initiates the upload, alerts the user, and refreshes the list.

## Phase 2: Resilient Playlist Downloading in the Downloader Service
- [x] Task 2.1: Update `downloadFile` option assignment in `server/services/downloader.js` to conditionally set `noPlaylist: !isPlaylistUrl` and set `ignoreErrors: true`
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: Inspect code to ensure options are correctly mapped for playlist downloads.
- [x] Task 2.2: Add try-catch interception for yt-dlp execution error in `downloader.js` to allow partial downloads to be organized and uploaded if at least one file exists
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: Run or simulate a playlist download with at least one unavailable item to verify the downloader logs the error, proceeds with the remaining items, and succeeds instead of crashing the transfer.

## Phase 3: Torrent Batch Upload Robustness
- [x] Task 3.1: Map batch file paths in `downloader.js` to use the actual sanitized subdirectory name on disk when it differs from the original torrent name
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: Verify that `mappedFiles` elements substitute the first path segment (original torrent name) with `foundDirName` when a subdirectory exists.
- [x] Task 3.2: Implement `existsSync` verification and robust error skipping for batch file uploads in `uploadFolderToGDrive`
  - **File Path**: `server/services/gdrive.js`
  - **Verification Step**: Verify that missing files do not cause `uploadFolderToGDrive` to crash, and instead are skipped with their size correctly deducted from `totalSize`.
- [x] Task 3.3: Implement safe WebTorrent client destruction helper to avoid "client already destroyed" exceptions
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: Verify that all `client.destroy()` calls in `downloadTorrent` are replaced by `safeDestroy()`, and the app does not throw when it is invoked multiple times.

