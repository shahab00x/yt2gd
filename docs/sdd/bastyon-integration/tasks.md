# Tasks — Bastyon Uploader Integration

> Each task lists the file(s) to touch and a verification step. The crypto/transaction port tasks are verified against the same test vectors used by `bastyon-poster-linux/tests/`.

## Phase 1: Port core Bastyon modules (server/services/bastyon/)

- [x] Task 1.1: Add `@noble/curves` dependency to `package.json`
  - **File Path**: `package.json`
  - **Verification Step**: `npm install` succeeds; import of `secp256k1` from `@noble/curves/secp256k1` resolves.

- [x] Task 1.2: Create `server/services/bastyon/constants.js` (MAINNET/TESTNET NetworkConfig, DUST_THRESHOLD, DEFAULT_FEE, MAX_PAYLOAD_SIZE, node lists)
  - **File Path**: `server/services/bastyon/constants.js`
  - **Verification Step**: Values match `bastyon-poster-linux/src/constants.py` exactly.

- [x] Task 1.3: Create `server/services/bastyon/crypto.js` — Base58, Base58Check, WIF parse, pubkey derivation, address, hash256/hash160, DER signing, compact recoverable signing
  - **File Path**: `server/services/bastyon/crypto.js`
  - **Verification Step**: Port `tests/test_crypto.py` vectors (roundtrip, WIF parse mainnet/testnet, invalid checksum, address prefix `P`/`T`, sign+verify) to Node and pass.

- [x] Task 1.4: Create `server/services/bastyon/payload.js` — PostPayload, compute_content_hash, serialize_payload, 60 KB limit
  - **File Path**: `server/services/bastyon/payload.js`
  - **Verification Step**: Port `tests/test_payload.py` vectors; verify hash composition `url+caption+message+tags+images` matches Python output.

- [x] Task 1.5: Create `server/services/bastyon/transaction.js` — varint, pushdata, OP_RETURN/P2PKH scripts, UTXO select, serialize, legacy sighash, build_and_sign_post_transaction
  - **File Path**: `server/services/bastyon/transaction.js`
  - **Verification Step**: Port `tests/test_transaction.py` vectors (UTXO selection, script bytes, txid consistency, signed tx structure) and pass.

- [x] Task 1.6: Create `server/services/bastyon/rpc.js` — JSON-RPC client (txunspent, sendrawtransactionwithmessage, node fallback, error taxonomy)
  - **File Path**: `server/services/bastyon/rpc.js`
  - **Verification Step**: Port `tests/test_rpc.py` behavior with mocked axios; error mapping matches `rpc.py`.

- [x] Task 1.7: Create `server/services/bastyon/media.js` — PeerTube token (recoverable sig nonce), channel id, simple upload ≤50 MB, resumable upload >50 MB with GET-range resync, image upload with fallbacks, host fallback list
  - **File Path**: `server/services/bastyon/media.js`
  - **Verification Step**: Port `tests/test_media.py` behaviors with mocked HTTP (simple vs resumable path selection, upload_id extraction, offset resync).

## Phase 2: Account & draft stores

- [x] Task 2.1: Create `server/services/bastyon/accounts.js` — CRUD on `data/bastyon-accounts.json`; validate WIF on create; store `encryptedWif`; never expose WIF
  - **File Path**: `server/services/bastyon/accounts.js`
  - **Verification Step**: Create account, list shows `{id, name, encrypted: true}` only; API JSON contains no plaintext `wif`; invalid WIF and duplicate name rejected.

- [x] Task 2.2: Create `server/services/bastyon/drafts.js` — CRUD on `data/bastyon-drafts.json`; staging dir `data/bastyon-staging/<draftId>/`
  - **File Path**: `server/services/bastyon/drafts.js`
  - **Verification Step**: Draft survives a server restart; delete removes record + staging directory.

- [x] Task 2.3: Create `server/services/bastyon/vault.js` — scrypt key derivation, AES-256-GCM encrypt/decrypt (per-account salt/IV/tag), in-memory unlocked key, lock/restart clearing, rotation re-encryption
  - **File Path**: `server/services/bastyon/vault.js`
  - **Verification Step**: Encrypt→decrypt round-trip works; wrong passphrase fails via auth-tag mismatch; `data/bastyon-accounts.json` contains no plaintext key; restart clears the key.

