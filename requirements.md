# Requirements: Torrent Upload Reliability & Structure Preservation

## Functional Requirements

- **RQ-1: Structure Preservation**
  - When uploading a torrent in "folder" mode, the system shall recreate the original subdirectory hierarchy on Google Drive.
  - *Context*: Currently, all files are uploaded to a single flat folder.

- **RQ-2: Resumable Uploads**
  - When uploading files to Google Drive, the system shall utilize the resumable upload protocol.
  - *Context*: This improves reliability for large files (like MKVs) and prevents crashes on network jitter.

- **RQ-3: Startup Cleanup**
  - When the server initializes, the system shall delete all contents within the `tmp/` directory.
  - *Context*: Previous failed or crashed transfers leave partially downloaded torrents/files that consume VPS space.

- **RQ-4: Improved Error Handling**
  - When a file upload fails during a folder upload, the system shall log the specific error and the file path.
  - The system should attempt to continue with other files if one fails, or provide a clear error message to the client.

## Non-Functional Requirements

- **Reliability**: The system must handle large file uploads (500MB+) without crashing the Node.js process.
- **Performance**: Folder ID lookups should be cached during a single transfer to minimize API calls.
