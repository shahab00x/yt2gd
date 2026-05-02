# yt2gd - Design Document

## 1. Technology Stack
- **Frontend Framework**: Vite, Vanilla CSS/HTML/JS (or Vue/React if preferred).
- **Backend Framework**: Node.js with Express.js to serve the Vite frontend and handle the backend API operations.
- **Authentication**: Simple session-based or token-based authentication using the configured password.
- **Google Drive Integration**: Official `googleapis` npm package.
- **File Downloading**: 
  - **Direct/Raw URLs**: A dedicated Node.js downloader library (e.g., `node-downloader-helper` or `multi-part-downloader`) configured for concurrent multi-part downloading to handle large 1GB+ files efficiently without custom manual chunk merging.
  - **YouTube URLs**: Integration with `yt-dlp` executable (via a wrapper like `youtube-dl-exec`). The binary will be downloaded automatically via a custom script (`scripts/download-yt-dlp.js`) for the correct OS and ignored in `.gitignore`.
- **Real-Time Progress**: Server-Sent Events (SSE) or a polling endpoint to send download/upload progress (bytes, total, speed) to the frontend.
- **Versioning**: The server exposes its version from `package.json`. The Vite frontend embeds the version using `import.meta.env.VITE_APP_VERSION`.

## 2. Data Models
### Settings Model (Stored locally in `settings.json`)
```json
{
  "passwordHash": "bcrypt_hashed_password_for_login",
  "googleDrive": {
    "clientId": "string",
    "clientSecret": "string",
    "redirectUri": "string",
    "refreshToken": "string"
  }
}
```

## 3. Architecture Diagrams

### System Architecture
```mermaid
graph TD
    Client[Browser Frontend - Vite] -->|HTTP Requests| API[Backend - Express API]
    API -->|Read/Write| ConfigStore[(settings.json)]
    API -->|Download| ExternalURL[External File URL]
    API -->|Upload| GDrive[Google Drive API]
```

### URL to Google Drive Flow
```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Backend
    participant FileServer
    participant GoogleDrive

    User->>Frontend: Enter File URL & Submit
    Frontend->>Backend: POST /api/transfer { url }
    Frontend->>Backend: GET /api/transfer/progress (SSE/Polling)
    Backend->>FileServer: Stream download file (Chunked or yt-dlp)
    FileServer-->>Backend: File saved to local /tmp (Emits progress)
    Backend->>GoogleDrive: Check/Create "yt2gd" folder
    Backend->>GoogleDrive: Check/Create "Month_Day" folder
    Backend->>GoogleDrive: Upload file to "Month_Day" folder (Emits progress)
    GoogleDrive-->>Backend: Upload Success
    Backend->>Backend: Delete local /tmp file
    Backend-->>Frontend: Transfer Complete Response
    Frontend-->>User: Show Success Notification
```