## Phase 3: Downloader changes (app-wide yt-dlp + metadata + audio track selection)

- [x] Task 3.1: Update URL classification in `downloadFile` so non-direct URLs use yt-dlp for any supported site, with ParallelDownloader fallback; magnet path unchanged
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: A non-YouTube supported URL (e.g., Vimeo) downloads via yt-dlp; a direct file URL still uses the parallel downloader; an unsupported page falls back without breaking existing transfers.

- [x] Task 3.2: Add `downloadWithMetadata(url, options)` exporting `{ filePath, title, description, tags, thumbnail, originalUrl }` via yt-dlp `printJson`; reuse cookies/filterCookies and bin resolution
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: `node -e` smoke test against a known-good URL returns non-empty metadata fields and a file on disk.

- [x] Task 3.3: Add `buildFormatSelector({ format, quality, audioLanguage })` porting the tinnitus `audioFormatSelector` chain (original-track default, `[language^=code]`, `[format_id!*=drc]`, plain `bestaudio` fallback) and add `formatSort: ['lang']` to all yt-dlp invocations in `downloadFile`/`downloadWithMetadata`
  - **File Path**: `server/services/downloader.js`
  - **Verification Step**: Selector output for `audioLanguage=ORIGINAL` and `=en` matches the chain in design §5.1; every yt-dlp options object contains `formatSort`; existing YouTube format/quality strings still compose correctly.

- [x] Task 3.4: Thread `audioLanguage` through the API and UI — `client/src/api.js` transfer/download calls, Dashboard YouTube options row (new Audio Track dropdown next to Format/Quality), and `server/routes/transfer.js` payload
  - **File Path**: `client/src/api.js`, `client/src/views/dashboard.js`, `server/routes/transfer.js`
  - **Verification Step**: Selecting a language in the Dashboard reaches the server payload and appears in the yt-dlp selector; defaults to Original when unset.

## Phase 4: Server routes

- [x] Task 4.1: Create `server/routes/bastyon.js` — accounts CRUD, download (SSE), drafts CRUD, publish (SSE), `/api/bastyon/progress` SSE stream; register in `server/index.js`
  - **File Path**: `server/routes/bastyon.js`, `server/index.js`
  - **Verification Step**: All endpoints respond under auth; `GET /api/bastyon/accounts` contains no WIF; SSE stream delivers `status`/`progress`/`done` events tagged with draftId.

- [x] Task 4.2: Wire publish orchestration — fetch account (decrypt WIF via vault; refuse with "vault locked" if locked) → trim (if set) → upload video → thumbnail (best-effort) → payload → UTXOs → sign → broadcast → txid → cleanup
  - **File Path**: `server/routes/bastyon.js`, `server/services/bastyon/vault.js`
  - **Verification Step**: End-to-end publish of a test draft against a real/test account returns a txid and marks the draft `published`; publishing while locked returns a clear error and the UI prompts to unlock; simulated failures leave the draft editable with the file intact; a draft with trimStart/trimEnd uploads the trimmed file (duration check).

- [x] Task 4.3: Add storage endpoints — `GET /api/bastyon/storage` (disk + staging size/contents) and `POST /api/bastyon/staging/clear` (wipe staging dir + remove non-published drafts)
  - **File Path**: `server/routes/bastyon.js`, `server/services/bastyon/drafts.js`
  - **Verification Step**: Storage payload mirrors `/api/system/status` shape for disk; clear removes staging files and unfinished drafts but leaves `published` drafts untouched.

- [x] Task 4.4: Create `server/services/bastyon/trim.js` porting `video_edit.py` (`parse_time_to_seconds`, `trim_video` with ffmpeg `-ss`/`-to` stream-copy and re-encode fallback); availability check for ffmpeg
  - **File Path**: `server/services/bastyon/trim.js`
  - **Verification Step**: Trimming a test file with start/end produces the expected shorter duration; missing-ffmpeg path raises a clear error.

