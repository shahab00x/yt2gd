# Requirements — Bastyon Uploader Integration

> All requirements use EARS (Easy Approach to Requirements Syntax).
> Scope: add a "Bastyon Uploader" tab to yt2gd that downloads videos with yt-dlp, lets the user edit post metadata, and publishes them to Bastyon (Pocketnet) via PeerTube + blockchain broadcast, reusing the crypto/media/transaction logic from `bastyon-poster-linux`.

---

## 1. Navigation & UI

### REQ-NAV-1 — New Tab
When the user opens the application, the sidebar **shall** display a third navigation item labeled **Bastyon Uploader**, positioned between **Dashboard** and **Settings**, on every authenticated view.

### REQ-NAV-2 — Tab Rendering
When the user clicks the **Bastyon Uploader** navigation item, the application **shall** render the Bastyon Uploader view without reloading the page and **shall** mark it as the active nav item.

## 2. Bastyon Accounts

### REQ-ACC-1 — Account Creation
When the user enters a unique account name and a valid private key and submits the form, the system **shall** accept the key in either of two formats — a WIF string or a 64-character hex key — validate it, derive the account address, and store the account on the server with the key **encrypted at rest** (REQ-ACC-7). Creating an account **shall** require the vault to be unlocked (REQ-ACC-9).

### REQ-ACC-1a — Hex Key Conversion
When the user submits a 64-character hex private key, the system **shall** convert it to a mainnet compressed WIF server-side (appending the `0x01` compressed flag and Base58Check-encoding with the Pocketcoin WIF prefix, per `bastyon-poster-linux/scripts/hex_to_wif.py`) before validation and storage; the user **shall** be able to paste either format interchangeably, and the conversion **shall** be invisible in the UI (only the account name is ever shown).

### REQ-ACC-2 — Account Validation Failure
When the user submits an invalid private key (bad WIF checksum/prefix/length, or malformed hex) or a duplicate account name, the system **shall** reject the submission and display the validation error without saving anything.

### REQ-ACC-3 — Account Selection Dropdown
When the user views the Bastyon Uploader tab, the system **shall** show a dropdown populated with the names of all stored accounts; the user **shall** be able to select exactly one account for a download/publish operation.

### REQ-ACC-4 — Private Key Concealment
After an account is created, the system **shall** never display, return, or log the private key. API responses for account listing **shall** include only the account name (and non-sensitive metadata); the user **shall** be able to identify accounts by name only.

### REQ-ACC-5 — Account Deletion
When the user deletes an account, the system **shall** remove it from the store. If the account is referenced by a draft that has not been published yet, the system **shall** allow the draft to be re-assigned to another account or block publish until one is chosen.

### REQ-ACC-6 — Secure Storage
The system **shall** persist accounts in the `data/` directory (git-ignored), following the same runtime-isolation convention used for `settings.json` and `cookies.txt`.

### REQ-ACC-7 — At-Rest Encryption
When an account is created, the system **shall** encrypt the WIF private key with **AES-256-GCM** using a key derived from a master passphrase via scrypt (per-account salt), and **shall** store only the ciphertext (salt, IV, and auth tag) in `data/bastyon-accounts.json` — the plaintext key **shall** never be written to disk, returned by an API, or logged.

### REQ-ACC-8 — Passphrase Not Persisted
The master passphrase **shall** never be stored on disk. The derived key **shall** live only in server process memory, so after a server restart the vault is locked and the user **shall** re-enter the passphrase to unlock it.

### REQ-ACC-9 — Unlock Required to Publish
When the user attempts to publish a draft or create an account while the vault is locked, the system **shall** refuse with a clear "vault locked" error, and the UI **shall** prompt for the master passphrase first.

### REQ-ACC-10 — Passphrase Rotation
When the user changes the master passphrase (with the vault unlocked), the system **shall** re-encrypt all stored keys with the new passphrase.

### REQ-ACC-11 — Passphrase Loss Warning
When the user sets the master passphrase for the first time, the system **shall** warn that a forgotten passphrase makes stored keys unrecoverable; the only remedy is deleting the account and re-adding it.

## 3. Download & Draft Creation

### REQ-DWN-1 — Supported Sites
When the user submits a video URL in the Bastyon Uploader, the system **shall** download it with yt-dlp for any URL that yt-dlp supports (per `yt-dlp_supportedsites.md`), not only YouTube.

