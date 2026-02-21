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
- utils/helpers.js: added generateJobPdfBase64(job) — uses jsPDF to build a clean A4 PDF (title, company/location, date/source, URL, horizontal rule, description, footer) with automatic page-break handling; returns the base64 data string with no data-URI prefix. Guards against being called from a service worker (typeof window check).
- sidepanel/sidepanel.html: added jsPDF 2.5.1 UMD CDN script tag between helpers.js and sidepanel.js so window.jspdf is available when generateJobPdfBase64 is called.
- sidepanel/sidepanel.js: handleSave() now calls generateJobPdfBase64(jobToSave) before sending SAVE_TO_DRIVE. PDF errors are caught and logged; the message is still sent without pdfBase64 so JSON/HTML saves are never blocked by a PDF failure.
- drive/drive-api.js: added uploadBase64FileToDrive() — same multipart/related pattern as uploadFileToDrive() but adds Content-Transfer-Encoding: base64 to the file part so binary PDF bytes are not corrupted by string handling.
- background/service-worker.js: handleSaveToDrive() now accepts a pdfBase64 argument. Step 7 uploads job_summary.pdf via uploadBase64FileToDrive(); if pdfBase64 is empty or the upload throws, the error is logged as a warning and { success: true } is still returned (JSON and HTML are already saved at that point).
Test results: Manual test required — scrape a job, click Save, verify Google Drive folder contains job_info.json, job_summary.html, and job_summary.pdf.
Known issues: jsPDF's built-in Helvetica font covers Latin-1 only; characters outside that range (e.g. some emoji or CJK) will not render in the PDF. Acceptable for Phase 1.
Next steps: Phase 2 planning — AI tailoring dashboard.
