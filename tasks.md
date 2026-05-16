# Tasks: yt-dlp Update Mechanism

## Phase 1: Backend Scripts & API
- [x] Task 1.1: Modify `scripts/download-yt-dlp.js` to bypass `existsSync` if `--force` argument is provided.
  - **File Path**: `scripts/download-yt-dlp.js`
  - **Verification Step**: Run `node scripts/download-yt-dlp.js --force` and verify it downloads a fresh copy even if the binary already exists.
- [x] Task 1.2: Add `/api/system/ytdlp-version` endpoint to get the current version.
  - **File Path**: `server/routes/system.js`
  - **Verification Step**: Send a GET request to the endpoint and verify the version string is returned.
- [x] Task 1.3: Add `/api/system/update-ytdlp` endpoint to execute the update script with `--force`.
  - **File Path**: `server/routes/system.js`
  - **Verification Step**: Send a POST request to the endpoint and verify success.
- [x] Task 1.4: Add a background interval to run the update script every 24 hours.
  - **File Path**: `server/index.js`
  - **Verification Step**: Review the code to ensure `setInterval` is correctly configured.

## Phase 2: Frontend Implementation
- [x] Task 2.1: Add `getYtdlpVersion` and `updateYtdlp` methods to the API client.
  - **File Path**: `client/src/api.js`
  - **Verification Step**: Ensure functions are properly exported and match the backend endpoints.
- [x] Task 2.2: Add the version display and update button to the Settings UI.
  - **File Path**: `client/src/views/settings.js`
  - **Verification Step**: Load the frontend and verify the button, version text, and click logic works correctly.
