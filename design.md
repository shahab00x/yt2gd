# yt2gd - Design Document

## 1. Technology Stack
- **Frontend Framework**: Vite, Vanilla CSS/HTML/JS (or Vue/React if preferred).
- **Backend Framework**: Node.js with Express.js to serve the Vite frontend and handle the backend API operations.
- **Authentication**: Simple session-based or token-based authentication using the configured password.
- **Google Drive Integration**: Official `googleapis` npm package.
- **File Downloading**: 
  - **Direct/Raw URLs**: Lightweight HTTP client (`axios`) executing concurrent HTTP Range requests to download file chunks in parallel, avoiding server-side throttling.
  - **YouTube URLs**: Integration with `yt-dlp` executable (via a wrapper like `youtube-dl-exec`) to extract streams and manage format/quality selection, authenticated via user-uploaded cookies.

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
    Backend->>FileServer: Stream download file
    FileServer-->>Backend: File saved to local /tmp
    Backend->>GoogleDrive: Check/Create "yt2gd" folder
    Backend->>GoogleDrive: Check/Create "Month_Day" folder
    Backend->>GoogleDrive: Upload file to "Month_Day" folder
    GoogleDrive-->>Backend: Upload Success
    Backend->>Backend: Delete local /tmp file
    Backend-->>Frontend: Transfer Complete Response
    Frontend-->>User: Show Success Notification
```
