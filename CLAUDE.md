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

## Session Log Protocol
At the end of every session, before closing:
1. Update `SESSION_LOG.md` in the project root with:
   - Session number and status (Complete / Partial / Blocked)
   - Date
   - Branch name
   - What was built
   - Test results
   - Known issues or next steps
2. Commit SESSION_LOG.md directly to the feature branch
3. Then merge the feature branch to main and push

Never close a session without updating the session log first.

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
    ├── job_summary.html    # Human-readable formatted summary (browser preview)
    └── job_summary.pdf     # Printable/shareable version generated with jsPDF
```
PDF generation uses the jsPDF library (loaded via CDN in the side panel).
All three files are generated and uploaded in the same Save to Drive operation.
Never generate files partially — all three must succeed or none are saved.

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

---

## Current Status — V1 Monetisation Build (as of Session 50)

### Version strategy
- **V1 (current):** "Bring Your Own Key" — AI features gated behind Pro status. Pro = at least one API key saved OR a valid licence key stored. Users pay $4.99/month via Lemon Squeezy for a licence key. No backend required.
- **V2 (future):** Backend-hosted AI via Cloud Run. Users pay you; you pay AI providers. Credit-based tiers.

### Free vs Pro features
- **Free (no gate):** Scraping (LinkedIn, Indeed, generic), Save to Drive (JSON/HTML/PDF/Google Doc), Dashboard, duplicate detection, bulk actions, all folder management
- **Pro (gated):** Evaluate Fit, Prepare Package (all modes), Academic Package, Auto-enrichment (enrichCompanyMetadata)

### Pro gate implementation (Session 48)
- `isProUser()` in `utils/helpers.js` — returns true if any API key OR `LICENCE_VALID` is set
- `STORAGE_KEYS.LICENCE_KEY` and `STORAGE_KEYS.LICENCE_VALID` added to helpers.js
- Upgrade banner in sidepanel — shown when free user clicks gated button
- Pro/Free badge in sidepanel header
- `handleEvaluate()`, `handlePreparePackage()`, `enrichCompanyMetadata()` all gated

### Licence key in Settings (Session 49)
- "JobLink Pro" section added to setup.html (above Default AI Model)
- Shows Pro/Free badge and status description
- Licence key input + Activate button (V1: accepts any key, stores LICENCE_VALID=true)
- Revoke link to remove licence key
- `refreshProSection()`, `handleActivateLicence()`, `handleRevokeLicence()` in setup.js
- Lemon Squeezy checkout URL constant: `LEMON_SQUEEZY_CHECKOUT_URL` (placeholder, update when live)

### Google OAuth verification (Session 50)
- Repo made public, GitHub Pages enabled
- Homepage: https://dannem.github.io/joblink/
- Privacy policy: https://dannem.github.io/joblink/privacy.html
- Google Search Console: domain ownership verified for dannem.github.io
- Google Auth Platform: branding verified and published, all 6 scopes configured
- Verification request submitted — PENDING GOOGLE REVIEW (2-4 weeks)

### Remaining V1 sessions
| Session | Goal | Status |
|---|---|---|
| 51 | Manifest + permissions cleanup — remove console.log statements exposing job data, write permissions justification document | ✅ Complete |
| 52 | README + store description — README.md, Chrome Web Store short/long description | ✅ Complete |
| 53 | Store assets — screenshots (1280×800), promo tile (440×280), marquee banner (1400×560) | ✅ Complete |
| 54 | Onboarding polish — first-run experience, free/Pro empty state messaging | ✅ Complete |
| 55 | Error handling audit — plain-English errors, Drive error handling, clean profile test | ✅ Complete |
| 56 | Lemon Squeezy setup — create product, enable licence keys, replace placeholder checkout URL in setup.js and sidepanel.html | ✅ Complete |
| 57 | Final end-to-end test — free flow, Pro flow, upgrade prompt, licence key, clean profile | 🔜 Next |
| 58 | Submit to Chrome Web Store — developer account ($5), zip package, fill listing, submit | ⬜ Pending |
| 59 | Production OAuth client — new client ID scoped to published extension store ID | ⬜ Pending |
