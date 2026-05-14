# Requirements

## 1. Large Torrent Handling (Chunked File Downloading & Persistence)
- **When** a torrent is larger than a configurable threshold or disk space, the system **shall** process the torrent in chunks (batches of files).
- **When** a batch is completely downloaded, the system **shall** upload it to Google Drive and delete it from the local disk before starting the next batch.
- **When** Google Drive quota is exceeded, the system **shall** pause the torrent and notify the user.
- **When** a torrent is paused, the user **shall** be able to resume it from the UI after clearing space.
- **When** the server restarts or the user reloads the page, the system **shall** maintain and display the state of all active and paused downloads (torrent or otherwise).

## 2. Torrent Folder Naming
- **When** a torrent in folder mode is uploaded to Google Drive, the system **shall** use the actual torrent name for the root folder instead of a generic timestamp identifier.

## 3. Upload Reliability & Integrity
- **When** a file upload to Google Drive fails due to network instability or transient errors, the system **shall** retry the upload with a fresh file stream to ensure data integrity.
- **When** a file upload within a batch fails even after retries, the system **shall** report the specific failure but attempt to continue with other files if possible, or at least maintain a clear status of what was uploaded.
