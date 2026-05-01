# yt2gd - Requirements

## Core Requirements
- **The system shall** provide a web-based interface for users.
- **The system shall** be built using Node.js as the backend and Vite for the frontend.
- **The system shall** require password authentication to access the main interface.

## Settings & Credentials
- **When** a user successfully logs in, **the system shall** allow them to access a settings interface.
- **The system shall** allow the user to input their Google Drive configuration and authorization details in the settings.
- **When** the user saves their settings, **the system shall** store this information persistently in a local file on the server.

## File Processing
- **The system shall** provide an input field for the user to submit a URL to a file.
- **When** a URL is submitted, **the system shall** download the file from the URL to the remote server's local storage.

## Google Drive Upload
- **When** the file download is complete, **the system shall** determine the current date formatted as "Month_Day" (e.g., "May_1").
- **The system shall** ensure a root folder named "yt2gd" exists in the user's connected Google Drive.
- **The system shall** ensure a subfolder with the formatted date exists within the "yt2gd" folder.
- **The system shall** upload the downloaded file into the respective date subfolder on Google Drive.
- **When** the upload is successfully completed, **the system shall** remove the temporary downloaded file from the server.
