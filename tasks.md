# Tasks: Large Torrent Batching & Persistence

## Phase 1: Persistence & Settings
- [x] Task 1.1: Update `server/services/settings.js` to include `torrentBatchSizeGB` (default 12).
  - **File Path**: `server/services/settings.js`
  - **Verification Step**: Verify that `loadSettings()` returns the new field.
- [x] Task 1.2: Create `server/services/store.js` for transfer state persistence.
  - **File Path**: `server/services/store.js`
  - **Verification Step**: Write a small script to test `saveTransfer` and `getTransfers`.

## Phase 2: Backend Logic Enhancements
- [x] Task 2.1: Implement batching logic in `downloadTorrent` in `server/services/downloader.js`.
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: Add logging to verify files are selected/deselected in batches.
- [x] Task 2.2: Fix torrent folder naming in `server/services/downloader.js` and `server/routes/transfer.js`.
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: Verify that `transfer.js` uses the actual torrent name for GDrive.
- [x] Task 2.3: Update `gdrive.js` to catch quota errors and signal a pause.
  - **File Path**: `server/services/gdrive.js`
  - **Verification Step**: Simulate a quota error and ensure it's caught.

## Phase 3: API & Routing
- [x] Task 3.1: Update `server/routes/transfer.js` to support persistent state and resume.
  - **File Path**: `server/routes/transfer.js`
  - **Verification Step**: Test the new GET `/api/transfer/list` endpoint.

## Phase 4: Frontend UI
- [x] Task 4.1: Update `client/src/views/settings.js` to allow adjusting batch size.
  - **File Path**: `client/src/views/settings.js`
  - **Verification Step**: Verify the new setting appears and saves.
- [x] Task 4.2: Update `client/src/views/dashboard.js` to display persisted transfers and "Resume" button.
  - **File Path**: `client/src/views/dashboard.js`
  - **Verification Step**: Refresh the page during a download and verify it still shows up.