### REQ-DWN-2 — Cookie Reuse
When a download is performed from the Bastyon Uploader, the system **shall** use the same `cookies.txt` file uploaded in the Settings tab (filtered via the existing cookie-filtering logic) when it exists.

### REQ-DWN-3 — App-Wide yt-dlp Coverage
When a URL is submitted from the Dashboard and it is not a direct file URL (no file extension / not a streaming URL), the system **shall** attempt a yt-dlp download instead of treating it as a raw direct URL, so any yt-dlp-supported site works app-wide.

### REQ-DWN-4 — Direct URL Fallback
When a URL is a direct file URL (e.g., ends with a known media extension or serves a media Content-Type) or yt-dlp reports it as unsupported, the system **shall** fall back to the existing parallel/stream downloader so current Dashboard behavior is preserved.

### REQ-DWN-5 — Magnet Links Unchanged
When the submitted URL is a magnet link, the system **shall** keep using the existing WebTorrent pipeline unchanged.

### REQ-DWN-6 — Metadata Extraction
When a video is downloaded for the Bastyon Uploader, the system **shall** capture yt-dlp metadata — title, description, tags, thumbnail URL, and original URL — via `--print-json` output.

### REQ-DWN-7 — Draft Post Creation
When a single-video download completes in the Bastyon Uploader, the system **shall** create a persisted draft post pre-filled with the extracted title, description, and tags, and **shall** retain the downloaded file on disk (outside the wipeable `tmp/` folder) for later publishing.

### REQ-DWN-8 — Playlist Handling
When the submitted URL resolves to a playlist, the system **shall** reject the download with a clear message directing the user to the Dashboard for playlist downloads (single-video URLs are the supported unit for Bastyon posts in this release).

### REQ-DWN-9 — Original Audio Track Default
When downloading a video (Dashboard or Bastyon Uploader), the system **shall** prefer the **original** language audio track over YouTube's auto-dubbed tracks by sorting formats with yt-dlp's `lang` sort key (`formatSort: ['lang']`), which ranks original-language streams above dubbed/auto-dubbed ones, and **shall** exclude DRC (dynamic-range-compressed) duplicates from the audio selection.

### REQ-DWN-10 — Audio Track Selection
When the user selects a specific audio language (e.g., English, Farsi, Arabic, Turkish), the system **shall** restrict the audio selection to streams whose language matches that code (yt-dlp `[language^=code]` prefix filter) and **shall** fall back to the original-language track chain (then plain `bestaudio`) when the requested language is unavailable, so a download never fails on audio-format grounds.

### REQ-DWN-11 — Quality Selection Before Download
When the user submits a URL, the system **shall** expose format (video/audio) and quality (video height: best/worst/1080/720/480/360; audio: best) selection **before** the download starts, on both the Dashboard and the Bastyon Uploader, and **shall** apply the chosen quality to the yt-dlp format selector.

## 4. Draft Editing

### REQ-EDT-1 — Editable Fields
When a draft post exists, the user **shall** be able to edit the post title, description, and tags before publishing.

### REQ-EDT-2 — Account Assignment
When a draft post exists, the user **shall** be able to choose which Bastyon account publishes it (defaulting to the account selected at download time).

### REQ-EDT-3 — Draft Persistence
The system **shall** persist drafts (including edits) to the `data/` directory so they survive server restarts and page reloads.

### REQ-EDT-4 — Draft Deletion
When the user deletes a draft, the system **shall** remove the draft record **and** its downloaded file from disk.

### REQ-EDT-5 — Video Trim Settings
When a draft exists, the user **shall** be able to set optional trim start and end times (SS, MM:SS, or HH:MM:SS) that are saved on the draft and applied to the local file when the post is published.

