# yt2gd — Preview Run Doc

## Reproduce uncommitted artifacts

A fresh checkout needs these steps before the server can boot and serve the UI:

1. **Install root dependencies** — the root `postinstall` script downloads the yt-dlp
   binary:
   ```bash
   npm install
   ```
2. **Build the client** (Vite production build; `client/dist/` is gitignored):
   ```bash
   cd client && npm install && npm run build && cd ..
   ```
3. **Provide `data/settings.json`** — gitignored; holds user accounts (bcrypt hashes),
   Google Drive credentials, and the cookies file path. Copy it from the main checkout
   if this is a fresh worktree:
   ```bash
   cp /home/shahab/Projects/python-projects/yt2gd/data/settings.json data/settings.json
   ```
   The server also creates `data/bastyon-staging/` and `data/bastyon-accounts.json`
   on demand; no action needed.

No `.env` file is required — all configuration comes from `data/settings.json` plus
environment variables passed at launch (see below).

## Run the server

Express server (`server/index.js`) that serves the built client from `client/dist/`
and the API under `/api/*`. Launch it detached, in its own session:

```bash
setsid nohup env PORT=3210 NODE_OPTIONS="--max-http-header-size=32768" \
  node server/index.js > .freebuff/preview-e1e8f43d-5d44-4209-b6a2-961f3bc67d22.log 2>&1 < /dev/null &
```

Notes:
- `PORT` defaults to 3000; use any free port. This thread's preview uses **3210**.
- `NODE_OPTIONS` raises the max HTTP header size (large cookie files).
- On startup the server clears `tmp/` and schedules a daily yt-dlp auto-update; both
  are safe to ignore.
- Default login: user accounts are defined in `data/settings.json` (e.g. `admin`).
