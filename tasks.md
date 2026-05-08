# Tasks: Torrent Upload Reliability & Structure Preservation

## Phase 1: Setup & Cleanup Logic
- [x] Task 1.1: Implement `clearTmp` in `downloader.js`.
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: Run a small script to verify `tmp/` is cleared.
- [x] Task 1.2: Integrate `clearTmp` into `server/index.js`.

## Phase 2: Google Drive Service Enhancements
- [x] Task 2.1: Implement path-based folder caching in `gdrive.js`.
- [x] Task 2.2: Update `uploadToGDrive` to use `resumable` upload type.
- [x] Task 2.3: Update `uploadFolderToGDrive` to preserve directory structure.

## Phase 3: Verification & Polish
- [x] Task 3.1: Verify the fix for the reported torrent issue.
- [x] Task 3.2: Add detailed logging for each file upload progress in folder mode.
