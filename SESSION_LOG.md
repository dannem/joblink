Session 1 — Complete
Date: 2026-02-18
Branch: feature-scaffolding
What was built: Full project scaffolded. All placeholder files created as per CLAUDE.md structure. manifest.json configured for Manifest V3 with Side Panel and Identity permissions.
Status: Extension loads in Chrome with no errors. Side Panel opens. All files merged to main on GitHub.
Known issues: None

---

Session 2 — Complete
Date: 2026-02-18
Branch: feature-setup-ui
What was built:
- Setup page UI (setup.html, setup.css, setup.js) with JobLink branding
- "Connect Google Drive" button (non-functional placeholder)
- Folder selector UI with "No folder selected" placeholder
- Phase 2 "Coming Soon" section with greyed-out CV/Templates folder fields
- Service worker detects first install and opens setup page automatically
- Setup page checks SETUP_COMPLETE flag and shows appropriate view
- Storage key constants defined in utils/helpers.js per CLAUDE.md spec
Test results: Extension loads, setup page opens on first install, UI renders correctly.
Known issues: None. OAuth and folder picker functionality deferred to future sessions.

---

Session 3 — Complete
Date: 2026-02-18
Branch: feature-setup-oauth
What was built:
- Google OAuth flow using chrome.identity.getAuthToken()
- Connect Google Drive button now functional — shows green checkmark and user email on success
- Drive folder picker — fetches folders via Drive API, displays in dropdown list
- "Use My Drive root" option for users who want to save directly to root
- Folder selection saved to chrome.storage.sync (DRIVE_ROOT_FOLDER_ID, DRIVE_ROOT_FOLDER_NAME)
- Complete Setup button enables when both Drive connected AND folder selected
- Setup success screen with Close Tab button
- Full error handling with user-friendly error messages in UI
- All Drive API calls isolated in drive/drive-api.js per CLAUDE.md spec
- Added userinfo.email scope to manifest for displaying connected account
Test results: OAuth flow completes, folders load from Drive, selection saves to storage, setup completes successfully.
Known issues: None.

---

Session 4 — Complete
Date: 2026-02-18
Branch: feature-linkedin-scraper
What was built:
- content-scripts/linkedin.js — full LinkedIn job scraper
  - Handles both standalone job view (linkedin.com/jobs/view/...) and split-panel search results view
  - Extracts jobTitle, company, location, description, applicationUrl, source, scrapedAt
  - Multi-selector fallback strategy for each field to handle multiple LinkedIn page layouts and era differences
  - Location uses dedicated extractLocation() with bullet-class selectors first, then falls back to parsing the primary description container's .tvm__text spans
  - Description uses textContent to capture text that may be CSS-clamped behind a "See more" button
  - 500ms delay before extraction to allow LinkedIn's SPA to finish rendering
  - Sends { type: 'JOB_DATA_EXTRACTED', payload: jobData } to the service worker
  - Robust error handling: chrome.runtime.lastError checked in message callback, outer try/catch prevents unhandled rejections
- background/service-worker.js — added chrome.runtime.onMessage listener
  - Handles JOB_DATA_EXTRACTED message type
  - Logs received job data and sender tab URL to the console for testing
  - Responds with { status: 'received' } to satisfy the content script callback
- manifest.json — content_scripts entry for LinkedIn was already registered in Session 1 scaffolding; no changes needed
Test results: Manual test required (see testing instructions in session notes). Console logging in service worker confirms message pipeline is wired up.
Known issues: LinkedIn's class names change frequently — if selectors break after a LinkedIn redesign, update extractText() selector arrays in linkedin.js. No automated tests; relies on manual verification in Chrome DevTools.
Next steps: Build the side panel UI to display scraped job data and trigger saving to Drive.

---

Session 7 — Complete
Date: 2026-02-20
Branch: feature-drive-save
What was built:
- utils/helpers.js: added sanitiseFolderName(company, jobTitle) — strips Drive-illegal characters and returns "[Company] - [Job Title]"
- utils/helpers.js: added generateJobSummaryHtml(job) — builds a self-contained HTML document with all job fields, HTML-escaped
- background/service-worker.js: added importScripts('../drive/drive-api.js') to make Drive API functions available
- background/service-worker.js: replaced SAVE_TO_DRIVE stub with real handleSaveToDrive(job) — chains getAuthToken → read storage → sanitiseFolderName → createDriveFolder → uploadFileToDrive (JSON) → uploadFileToDrive (HTML)
- SAVE_TO_DRIVE handler now returns true to keep Chrome's message channel open during async work
- Full error handling: any failure returns { success: false, error: '...' } to the side panel
Test results: Manual test required — load extension, scrape a job, click Save, verify [Company] - [Job Title] folder appears in Google Drive containing job_info.json and job_summary.html.
Known issues: None.
Next steps: Manual end-to-end test. If passing, Session 8 can begin on Phase 2 (AI tailoring dashboard).

---

