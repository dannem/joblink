# JobLink Development Log

Planning and session coordination: Claude.ai conversation "JobLink Dev Sessions"
All architecture decisions, feature planning, and session prompts are recorded there.

---

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
- Part 1 (Chrome extension update): Jobs now save into a Preparation subfolder. All three status subfolders (Preparation, Submitted, Rejected) are created automatically on first save. Folder IDs cached in chrome.storage.sync. New constants added to helpers.js. New getOrCreateNamedFolder() in drive-api.js. New ensureStatusFolders() in service-worker.js.
- Part 2 (Flask dashboard): Standalone Python/Flask web app in dashboard/ folder. Auto-discovers the root Drive folder by searching for the Preparation/Submitted/Rejected subfolder structure — no manual configuration needed. Reads all jobs from all three status folders. Jobs list page with title, company, location, formatted date, and colour-coded status badge. Job detail page with full description, status, source, link to original posting, and AI provider selector (Claude/GPT-4o/Gemini — UI only, wired up in Session 11). Status correctly derived from which Drive subfolder the job lives in. Date formatted as "Feb 23, 2026 at 11:24 PM". Modular structure: config.py, drive_service.py, routes.py, app.py, templates/, static/. credentials.json and token.json excluded from git.
Test results: Dashboard running at localhost:5000. Job list displays correctly. Job detail displays correctly with proper date formatting and status badge. Auto-discovery of Drive folder confirmed working.
Known issues: None.
Next steps: Session 11 — wire up AI tailoring (Claude API first, then GPT-4o and Gemini).

---

Session 20 — Complete
Date: 2026-02-25
Branch: feature-duplicate-check
What was built:
Duplicate application check — when a job loads in the side panel, the extension now searches all
three status subfolders (Preparation, Submitted, Rejected) in Google Drive for a folder matching
the current job's sanitised name, and surfaces a warning banner if a match is found.

Files changed:
- drive/drive-api.js: Added checkExistingApplication(accessToken, job).
  Reads PREPARATION_FOLDER_ID, SUBMITTED_FOLDER_ID, and REJECTED_FOLDER_ID from chrome.storage.sync
  in parallel. For each non-empty folder ID, searches Drive for a child folder whose name matches
  sanitiseFolderName(job.company, job.jobTitle). Searches all three concurrently, then returns the
  highest-severity match (Submitted > Rejected > Preparation) as { status, folder }, or null if
  no match is found.
- sidepanel/sidepanel.html: Added #msg-duplicate banner between .job-meta and .fields.
  Hidden by default via inline style="display: none;".
- sidepanel/sidepanel.css: Added .msg--duplicate (amber, for Preparation matches) and
  .msg--duplicate-serious (red, same palette as .msg--error, for Submitted/Rejected matches).
- sidepanel/sidepanel.js:
  - Added msgDuplicate DOM reference.
  - Added checkDuplicate(job) async function: gets an OAuth token non-interactively, calls
    checkExistingApplication, then updates the banner and conditionally disables the Evaluate Fit
    button. Errors are non-fatal and logged to console only.
  - showJob(): resets the duplicate banner and calls checkDuplicate(job) in the background.
  - handleClear(): hides the duplicate banner and re-enables Evaluate Fit on clear.

Behaviour:
  - Preparation match → amber banner "Already in Preparation: "[folder name]""; Evaluate Fit enabled.
  - Submitted/Rejected match → red banner "Already in Submitted/Rejected: "[folder name]""; Evaluate
    Fit disabled.
  - No match or Drive not reachable → no banner shown; no disruption to normal flow.

Test results: Manual testing required.
  1. Reload the extension in chrome://extensions.
  2. Save a job to Drive (it will land in Preparation by default).
  3. Navigate back to the same job posting and open the side panel.
  4. Confirm an amber banner appears: "Already in Preparation: "[Company] - [Job Title]"".
  5. Confirm the Evaluate Fit button is still enabled.
  6. Manually move the Drive folder to Submitted, then reload the side panel on the same job.
  7. Confirm a red banner appears and the Evaluate Fit button is disabled.
  8. Confirm the Clear button hides the banner and re-enables Evaluate Fit.
  9. Open a new job that has not been saved — confirm no banner appears.
Known issues: None.
Next steps: Manual end-to-end test. If passing, merge to main.

---

Session 19 — Complete
Date: 2026-02-25
Branch: feature-evaluate-fit-profile
What was built:
Integrated candidate profile reading from Google Drive into the Evaluate Fit flow.
handleEvaluate() previously called buildEvaluatePrompt with no profile text; it now
reads the user's My_Profile Drive folder first and passes the content to the prompt.

