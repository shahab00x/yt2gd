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

## Phase 4: Development File Watcher Resiliency (Cookie & Settings Uploads)
- [x] Task 4.1: Create `nodemon.json` config to ignore runtime/data directories
  - **File Path**: `nodemon.json`
  - **Verification Step**: Verify that `nodemon.json` successfully ignores `data/*`, `tmp/*`, `bin/*`, and `client/*`.
- [x] Task 4.2: Update `settings.js` to store configurations in the `data/` folder and ensure auto-directory creation
  - **File Path**: `server/services/settings.js`
  - **Verification Step**: Verify that `settings.json` is successfully created inside `data/` on startup or save, and settings are correctly loaded from `data/settings.json`.
- [x] Task 4.3: Update `auth.js` to write uploaded cookies to the `data/` folder
  - **File Path**: `server/routes/auth.js`
  - **Verification Step**: Upload a cookies file through the Settings page and verify that it is written to `data/cookies.txt`.
- [x] Task 4.4: Update `downloader.js` to save filtered cookies inside the `data/` folder
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: Trigger a download that uses cookies and check that `data/cookies_filtered.txt` is created and correctly filtered.
- [x] Task 4.5: Update `.gitignore` to match the new runtime/data paths
  - **File Path**: `.gitignore`
  - **Verification Step**: Inspect `.gitignore` to confirm it ignores `data/settings.json`, `data/cookies.txt`, and `data/cookies_filtered.txt`.

## Phase 5: Direct Browser Download Feature
- [x] Task 5.1: Export `zipDirectory` helper from `downloader.js`
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: Verify that `zipDirectory` is correctly exported and importable in other server files.
- [x] Task 5.2: Update the transfer endpoint in `transfer.js` to support local browser download mode
  - **File Path**: `server/routes/transfer.js`
  - **Verification Step**: Inspect payload handling for `uploadToDrive: false`, verify that folder/playlist results are correctly zipped, and that the SSE `done` event is fired with `downloadUrl`.
- [x] Task 5.3: Implement the secure `/api/transfer/file/:filename` serving endpoint with auto-deletion
  - **File Path**: `server/routes/transfer.js`
  - **Verification Step**: Run a direct download and check that the file is served from `tmp/` and subsequently deleted from the local disk.
- [x] Task 5.4: Update `client/src/api.js` to send `uploadToDrive` in `transfer` requests
  - **File Path**: `client/src/api.js`
  - **Verification Step**: Inspect file and ensure `uploadToDrive` is properly passed to the `POST /api/transfer` request.
- [x] Task 5.5: Add the "Download" button next to "Upload to Drive" and wire up dynamic trigger logic in dashboard UI
  - **File Path**: `client/src/views/dashboard.js`
  - **Verification Step**: Click "Download" on a link, monitor the progress bar, check that the browser prompts for download, and the file is successfully downloaded.


