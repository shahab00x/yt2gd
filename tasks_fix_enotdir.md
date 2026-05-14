# Tasks: Fix ENOTDIR in Torrent Uploads

- [x] **Task 1: Fix `downloadTorrent` logic in `downloader.js`**
    - **Path**: `server/services/downloader.js`
    - **Description**: Ensure `uploadPath` is a directory even for single-file torrents.
    - **Verification**: Verified by logic (statSync check).
- [x] **Task 2: Fix `zipDirectory` logic in `downloader.js`**
    - **Path**: `server/services/downloader.js`
    - **Description**: Add defensive check for single-file sources in `zipDirectory`.
    - **Verification**: Verified by logic (statSync check).
- [x] **Task 3: Fix `getAllFiles` logic in `gdrive.js`**
    - **Path**: `server/services/gdrive.js`
    - **Description**: Handle single-file paths in `getAllFiles` to prevent `ENOTDIR` from `readdir`.
    - **Verification**: Verified by logic (statSync check).
- [x] **Task 4: Update `uploadFolderToGDrive` in `gdrive.js`**
    - **Path**: `server/services/gdrive.js`
    - **Description**: Ensure relative path calculation is robust for single-file torrents in folder mode.
    - **Verification**: Verified by logic (handling empty relative path).
