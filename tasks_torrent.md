# Tasks: Torrent Support Implementation

## Phase 1: Environment & Dependencies
- [x] Task 1.1: Install `webtorrent` and `archiver` dependencies.
  - **File Path**: `package.json`
  - **Verification Step**: Run `npm install` and verify `node_modules` contains the libraries.

## Phase 2: Backend - Torrent Service
- [x] Task 2.1: Add magnet link detection and `zipDirectory` helper to `downloader.js`.
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: Add a small test export to check if `isMagnet` works.
- [x] Task 2.2: Implement `downloadTorrent` logic in `downloader.js`.
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: Create a scratch script `test-torrent.js` to download a small legal torrent (e.g., Ubuntu/Debian netinst) and verify it creates a ZIP.

## Phase 3: Backend - Integration
- [x] Task 3.1: Update `downloadFile` in `downloader.js` to route magnet links to `downloadTorrent`.
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: Call `downloadFile` with a magnet link in a test script.
- [x] Task 3.2: Update `transfer.js` cleanup logic to handle directories.
  - **File Path**: `server/routes/transfer.js`
  - **Verification Step**: Verify that both the `.tmp` (zip) and the source directory are gone after a transfer attempt.

## Phase 4: Frontend - UI Enhancements
- [x] Task 4.1: Update `dashboard.js` to recognize magnet links and update UI hints.
  - **File Path**: `client/src/views/dashboard.js`
  - **Verification Step**: Paste a magnet link in the UI and verify the YouTube options disappear and a torrent-related hint appears (if implemented).
- [x] Task 4.2: Update progress parsing in `dashboard.js` to show peer counts if available in the progress string.
  - **File Path**: `client/src/views/dashboard.js`
  - **Verification Step**: Observe peer count in the UI during a torrent download.