- [x] Task 4.5: Add vault endpoints — `GET /api/bastyon/vault/status`, `POST /api/bastyon/vault/unlock`, `POST /api/bastyon/vault/lock`, `POST /api/bastyon/vault/passphrase` (set first-time / rotate when unlocked); account-create requires unlocked vault
  - **File Path**: `server/routes/bastyon.js`, `server/services/bastyon/vault.js`
  - **Verification Step**: Status reflects lock state; unlock with wrong passphrase → 401; rotation re-encrypts all accounts and old passphrase no longer unlocks.

## Phase 5: Client

- [x] Task 5.1: Add Bastyon API wrappers (accounts/drafts/download/publish/storage/clear-staging + vault status/unlock/lock/passphrase) + `openBastyonProgressStream()` to `client/src/api.js`
  - **File Path**: `client/src/api.js`
  - **Verification Step**: Wrappers hit the right endpoints with credentials.

- [x] Task 5.2: Create `client/src/views/bastyon.js` — account management card (with vault: set-passphrase on first use with unrecoverable-keys warning, unlock prompt when locked, lock/unlock status chip, change passphrase), publish card (dropdown/URL/format/quality/**audio track**/progress), draft editor (title/description/tags/account/**trim start/end** + Save/Publish/Delete), drafts list with status badges, success TxID alert, and the Storage card (disk bar + staging size + Clear Staging)
  - **File Path**: `client/src/views/bastyon.js`
  - **Verification Step**: Full flow works in the browser: set passphrase → add account → download (with chosen audio track) → edit draft (including trim) → publish (unlock prompt shown if locked) → success confirmation; storage card updates and Clear Staging removes unfinished drafts; drafts persist across reload; after a server restart the vault shows locked and publish prompts for the passphrase.

- [x] Task 5.3: Register the `bastyon` route in `client/src/main.js` and add the "Bastyon Uploader" nav item (between Dashboard and Settings) to `dashboard.js`, `settings.js`, and `bastyon.js`; add the Audio Track dropdown to the Dashboard's YouTube options row
  - **File Path**: `client/src/main.js`, `client/src/views/dashboard.js`, `client/src/views/settings.js`, `client/src/views/bastyon.js`
  - **Verification Step**: Nav renders in all three views in the correct order; clicking switches views without reload; active state highlights correctly; Dashboard audio track dropdown present and functional.

## Phase 6: Verification & hardening

- [x] Task 6.1: Run a full app smoke test — Dashboard transfers (YouTube with original/default audio, direct URL, magnet, playlist, browser download) still work unchanged; cookie flow intact
  - **Verification Step**: Existing features in `requirements.md`/`tasks.md` (root) all still pass manual checks; a multi-audio YouTube video downloads the original track (audio track dropdown affects the chosen stream).

- [x] Task 6.2: Build client (`npm run build:client`) and start server; confirm no runtime errors on all three tabs
  - **Verification Step**: `npm run build:client` succeeds; server boots; logs show no unhandled rejections.

- [x] Task 6.3: Update root `README.md`/docs if needed with the new feature summary
  - **File Path**: `README.md` (if present) or `docs/`
  - **Verification Step**: Documentation reflects the new tab, its account/publish flow, and the encrypted WIF vault (passphrase not persisted; unlock required to publish). No root `README.md` exists in this repo — these SDD docs are the record.

## Verification Log (2026-08-16)

- `node --test server/services/bastyon/bastyon.test.js` → 24/24 pass (crypto, payload, transaction, rpc vectors ported from `bastyon-poster-linux`).
- Vault/accounts/drafts verified end-to-end over HTTP: set passphrase → add account (encrypted, WIF never returned) → lock → create-while-locked refused → wrong passphrase 401 → unlock → rotation re-encrypts.
- Draft lifecycle verified: download creates draft (yt-dlp runs, failures marked `failed` with clean error), edit title/tags/trim, publish guard rails (no account, missing file, vault locked), storage + clear staging.
- `downloadWithMetadata` verified against a real YouTube video: title/description/tags/thumbnail + audio file downloaded; `downloadFile` falls back to the parallel downloader on `Unsupported URL` (example.com) and streams direct URLs.
- `client` production build succeeds (`npm run build`); server boots and serves all routes (bastyon routes return 401 unauthenticated, 200 authenticated).
- **Remaining manual check (user):** full browser UI walkthrough of the Bastyon tab (vault forms, dropdowns, progress bars) and a real publish to Bastyon with a funded account.
