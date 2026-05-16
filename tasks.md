# Tasks: App Update & Rollback Mechanism

## Phase 1: Backend Implementation
- [x] Task 1.1: Add `GET /api/system/commits` endpoint in system routes.
  - **File Path**: `server/routes/system.js`
  - **Verification Step**: Run test git query or hit GET `/api/system/commits` via a scratch script to verify last 5 commits are returned in parsed format.
- [x] Task 1.2: Add `POST /api/system/update-app` endpoint in system routes.
  - **File Path**: `server/routes/system.js`
  - **Verification Step**: Verify that git pull, build commands compile cleanly, and trigger restart.
- [x] Task 1.3: Add `POST /api/system/rollback-app` endpoint in system routes.
  - **File Path**: `server/routes/system.js`
  - **Verification Step**: Verify checkout is executed properly and is followed by rebuild and restart.

## Phase 2: Frontend Implementation
- [x] Task 2.1: Add API client methods for commits, update, and rollback.
  - **File Path**: `client/src/api.js`
  - **Verification Step**: Verify methods are correctly exported.
- [x] Task 2.2: Implement the **System Management** card in Settings UI.
  - **File Path**: `client/src/views/settings.js`
  - **Verification Step**: Load settings page, verify git commit logs list, and verify update/rollback buttons exist.
- [x] Task 2.3: Add self-reloading modal overlay when app is updating or rolling back.
  - **File Path**: `client/src/views/settings.js`
  - **Verification Step**: Trigger update/rollback, ensure loading overlay blocks UI and polls server until it is back online.
