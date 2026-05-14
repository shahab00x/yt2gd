# Walkthrough: Fix ENOTDIR in Torrent Uploads

I have fixed the `ENOTDIR` error that occurred when downloading single-file torrents. The system now correctly handles both single files and directories during the upload and zipping phases.

## Changes Made

### 1. `server/services/downloader.js`
- **Updated `downloadTorrent`**: Added logic to verify if the torrent content is a directory. If it's a single file, the system now uses the parent temporary directory as the `uploadPath`, ensuring that downstream services (like `archiver` or `readdir`) always receive a directory to scan.
- **Updated `zipDirectory`**: Added a defensive check using `statSync`. If the source path is a file, it now uses `archive.file()` instead of `archive.directory()`.

### 2. `server/services/gdrive.js`
- **Updated `getAllFiles`**: Added a check to handle single-file paths. It now returns the file path in a single-item array instead of throwing `ENOTDIR` when calling `readdir`.
- **Updated `uploadFolderToGDrive`**: Improved relative path calculation to handle cases where the source directory is the same as the file path (e.g., for single-file torrents).

## Verification Results

- Verified the logic with a test script in `scratch/test_fix.js`.
- Confirmed that `statSync` correctly identifies files to prevent `readdir` calls on non-directories.
- The changes address both the "Zip mode" failure and the "Folder mode" failure reported.

## Files Modified
- [downloader.js](file:///c:/Users/shaha/python_projects/yt2gd/server/services/downloader.js)
- [gdrive.js](file:///c:/Users/shaha/python_projects/yt2gd/server/services/gdrive.js)
