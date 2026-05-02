# yt2gd - Implementation Tasks

## Phase 1: Project Initialization & Backend Setup
- [ ] Task 1.1: Initialize project, create `package.json`, and install backend dependencies (`express`, `googleapis`, `axios`, `cors`, `bcrypt`).
  - **File Path**: `package.json`
  - **Verification Step**: Run `npm list` to verify dependencies are installed successfully.
- [ ] Task 1.2: Create basic Express server setup.
  - **File Path**: `server/index.js`
  - **Verification Step**: Run `node server/index.js` and verify it logs that the server is running on the specified port.
- [ ] Task 1.3: Create settings management module to handle saving/loading credentials securely.
  - **File Path**: `server/services/settings.js`
  - **Verification Step**: Run a temporary test script to save mock settings and verify `settings.json` is created with the expected content.
- [ ] Task 1.4: Implement authentication endpoints (login to get a session/token). Users are **admin-defined** in `settings.json` — no self-registration endpoint exists.
  - **File Path**: `server/routes/auth.js`
  - **Verification Step**: Use `curl` to send a POST request with the correct password and verify it returns a success token.

## Phase 2: Frontend Setup
- [ ] Task 2.1: Initialize Vite (Vanilla JS or Vue) project for the frontend.
  - **File Path**: `client/index.html` (and Vite config)
  - **Verification Step**: Run `npm run dev` in the client directory and verify the dev server starts without errors.
- [ ] Task 2.2: Implement the Login View and routing.
  - **File Path**: `client/src/login.js` (or equivalent Vue component)
  - **Verification Step**: Open the app in the browser, verify the login page is shown, and test authenticating.
- [ ] Task 2.3: Implement the Settings View to input Google Drive credentials.
  - **File Path**: `client/src/settings.js` (or equivalent)
  - **Verification Step**: Submit mock credentials via the UI and verify they are saved to the backend `settings.json`.

## Phase 3: Core Logic (Download & Google Drive)
- [ ] Task 3.1: Implement file downloader service.
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: Run a test script passing a public URL and verify the file is downloaded to a local temporary folder.
- [ ] Task 3.2: Implement Google Drive API service (auth, create folder, upload).
  - **File Path**: `server/services/gdrive.js`
  - **Verification Step**: Write a test script that uploads a dummy file to Google Drive and verify it appears in the correct `yt2gd/Month_Day` folder.
- [ ] Task 3.3: Implement the main transfer API route combining download and upload.
  - **File Path**: `server/routes/transfer.js`
  - **Verification Step**: Use `curl` or Postman to submit a URL to the transfer API and verify the full flow completes.

## Phase 4: Finalizing Frontend & Integration
- [ ] Task 4.1: Implement the main dashboard view for URL submission.
  - **File Path**: `client/src/dashboard.js`
  - **Verification Step**: Open the UI, submit a URL, and observe successful completion.
- [ ] Task 4.2: Ensure Vite serves production build via Express for easy deployment.
  - **File Path**: `server/index.js`
  - **Verification Step**: Run `npm run build` in client, start the Node server, and verify the frontend is served correctly at `http://localhost:3000`.

## Phase 5: Speedup Improvements & Large File Fix
- [x] Task 5.1: Replace the custom chunking logic in `downloader.js` with a dedicated npm downloader library (e.g., `node-downloader-helper`) configured for multi-connection chunking to reliably handle 1GB+ files without memory exhaustion.
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: Run a test script with a 1GB+ URL and verify all chunks complete and the file merges to the exact total size.
- [x] Task 5.2: Implement download and upload progress tracking (bytes, speed, total) using Server-Sent Events (SSE) or polling.
  - **File Path**: `server/routes/transfer.js`, `server/services/downloader.js`, `server/services/gdrive.js`
  - **Verification Step**: Call the progress endpoint during a transfer and verify real-time stats are emitted.

## Phase 6: yt-dlp Integration & Binary Management
- [x] Task 6.1: Create an OS-independent auto-downloader script for `yt-dlp` binary and add the executable to `.gitignore`.
  - **File Path**: `scripts/download-yt-dlp.js`, `package.json` (postinstall), `.gitignore`
  - **Verification Step**: Run `npm run postinstall` on Windows and verify `yt-dlp.exe` is downloaded correctly without errors.
- [x] Task 6.2: Create API endpoints and logic to support YouTube URLs via `yt-dlp`, handling format selection and cookie passing.
  - **File Path**: `server/routes/transfer.js` and `server/services/downloader.js`
  - **Verification Step**: Use `curl` to pass a standard YouTube URL with format parameters and verify it triggers `yt-dlp` successfully.
- [x] Task 6.3: Implement the UI feature for users to upload and manage their `cookies.txt` file.
  - **File Path**: `client/src/settings.js` and `server/routes/auth.js`
  - **Verification Step**: Upload a mock `cookies.txt` file via the frontend and verify it is securely saved on the backend.

## Phase 7: UI Enhancements (Progress & Versions)
- [x] Task 7.1: Update the main UI dashboard to show real-time download/upload progress (bytes, total, speed).
  - **File Path**: `client/src/views/dashboard.js`, `client/src/api.js`
  - **Verification Step**: Submit a transfer from the UI and observe the progress bar updating with accurate stats.
- [x] Task 7.2: Add format (Video/Audio) and quality selection when a YouTube URL is entered in the UI.
  - **File Path**: `client/src/views/dashboard.js`
  - **Verification Step**: Enter a YouTube URL, select options, and verify the correct parameters are sent to the backend.
- [x] Task 7.3: Display the application version (server and client) in the UI footer or sidebar.
  - **File Path**: `client/src/views/dashboard.js`, `client/vite.config.js`, `server/routes/auth.js`
  - **Verification Step**: Open the UI and verify the versions match the `package.json`.