- drive/drive-api.js: new readProfileFromDrive(accessToken, rootFolderId) function.
    Step 1: searches rootFolderId for a subfolder named 'My_Profile'.
    Step 2: lists up to 20 non-trashed files inside that folder.
    Step 3: reads each file — Google Docs are exported as plain text via the Drive
      export endpoint; .txt files are downloaded directly via alt=media. PDF and DOCX
      are skipped (binary formats, future work). Each readable file is prefixed with
      its filename as a header and joined with double newlines.
    Throws descriptive errors if My_Profile folder is absent or no readable files exist.

- utils/ai-helpers.js: buildEvaluatePrompt(job, profileText) updated to accept an
    optional second parameter. If profileText is truthy, the prompt includes the full
    profile text under a CANDIDATE PROFILE section. If absent/empty, the section reads
    "(No profile provided — evaluate based on job requirements alone)" so the AI still
    produces a useful result. Persona changed from "researcher/scientist" to a neutral
    expert career coach whose framing is driven by the profile content rather than
    hard-coded assumptions.

- sidepanel/sidepanel.js: handleEvaluate() updated. Before building the prompt, it now:
    1. Calls chrome.identity.getAuthToken({ interactive: false }) to get an OAuth token.
    2. Reads DRIVE_ROOT_FOLDER_ID from chrome.storage.sync.
    3. Calls readProfileFromDrive(token, rootFolderId) if both are available.
    The entire profile-fetch block is wrapped in a try/catch; any error is logged as a
    warning and profileText stays empty — evaluation still proceeds with the no-profile
    prompt so the feature degrades gracefully.

- sidepanel/sidepanel.html: added <script src="../drive/drive-api.js"></script> before
    ai-helpers.js. Pre-load safety check confirmed: drive-api.js contains NO importScripts
    call (importScripts is only in background/service-worker.js). The file uses only
    fetch() and const declarations — safe to load in any extension page context.

Script load order in sidepanel.html is now:
  helpers.js → drive-api.js → ai-helpers.js → jspdf.umd.min.js → sidepanel.js

Known issues:
  - PDF and DOCX files in My_Profile are silently skipped. Only Google Docs and .txt
    files are read. Users should store their CV as a Google Doc or plain text file.
  - Profile load failure is non-fatal and logged to the console; the user sees no
    explicit warning in the UI (acceptable for personal-use tool).
Test results: Manual testing required.
  1. Create a My_Profile folder inside the configured root Drive folder.
  2. Add a Google Doc or .txt file with your CV/profile text.
  3. Capture a job, click Evaluate Fit.
  4. Confirm the AI response references details from the profile (not a generic response).
  5. Remove My_Profile or rename it, click Evaluate Fit again — confirm evaluation still
     runs (graceful degradation) with a console warning but no crash.
Next steps: Manual end-to-end test. Future: surface a UI hint when profile load fails;
add PDF support via pdf.js or a service worker handler.

---

Session 18 — Complete
Date: 2026-02-25
Branch: feature-evaluate-fit
What was built:
End-to-end wiring of the Evaluate Fit button in the side panel.

- utils/helpers.js: added ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY to both
  STORAGE_KEYS and DEFAULT_STORAGE (empty string defaults).

- setup/setup.html: added "AI Provider Keys" section before the Complete Setup button,
  with three labelled password inputs (anthropic-key, openai-key, gemini-key) and
  placeholders (sk-ant-..., sk-..., AIza...).
- setup/setup.css: added .api-key-group and .api-key-input styles to match the existing
  form visual language (border, radius, focus ring).
- setup/setup.js: handleSaveSetup() now reads and saves the three key inputs before
  marking setup complete (only writes non-empty values to avoid overwriting stored keys
  with blank strings). showSetupForm() fires an async IIFE that pre-fills the inputs with
  any previously stored keys (masked, type=password).

- utils/ai-helpers.js (new file): plain globals, no import/export.
    AI_MODELS: claude-sonnet-4-6, gpt-4o, gemini-1.5-flash.
    buildEvaluatePrompt(job): builds a structured prompt for a researcher/scientist
      candidate. Returns raw JSON instructions and job details. Profile text not yet
      integrated — prompt uses a general researcher/scientist persona (placeholder).
    callAnthropicAPI(apiKey, prompt): POST to Anthropic Messages API with
      anthropic-dangerous-direct-browser-access header for browser context.
    callOpenAIAPI(apiKey, prompt): POST to OpenAI Chat Completions API.
    callGeminiAPI(apiKey, prompt): POST to Gemini generateContent API (gemini-1.5-flash).
    parseAIResponse(text): strips markdown fences, parses JSON, falls back to regex
      {...} extraction; returns null on failure.
    callAI(provider, prompt): reads the right key from chrome.storage.sync via
      getStorageValue(), dispatches to the correct API caller, throws a descriptive
      error if the key is missing.

