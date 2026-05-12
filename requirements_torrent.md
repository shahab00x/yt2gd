# Torrent Support Requirements

## Overview
Add the capability to download content via magnet links, package them into a ZIP file, and upload the resulting archive to Google Drive.

## Requirements (EARS)

- **When** a user submits a valid magnet link, the **system** shall identify it as a torrent download.
- **When** a torrent download is initiated, the **system** shall download all files associated with the magnet link into a temporary directory.
- **When** a torrent download is active, the **system** shall provide real-time progress updates (percentage, speed, peer count) to the frontend.
- **When** the torrent download completes, the **system** shall compress the downloaded files into a single `.zip` archive.
- **When** the ZIP archive is created, the **system** shall upload it to the user's Google Drive using the existing upload pipeline.
- **When** the upload to Google Drive completes (successfully or with an error), the **system** shall delete both the temporary torrent files and the generated ZIP archive.
- **When** the ZIP archive is created, the **system** shall use the torrent's display name as the base filename for the archive.
- **When** a torrent download is initiated in folder mode and exceeds the configured batch size, the **system** shall divide the download into sequential batches.
- **When** a batch download is initiated, the **system** shall allow the user to specify a starting batch index.
- **When** a batch upload fails due to network errors, the **system** shall attempt to retry the upload for the specific batch.
- **When** a batch completes, the **system** shall provide an option to resume the next batch or wait for user confirmation.
