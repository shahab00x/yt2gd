# Requirements

## 1. Large Torrent Handling (Chunked File Downloading & Persistence)
- **When** a torrent is larger than a configurable threshold or disk space, the system **shall** process the torrent in chunks (batches of files).
- **When** a batch is completely downloaded, the system **shall** upload it to Google Drive and delete it from the local disk before starting the next batch.
- **When** a batch download completes, if the torrent directory name on disk has been sanitized, the system **shall** map the file paths in the batch using the actual sanitized directory name on disk to ensure they are located.
- **When** the WebTorrent client needs to be destroyed (either during success, failure, abort, or cleanup), the system **shall** perform a safe destroy check to ensure that multiple destroy invocations do not throw unhandled "client already destroyed" exceptions.
- **When** an upload to Google Drive is initiated, if any file in the batch does not exist on disk, the system **shall** skip that file, log a warning, and continue uploading the remaining files without terminating the batch upload.
- **When** Google Drive quota is exceeded, the system **shall** pause the torrent and notify the user.
- **When** a torrent is paused, the user **shall** be able to resume it from the UI after clearing space.
- **When** the server restarts or the user reloads the page, the system **shall** maintain and display the state of all active and paused downloads (torrent or otherwise).

## 2. Torrent Folder Naming
- **When** a torrent in folder mode is uploaded to Google Drive, the system **shall** use the actual torrent name for the root folder instead of a generic timestamp identifier.

## 3. Upload Reliability & Integrity
- **When** a file upload to Google Drive fails due to network instability or transient errors, the system **shall** retry the upload with a fresh file stream to ensure data integrity.
- **When** a file upload within a batch fails even after retries, the system **shall** report the specific failure but attempt to continue with other files if possible, or at least maintain a clear status of what was uploaded.

## 4. yt-dlp Update Mechanism
- **When** the server starts, it **shall** schedule an automatic update check for `yt-dlp` every 24 hours.
- **When** the user clicks the "Update yt-dlp" button in the settings, the system **shall** force an update of the `yt-dlp` binary.
- **When** the user views the settings page, the system **shall** display the current version of the installed `yt-dlp` binary.

## 5. App Update & Rollback Mechanism
- **When** the user views the settings page, the system **shall** retrieve and display the last 5 git commits of the codebase.
- **When** the user triggers an update, the system **shall** pull the latest code, install dependencies, rebuild the frontend, and restart the process via PM2.
- **When** the user triggers a rollback to a specific commit, the system **shall** check out that commit, install dependencies, rebuild the frontend, and restart the process via PM2.

## 6. Manual Stranded File Upload
- **When** the user views the "System Status" section, the system **shall** display a manual "Upload" button next to each file or folder stranded in the temporary directory.
- **When** the user clicks the "Upload" button for a stranded item, the system **shall** invoke the manual upload endpoint to push that specific file or folder to Google Drive and refresh the System Status list.

## 7. Resilient Playlist Downloading
- **When** the user triggers a download for a YouTube playlist URL, the system **shall** disable the `noPlaylist` restriction and pass the `ignoreErrors` flag to the downloader to skip unavailable or deleted items.
- **When** the downloader encounters individual video errors during playlist download, the system **shall** log the errors and continue downloading the remaining accessible playlist items.
- **When** the playlist download process completes, if at least one file has been successfully downloaded, the system **shall** proceed with organizing and uploading the downloaded playlist items to Google Drive instead of crashing.
