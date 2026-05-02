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

## Phase 5: Speedup Improvements (Chunked Downloading)
- [x] Task 5.1: Refactor `downloader.js` to implement concurrent HTTP Range requests for raw media streams.
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: Run a test script passing a direct `googlevideo.com` URL and verify it downloads significantly faster using concurrent chunks.

## Phase 6: yt-dlp Integration & UI Additions
- [ ] Task 6.1: Install `youtube-dl-exec` and ensure the `yt-dlp` binary is available.
  - **File Path**: `package.json`
  - **Verification Step**: Run `npm list` to verify installation and test executing the wrapper.
- [ ] Task 6.2: Create API endpoints and logic to support YouTube URLs, handling format selection and cookie passing.
  - **File Path**: `server/routes/transfer.js` and `server/services/downloader.js`
  - **Verification Step**: Use `curl` to pass a standard YouTube URL with format parameters and verify it triggers `yt-dlp` successfully.
- [ ] Task 6.3: Implement the UI feature for users to upload and manage their `cookies.txt` file.
  - **File Path**: `client/src/settings.js` and `server/routes/settings.js`
  - **Verification Step**: Upload a mock `cookies.txt` file via the frontend and verify it is securely saved on the backend.
- [ ] Task 6.4: Update the main UI dashboard to show format (Video/Audio) and quality selection when a YouTube URL is entered.
  - **File Path**: `client/src/dashboard.js`
  - **Verification Step**: Enter a YouTube URL in the UI, select format/quality options, submit, and verify the successful transfer.
