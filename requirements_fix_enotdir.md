# Requirements: Fix ENOTDIR in Torrent Uploads

## Problem Statement
When downloading a single-file torrent, the system identifies the file path as the download directory. Subsequent operations like `scandir` (in `uploadFolderToGDrive`) or zipping (in `zipDirectory`) fail with `ENOTDIR` because they expect a directory but receive a file path.

## Requirements (EARS)

- **When** a torrent download completes, the **system** shall determine if the result is a single file or a directory.
- **When** a torrent download is processed for zipping or folder-mode upload, the **system** shall ensure the source path is a directory (e.g., the parent temp directory) to allow recursive processing.
- **When** the `zipDirectory` helper is called, the **system** shall handle both directory and single-file sources gracefully.
- **When** the `uploadFolderToGDrive` service is called, the **system** shall verify the source path and ensure it does not attempt to `readdir` a file.