### REQ-EDT-6 — Trim Application
When publishing a draft with trim settings, the system **shall** cut the video with ffmpeg (`-ss`/`-to` with stream copy, falling back to a full re-encode when the container doesn't support copy cuts) and upload the trimmed file. When no trim is set, the system **shall** upload the file as-is.

### REQ-EDT-7 — ffmpeg Availability
When ffmpeg is not installed on the server and the user attempts to download a video for the Bastyon Uploader, the system **shall** surface a clear error explaining the requirement (trimming is optional but unavailable), rather than failing silently.

## 5. Publishing

### REQ-PUB-1 — Video Upload to PeerTube
When the user approves a draft, the system **shall** upload the local video file to a Bastyon PeerTube host using blockchain authentication (recoverable secp256k1 signature + nonce), the simple upload API for files ≤ 50 MB, and the resumable chunked upload API for files > 50 MB, trying fallback PeerTube hosts on failure.

### REQ-PUB-2 — Thumbnail Attachment
When the draft has a thumbnail URL, the system **shall** download the thumbnail and upload it as a post image; if thumbnail fetch/upload fails, the system **shall** publish the post without it (non-fatal).

### REQ-PUB-3 — Payload Construction
When publishing, the system **shall** build the Pocketnet post payload (`m`, `l`, `c`, `t`, `i`, `u`) exactly as in `bastyon-poster-linux`, with the PeerTube URL (`peertube://<host>/<uuid>`) in the `u` field, and compute the content hash per Pocketnet consensus (`url + caption + message + tags + images`).

### REQ-PUB-4 — Transaction Signing
When publishing, the system **shall** fetch confirmed UTXOs for the account address, select UTXOs to cover fee + dust, and build/sign a version-2 Pocketcoin transaction with an `OP_RETURN` output carrying `["share", content_hash]` and a P2PKH change output, using legacy SIGHASH_ALL signing.

### REQ-PUB-5 — Blockchain Broadcast
When the transaction is signed, the system **shall** broadcast it via the `sendrawtransactionwithmessage` RPC (with node fallback) and return the resulting TxID.

### REQ-PUB-6 — Success Confirmation
When broadcast succeeds, the system **shall** mark the draft as published, display a success confirmation with the TxID, and clean up the downloaded file and thumbnail artifacts.

### REQ-PUB-7 — Failure Handling
When any publish step fails (upload, UTXO fetch, insufficient funds, RPC error, unregistered account, posting limit), the system **shall** surface the specific error to the user, keep the draft in an editable state, and retain the local file for retry.

## 6. Staging Storage & Cleanup

### REQ-STG-1 — Storage Indicator
When the user views the Bastyon Uploader tab, the system **shall** display a storage indicator similar to the Dashboard's System Status card, showing disk usage (used/total with a color-coded bar) and the current size of the Bastyon staging directory.

### REQ-STG-2 — Clear Staging Action
When the user clicks the "Clear Staging" button in the Bastyon Uploader, the system **shall** ask for confirmation, then delete all files in the staging directory and remove all unfinished (non-published) drafts, since their local files are required to publish. Orphaned staging files with no matching draft **shall** always be removed.

### REQ-STG-3 — Staging Outside Tmp
The system **shall** keep Bastyon downloads in `data/bastyon-staging/` so the Dashboard's "Clear Tmp" action never destroys pending drafts, and so the staging indicator can report its size independently.

## 7. Progress Reporting

### REQ-PRG-1 — Download Progress
When a download is running in the Bastyon Uploader, the system **shall** stream progress to the client via Server-Sent Events (SSE), following the existing transfer-progress pattern.

### REQ-PRG-2 — Publish Progress
When a publish is running, the system **shall** stream progress (trim → PeerTube auth → upload → broadcast) to the client via SSE so the user sees live status.

## 8. Borrowed Logic

### REQ-BOR-1 — Function Parity
The system **shall** port the following from `bastyon-poster-linux` to the Node.js server, preserving behavior: WIF parsing / Base58Check / address derivation, ECDSA signing (DER for transactions, recoverable for PeerTube auth), post payload building & content hashing, transaction assembly & serialization, UTXO selection, RPC client, PeerTube token/channel/upload logic, and yt-dlp metadata download.

### REQ-BOR-2 — Test Parity
The ported crypto/transaction/payload modules **shall** be covered by unit tests using the same test vectors as the Python project (`bastyon-poster-linux/tests/test_crypto.py`, `test_transaction.py`, `test_payload.py`) so the port is verifiably correct.

### REQ-BOR-3 — Audio Selection Parity
The audio-format selector and `lang` sort behavior **shall** follow the approach proven in `tinnitus-sound-therapy` (`audioFormatSelector` in `AppSettingsRepository.kt`): original-track default, `[language^=code]` filter for chosen languages, `[format_id!*=drc]` exclusion, and a plain `bestaudio` final fallback.

### REQ-BOR-4 — Trim Parity
The video trimming behavior **shall** port `trim_video` from `bastyon-poster-linux/src/video_edit.py` (ffmpeg `-ss`/`-to` stream-copy with re-encode fallback).
