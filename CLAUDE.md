# Project: JobLink Chrome Extension

## Core Principles
**IMPORTANT**: This is a personal-use tool built for simplicity and reliability. All code must be:
- **Modular**: Scraping logic, Drive API logic, and UI logic must always be kept in separate files. Never mix these concerns.
- **Readable**: Prefer clear, simple code over clever code. This project is maintained via vibe coding — clarity is more important than brevity.
- **Stateless**: The extension has no backend server. All state lives either in `chrome.storage.sync` or in Google Drive. Never introduce a server dependency in Phase 1.
- **SOLID**: Whenever you write code, it MUST follow SOLID design principles. Never write code that violates these principles. If you do, you will be asked to refactor it.


## Development Workflow
1. Before making any changes, create and checkout a feature branch named `feature-[brief-description]`
2. Test all new functionality manually in Chrome before committing (load the extension via `chrome://extensions` in Developer Mode)
3. Write detailed commit messages explaining what changed and why
4. Commit all changes to the feature branch at the end of every working session
5. Never break a working feature to add a new one — if a session goes wrong, roll back and start fresh

## Architecture Overview
- **Extension Framework**: Chrome Manifest V3
- **Language**: Vanilla JavaScript (no frameworks, no TypeScript, no build tools)
- **UI**: Plain HTML + CSS for Side Panel and Setup Page
- **Authentication**: Chrome Identity API (Google OAuth 2.0)
- **Storage (settings)**: `chrome.storage.sync` for user preferences and folder IDs
- **Storage (data)**: Google Drive REST API — all job data lives in the user's own Drive
- **File formats**: JSON for structured job data, HTML for human-readable job summaries
- **Phase 2 additions**: Vanilla JS web app (PWA-ready), Anthropic Claude API for AI tailoring

## Project Structure
```
joblink/
├── manifest.json                  # Extension configuration and permissions
├── CLAUDE.md                      # This file
├── background/
│   └── service-worker.js          # Handles install events, OAuth token management
├── content-scripts/
│   ├── linkedin.js                # LinkedIn-specific scraping logic only
│   └── indeed.js                  # Indeed-specific scraping logic only
├── sidepanel/
│   ├── sidepanel.html             # Side panel markup
│   ├── sidepanel.css              # Side panel styles
│   └── sidepanel.js               # Side panel UI logic only
├── setup/
│   ├── setup.html                 # First-run setup page markup
│   ├── setup.css                  # Setup page styles
│   └── setup.js                   # Setup page logic only
├── drive/
│   └── drive-api.js               # All Google Drive API calls live here and nowhere else
├── utils/
│   └── helpers.js                 # Shared utility functions (sanitisation, formatting, etc.)
└── assets/
    └── icons/                     # Extension icons (16, 48, 128px)
```

## Code Standards
- **No frameworks**: Do not introduce React, Vue, or any frontend framework. Plain JS only.
- **No build tools**: Do not introduce Webpack, Vite, Babel, or TypeScript compilation. The extension must run as-is from the source files.
- **No external libraries in Phase 1** unless strictly necessary. If a library is needed, note it explicitly and explain why vanilla JS cannot do the job.
- **Module separation is strict**: `linkedin.js` and `indeed.js` contain only DOM parsing logic and return a plain JS object. They never call the Drive API directly. `drive-api.js` never touches the DOM.
- **Error handling is mandatory**: Every Drive API call and every OAuth call must have a catch block. Errors must be surfaced to the user in the UI, never silently swallowed.
- **Chrome storage keys**: All `chrome.storage.sync` keys must be defined as constants in `helpers.js`. Never use raw strings as storage keys elsewhere in the code.

## Settings Architecture
The setup page captures and stores the following in `chrome.storage.sync`:

```js
{
  DRIVE_ROOT_FOLDER_ID: "",      // ID of the user's chosen root jobs folder — Phase 1
  DRIVE_CV_FOLDER_ID: "",        // ID of the CV/templates folder — reserved for Phase 2
  DRIVE_TEMPLATES_FOLDER_ID: "", // ID of other application materials — reserved for Phase 2
  SETUP_COMPLETE: false          // Flag to determine whether to show setup on launch
}
```
Phase 2 fields must exist as empty strings from the start. The setup UI shows them as "Coming soon" and does not allow editing yet.

## Scraper Output Format
Both `linkedin.js` and `indeed.js` must return a plain JS object in exactly this shape:

```js
{
  jobTitle: "",
  company: "",
  location: "",
  description: "",
  applicationUrl: "",
  source: "linkedin" | "indeed",
  scrapedAt: ""   // ISO 8601 timestamp
}
```
If a field cannot be extracted, it must return an empty string — never `null` or `undefined`.

## Google Drive File Organisation
```
[User's chosen root folder]/
└── [Company] - [Job Title]/
    ├── job_info.json       # Structured job data (the scraper output object)
    └── job_summary.html    # Human-readable formatted summary
```
Folder and file names must be sanitised to remove characters that Drive does not allow.

## Quality Gates
- The extension must load in Chrome without errors in the console before any commit
- All five scraped fields must be populated for a session to be considered passing
- OAuth flow must complete without errors on a clean install
- The Drive folder and files must appear correctly after every "Save to Drive" action
- No console errors on any user action in normal operation

## Key Constraints
- **No automatic form submission**: The tool prepares and organises data only. It never submits applications on the user's behalf.
- **No scraping navigation**: The content scripts only read the currently active, already-loaded page. They never navigate, click, or paginate.
- **Minimal Drive permissions**: Use the `drive.file` scope only. The extension must never request access to the user's entire Drive.
- **Setup runs once**: The setup page opens automatically on first install only. It is accessible afterward via a settings icon in the side panel.

## Session Log Protocol
At the start of every Claude Code session, paste the following context block before your task:

> "We are building a Chrome extension called JobLink using Manifest V3 and vanilla JavaScript. It scrapes job postings from LinkedIn and Indeed, shows them in a Chrome Side Panel for review, then saves a JSON and HTML file to a user-configured Google Drive folder. Code is strictly modular — scraping, Drive API, and UI logic are always in separate files. No frameworks, no build tools, no backend server. Here is what was completed in the last session: [paste your session notes]. Today's task: [your task]."