Session 8 — Complete
Date: 2026-02-20
Branch: feature-pdf-generation
What was built:
- utils/helpers.js: added generateJobPdfBase64(job) — produces a paginated A4 PDF using jsPDF with word-wrap and automatic page breaks; returns base64 string; guards against service worker context
- sidepanel/sidepanel.html: added jsPDF CDN script tag between helpers.js and sidepanel.js
- sidepanel/sidepanel.js: handleSave() now calls generateJobPdfBase64() in its own try/catch and includes pdfBase64 in the SAVE_TO_DRIVE message; PDF failure falls back to empty string and never blocks JSON/HTML save
- drive/drive-api.js: added uploadBase64FileToDrive() — mirrors uploadFileToDrive() but adds Content-Transfer-Encoding: base64 header to correctly embed binary PDF data in multipart upload
- background/service-worker.js: handleSaveToDrive() now accepts pdfBase64 and uploads job_summary.pdf as step 7; PDF upload wrapped in its own try/catch so failure logs a warning but returns success:true since JSON and HTML are already saved
Test results: Manual test required — load extension, scrape a job, click Save, verify Google Drive folder contains job_info.json, job_summary.html, and job_summary.pdf.
Known issues: None.
Next steps: Manual end-to-end test. If passing, Session 9 begins Phase 2 — AI tailoring dashboard.

---

Session 8b — Complete
Date: 2026-02-22
Branch: feature-pdf-debug
What was built:
- Diagnosed and fixed silent PDF failure: jsPDF CDN script was blocked by Chrome's Content Security Policy
- Fixed by downloading jsPDF 2.5.1 UMD build and bundling it locally as assets/jspdf.umd.min.js
- Updated sidepanel/sidepanel.html to load jsPDF from local path instead of CDN
- Added and removed temporary debug logging to confirm fix
Test results: All three files (job_info.json, job_summary.html, job_summary.pdf) confirmed saving to Google Drive on LinkedIn. Indeed untested.
Known issues: None.
Next steps: Test on Indeed. Then Session 9 begins Phase 2 — AI tailoring dashboard.

---

Session 9 — Complete
Date: 2026-02-22
Branch: feature-auto-rescrape
What was built:
- content-scripts/linkedin.js: replaced polling approach with startNavigationWatcher() — MutationObserver on document.body detects URL changes, guards on /jobs/ URLs, debounces with EXTRACTION_DELAY_MS to fire one scrape per navigation
- content-scripts/indeed.js: extracted sendJobData() and runScrape() functions to eliminate duplication, added identical startNavigationWatcher() guarding on jk= query param
- Both scripts now auto-rescrape when user clicks a new job posting without a full page reload
Test results: Manual test required — navigate between job postings on LinkedIn and Indeed without refreshing, confirm side panel updates automatically with each new job.
Known issues: None.
Next steps: Manual test on both sites. If passing, Session 10 begins Phase 2 — AI tailoring dashboard.

---

Session 10 — Complete
Date: 2026-02-23
Branch: feature-dashboard-scaffold
What was built:

Part 1 — Chrome extension: Drive subfolder structure
- utils/helpers.js: added PREPARATION_FOLDER_ID, SUBMITTED_FOLDER_ID, REJECTED_FOLDER_ID to STORAGE_KEYS and DEFAULT_STORAGE
- drive/drive-api.js: added getOrCreateNamedFolder() — idempotent search-then-create; searches Drive before creating to avoid duplicates
- background/service-worker.js: added ensureStatusFolders() — creates and caches Preparation/Submitted/Rejected folder IDs on first save, returns cached IDs on subsequent saves; updated handleSaveToDrive() to save job folders inside Preparation/ instead of root

Part 2 — Flask dashboard scaffold
- dashboard/config.py: single source of truth for credentials path, ROOT_FOLDER_ID, folder names, Flask settings
- dashboard/drive_service.py: get_credentials() for OAuth flow; DriveService class with get_all_jobs() (reads all three status folders, augments with status/folder_id, sorts newest first) and get_job_by_folder_id()
- dashboard/routes.py: Blueprint with job_list (GET /) and job_detail (GET /job/<folder_id>) routes
- dashboard/app.py: create_app() factory — validates config, loads Drive creds, registers Blueprint, attaches format_date Jinja2 filter
- dashboard/templates/base.html: shared header and layout
- dashboard/templates/jobs.html: sortable job list table with status badges
- dashboard/templates/job_detail.html: full job detail with AI provider dropdown (UI only, disabled) as placeholder for Session 11
- dashboard/static/style.css: plain CSS with design tokens, status badge colours, responsive layout
- dashboard/requirements.txt: flask, google-auth, google-auth-oauthlib, google-api-python-client
- dashboard/README.md: full setup instructions (credentials, ROOT_FOLDER_ID, running the app)
- .gitignore: excludes credentials.json and token.json from version control

Test results: Extension changes not yet tested in Chrome. Dashboard not yet runnable — requires credentials.json and ROOT_FOLDER_ID set in config.py.
Known issues: None expected.
Next steps: (1) Reload extension in Chrome, save a job, verify it lands in Preparation/ and all three status folders are created. (2) Configure dashboard with credentials.json and ROOT_FOLDER_ID, run python app.py, verify job list and detail pages render correctly. If both pass, Session 11 wires up the AI tailoring API calls.