- sidepanel/sidepanel.js: added DOM references for all AI evaluation elements
  (btnDashboard, aiProvider, btnEvaluate, aiSpinner, aiError, aiResults,
  fitScoreNumber, aiCorrespondence, aiDiscrepancies, aiRecommendation). Added event
  listeners for btnEvaluate, btnDashboard, and collapsible section toggles. Added
  handleEvaluate() async function: shows spinner, calls buildEvaluatePrompt + callAI +
  parseAIResponse, populates the score (colour-coded: ≥70 green, ≥40 amber, <40 red)
  and the three collapsible text sections, handles errors in the ai-error banner.

- sidepanel/sidepanel.html: added <script src="../utils/ai-helpers.js"></script>
  between helpers.js and jspdf, ensuring STORAGE_KEYS and getStorageValue are available
  when ai-helpers.js loads.

Known issues:
  - dashboard/dashboard.html does not exist on this branch; the Open Dashboard button
    opens a blank page. Acceptable for now — dashboard SPA is on feature-fit-and-generate
    and will be merged in a future consolidation session.
  - buildEvaluatePrompt uses a generic researcher/scientist persona. Profile text
    integration (reading the user's CV from Drive) is deferred to a future session.

Test results: Manual testing required.
  1. Open Settings, add at least one API key, save.
  2. Capture a job from LinkedIn or Indeed.
  3. Select a provider and click Evaluate Fit.
  4. Confirm spinner shows, result populates with score and three collapsible sections.
  5. Confirm collapsible toggles expand/collapse correctly.
  6. Test missing-key error: clear the key, click Evaluate Fit, confirm error banner.
Next steps: Manual end-to-end test. Future: integrate profile text into prompt; merge
dashboard SPA from feature-fit-and-generate.

---

Session 17 — Complete
Date: 2026-02-25
Branch: feature-linkedin-collections-selectors
What was built:
Targeted selector fix for linkedin.com/jobs/collections/recommended/?currentJobId=... layout,
based on live DOM inspection results.

Pre-change audit of content-scripts/linkedin.js confirmed:
- Company: a[href*="/company/"] was already present in the array — no change needed.
- Description: .jobs-box__html-content was already present in descSelectors — no change needed.
- Location: .artdeco-entity-lockup__caption was absent — added as a new fallback entry.

Change made:
- content-scripts/linkedin.js — extractLocation(): appended
  '.artdeco-entity-lockup__caption' to the end of bulletSelectors. Confirmed via live DOM
  inspection to return 'Philadelphia, PA · Hybrid' (or similar) on the collections layout.
  Added after all existing entries so it does not affect the /jobs/search/ split-panel layout.

All existing selectors retained.

Test results: Selector confirmed working via live DOM inspection on /jobs/collections/recommended/
layout. Full manual test required:
  1. Navigate to linkedin.com/jobs/collections/recommended/ and select a job.
  2. Open the side panel and confirm the location field populates (e.g. 'Philadelphia, PA · Hybrid').
  3. Also verify /jobs/search/ split-panel layout still works correctly.
Known issues: None.
Next steps: Manual end-to-end test on both layouts. If passing, merge to main.

---

Session 16 — Complete
Date: 2026-02-25
Branch: feature-sidepanel-script-fix
What was built:
Fixed a script loading crash that caused the side panel to show the empty state on every open,
even when already on a job page.

Root cause analysis:
Session 15 added <script src="../drive/drive-api.js"></script> and
<script src="../utils/ai-helpers.js"></script> to sidepanel.html. drive-api.js is designed
for and loaded by the service worker — loading it as a plain <script> tag in an extension
page is architecturally incorrect and was causing a runtime error that prevented sidepanel.js
from executing at all, including the DOMContentLoaded handler responsible for the session
storage restore and the REQUEST_SCRAPE flow.

Fix:
- sidepanel/sidepanel.html: removed <script src="../drive/drive-api.js"></script> entirely.
  Drive API functions required by the side panel (readProfileText, uploadFileToDrive) must be
  accessed via chrome.runtime.sendMessage to the service worker, not by loading drive-api.js
  directly.
- sidepanel/sidepanel.html: removed <script src="../utils/ai-helpers.js"></script>. Confirmed
  that the current sidepanel.js makes no direct calls to any ai-helpers.js functions (callAI,
  buildEvaluatePrompt, extractJson, readProfileText). The tag will be re-added in the session
  that wires up handleEvaluate, with correct load order: helpers.js → ai-helpers.js →
  jspdf.umd.min.js → sidepanel.js.

The Evaluate Fit UI elements (button, provider select, results section) remain in the HTML from
Session 15 but are non-functional until sidepanel.js is updated to wire them up. This is
intentional — the priority here is restoring the panel's core functionality.

Test results: Manual testing required.
  1. Reload the extension in chrome://extensions.
  2. Navigate to a LinkedIn or Indeed job page.
  3. Open the side panel — confirm it populates with job data immediately.
  4. Confirm no console errors on load.
Known issues: Evaluate Fit button is visible but non-functional (no handler in sidepanel.js yet).
Next steps: Wire up handleEvaluate in sidepanel.js with service-worker message passing for
Drive reads/writes, and re-add ai-helpers.js script tag in correct load order.

---

Session 15 — Complete
Date: 2026-02-25
Branch: feature-restore-evaluate-ui
What was built:
Restored the Evaluate Fit UI to the side panel. The JS in sidepanel.js already referenced all
AI/evaluate elements by ID; the HTML and CSS were simply missing.

- sidepanel/sidepanel.html: inside #state-job, after the msg-error div, added:
    - #btn-dashboard (Open Dashboard button)
    - .ai-section containing:
        - .ai-controls row: #ai-provider select (Claude / GPT-4o / Gemini) + #btn-evaluate button
        - #ai-spinner loading indicator
        - #ai-error inline error message
        - #ai-results panel: fit-score-card, three collapsible sections (Correspondence,
          Discrepancies, Recommendation each with their p#ai-* element), and
          #ai-dashboard-link deep-link anchor
  Also added two script tags before </body>: ../utils/ai-helpers.js and ../drive/drive-api.js,
  which sidepanel.js depends on for callAI(), extractJson(), buildEvaluatePrompt(),
  readProfileText(), uploadFileToDrive(), and getAuthToken().
- sidepanel/sidepanel.css: appended all AI section styles — .ai-section, .ai-controls,
  .ai-provider-select, .ai-spinner, .ai-results, .fit-score-card, score colour modifiers
  (.score-green/.score-amber/.score-red), collapsible toggle/body/arrow, .dashboard-link.

Test results: Manual testing required.
  1. Reload the extension in chrome://extensions.
  2. Capture a job from LinkedIn or Indeed.
  3. Confirm the Evaluate Fit button and provider selector appear below the Save/Clear row.
  4. Add an API key in Settings, click Evaluate Fit, verify the fit score and collapsible
     sections render and expand correctly.
  5. Confirm Open Dashboard opens the dashboard SPA.
Known issues: None.
Next steps: Manual end-to-end test. If passing, merge to main.

---

Session 14 — Complete
Date: 2026-02-25
Branch: feature-linkedin-selector-fix
What was built:
Selector regression fix for linkedin.com/jobs/collections/recommended/?currentJobId=... layout.
On this layout company, location, and description were all returning empty because the existing
selectors were written for the /jobs/search/ split-panel layout only.

- content-scripts/linkedin.js — extractLocation(): prepended two new selectors to bulletSelectors
  targeting the collections layout's primary-description-without-company and
  primary-description .tvm__text:first-child variants.
- content-scripts/linkedin.js — extractDescription(): prepended three new selectors to descSelectors
  covering .jobs-description-content__text--stretch (stretched variant),
  .jobs-box__html-content .jobs-description-content__text, and
  .job-details-about-the-job-module__description (already present but moved to higher priority).
- content-scripts/linkedin.js — scrapeLinkedInJob() company array: prepended five new selectors
  targeting .job-details-jobs-unified-top-card__company-name (bare class), [class*="topcard__org-name"],
  .jobs-premium-applicant-insights__header a, .job-details-jobs-unified-top-card__primary-description a,
  and the generic a[href*="/company/"] anchor fallback.
- content-scripts/linkedin.js — removed the temporary DEBUG logging block from the entry-point
  setTimeout (the block between --- DEBUG --- and --- END DEBUG --- comments).

All existing selectors retained; changes are additive prepends only. No functions restructured.

Test results: Manual testing required.
  1. Navigate to linkedin.com/jobs/collections/recommended/ and select a job.
  2. Open the side panel and confirm company, location, and description all populate.
  3. Also verify the /jobs/search/ split-panel layout still works correctly.
Known issues: None.
Next steps: Manual end-to-end test on both layouts. If passing, merge to main.
