# yt2gd - Requirements

## Core Requirements
- **The system shall** provide a web-based interface for users.
- **The system shall** display real-time progress for downloads and uploads, including amount transferred, total size, and speed.
- **The system shall** display the current application version for both the client and the server on the UI.
- **The system shall** be built using Node.js as the backend and Vite for the frontend.
- **The system shall** require password authentication to access the main interface.

## Settings & Credentials
- **When** a user successfully logs in, **the system shall** allow them to access a settings interface.
- **The system shall** allow the user to input their Google Drive configuration and authorization details in the settings.
- **When** the user saves their settings, **the system shall** store this information persistently in a local file on the server.

## File Processing
- **The system shall** provide an input field for the user to submit a URL to a file.
- **When** a raw media URL (e.g., `googlevideo.com`) or direct file URL is submitted, **the system shall** download the file to the remote server's local storage using a robust dedicated downloader library, automatically handling multi-connection chunking, retries, and large files (1GB+).
- **When** a standard YouTube page URL (e.g., `youtube.com/watch`) is submitted, **the system shall** utilize `yt-dlp` to process the URL, allowing the user to select the desired format (Video/Audio) and quality.
- **The system shall** automatically manage the `yt-dlp` binary, downloading the correct executable for the host OS (Linux/Windows) and ignoring it in version control.
- **The system shall** allow the user to upload browser cookies (`cookies.txt`) via the interface to authenticate `yt-dlp` and bypass restrictions.

## Google Drive Upload
- **When** the file download is complete, **the system shall** determine the current date formatted as "Month_Day" (e.g., "May_1").
- **The system shall** ensure a root folder named "yt2gd" exists in the user's connected Google Drive.
- **The system shall** ensure a subfolder with the formatted date exists within the "yt2gd" folder.
- **The system shall** upload the downloaded file into the respective date subfolder on Google Drive.
- **When** the upload is successfully completed, **the system shall** remove the temporary downloaded file from the server.

## Live Stream Support
- **When** the user enables "Live Stream Mode", **the system shall** utilize specific `yt-dlp` flags (`--live-from-start`, `--no-part`, `--wait-for-video`) to download recently ended live streams.
- **The system shall** allow the user to choose between audio and video formats for live stream downloads.
