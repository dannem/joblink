# JobLink Development Log

Planning and session coordination: Claude.ai conversation "JobLink Dev Sessions"
All architecture decisions, feature planning, and session prompts are recorded there.

---

Session 50 — Complete
Date: 2026-03-08
Branch: main
What was built:
OAuth consent screen configuration and Google verification request submission.
No code changes to the extension itself.

GitHub
- Repository made public (required for GitHub Pages on free plan)
- GitHub Pages enabled — branch: main, folder: / (root)
- Created index.html — simple JobLink homepage with privacy policy link
- Added Google Search Console HTML verification file (googleedd1bb122087d778.html)
- Privacy policy live at: https://dannem.github.io/joblink/privacy.html
- Homepage live at: https://dannem.github.io/joblink/

Google Search Console
- Property added: https://dannem.github.io/joblink/ (URL prefix type)
- Ownership verified via HTML file method

Google Auth Platform (replaces old OAuth consent screen UI)
- App name: JobLink
- Support email: dannem@gmail.com
- Homepage: https://dannem.github.io/joblink/
- Privacy policy: https://dannem.github.io/joblink/privacy.html
- Authorised domain: dannem.github.io
- App logo: icon128.png uploaded
- Branding verified and published
- All 6 scopes configured: userinfo.email, drive.file, drive.metadata.readonly,
  drive.readonly, drive, documents
- Scope justifications written and submitted for all restricted/sensitive scopes
- Feature type: Drive productivity
- Demo video: https://youtu.be/05D_ylIW1uM
- Verification questionnaire completed (all No, both checkboxes ticked)
- Verification request submitted to Google

Status: Verification pending Google review (typically 2-4 weeks).
Extension remains functional during review — users see "unverified app" warning until approved.
Known issues: None.
Next steps: Session 51 — Manifest and permissions cleanup, console.log audit.

---

Session 48 — Complete
Date: 2026-03-08
Branch: main
What was built:
Pro feature gate — free vs Pro user distinction, upgrade prompt UI, and AI button gating.

utils/helpers.js
- Added LICENCE_KEY and LICENCE_VALID to STORAGE_KEYS and DEFAULT_STORAGE (foundation for V2 licence key system)
- Added isProUser() — async function that returns true if any of the three AI provider API keys (Anthropic, OpenAI, Gemini) is non-empty in storage. V2 will extend this to also check a valid licence key.

setup/setup.js
- Fixed handleSaveKeys() to always write all three API key values (including empty strings), allowing users to clear keys from the Settings page. Previously only non-empty values were written, making it impossible to revoke Pro status via the UI.

sidepanel/sidepanel.html
- Added #pro-status-badge span in the header between the logo and settings gear button
- Added #upgrade-banner (yellow panel) between the header and stale-warning div, containing: value proposition message, "Upgrade — $4.99/month" CTA link (placeholder Lemon Squeezy URL), and "I have an API key" button

sidepanel/sidepanel.css
- Appended styles: .pro-badge, .pro-badge--free (grey pill), .pro-badge--pro (blue pill), .upgrade-banner, .upgrade-banner__msg, .upgrade-banner__actions, .btn-small

sidepanel/sidepanel.js
- Added DOM refs for upgradeBanner, upgradeCtaBtn, upgradeHaveKeyBtn, proStatusBadge
- DOMContentLoaded: calls refreshProStatus() after loading saved preferences
- Added refreshProStatus() — reads isProUser() and updates badge text and class
- Added showUpgradeBanner() — displays banner and scrolls it into view
- Added hideUpgradeBanner() — hides the banner
- Wired upgradeHaveKeyBtn to send OPEN_SETTINGS message (opens Settings page)
- Document click listener auto-hides banner when user clicks elsewhere
- Gated handleEvaluate() — calls isProUser(), shows upgrade banner and returns early if false
- Gated handlePreparePackage() — same gate
- Gated enrichCompanyMetadata() — silent no-op for free users (no banner)

background/service-worker.js
- Added OPEN_SETTINGS message handler that calls chrome.runtime.openOptionsPage()

Test results: Manually verified.
  1. Free user (no API keys): badge shows "Free" (grey), clicking Evaluate Fit or Prepare Package shows upgrade banner, clicking elsewhere dismisses it, "I have an API key" opens Settings.
  2. Pro user (API key present): badge shows "Pro" (blue), AI features work normally, no banner shown.
  3. Clearing API keys in Settings correctly revokes Pro status on sidepanel reopen.
Known issues: None.
Next steps: Session 49 — Licence key section in Settings (Lemon Squeezy validation).

---

Session 47 — Complete
Date: 2026-03-07
Branch: main
What was built: Removed Flask dashboard implementation. Deleted dashboard/app.py,
config.py, drive_service.py, routes.py, requirements.txt, README.md, templates/,
static/, __pycache__/. Deleted dashboard_flask/ directory entirely. Retained
dashboard/dashboard.html, dashboard/dashboard.js, dashboard/dashboard.css
(in-extension standalone dashboard).

Test results: N/A — deletion only, no functional change to the extension.
Known issues: None.
Next steps: Privacy policy, onboarding polish, error handling audit.

---

Session 46 — Complete
Date: 2026-03-06
Branch: main
What was built:

- Extension icons — briefcase on blue circle design at 16x16, 48x48, 128x128px;
  added to icons/ folder; manifest updated with top-level icons and
  action.default_icon references

Test results: Icon confirmed appearing in Chrome toolbar.
Known issues: None.
Next steps: Privacy policy, onboarding polish, error handling audit.

---

Session 45 — Complete
Date: 2026-03-06
Branch: main
What was built:

- Job detail panel — slides in from right when clicking a job row; shows title,
  company, location, date, salary, type, status, all Drive documents as clickable
  links, notes field with save, full job description, move action; closes on ✕ or
  overlay click
- Notes persistence — saved to job_info.json via Drive API PATCH; persists across
  sessions
- "Open Dashboard" button always visible at bottom of sidepanel — moved outside
  job/empty state divs into permanent footer
- Bulk actions — checkbox column in each table; select-all per section; bulk move
  to any status; bulk reject; clear selection; bulk bar shows/hides based on
  selection count; filters respected during bulk operations

Test results: All features confirmed working.
Known issues: None.
Next steps: Improve AI output quality — CV tailoring prompts, cover letter tone.

---

Session 44 — Complete
Date: 2026-03-06
Branch: main
What was built:

- Dashboard filter bar — keyword search (position + company + location), dropdown
  filters for Status, Type, Location, Company; Clear Filters button; section headers
  hide when no matching rows; filter state persists across job moves
- Dashboard column sorting — click any column header to sort by position, company,
  location, date, salary, or type; toggle ascending/descending; sort indicators
  (↕/↑/↓) on headers; sort persists across re-renders

Test results: Filters and sorting confirmed working.
Known issues: None.
Next steps: Job detail view, bulk actions, reject button.

---

Session 42 — Complete
Date: 2026-03-06
Branch: main
What was built:

- Package type dropdown in sidepanel — CV only, Cover Letter only, CV + Cover Letter,
  Academic Package; initializes to Settings default but can be overridden per session
- Academic Package mode — generates CV, Cover Letter, Research Statement, Diversity
  Statement, and Teaching Statement; AI generates statements from profile documents;
  9-step progress indicator
- Academic statement prompt builders — buildResearchStatementPrompt(),
  buildDiversityStatementPrompt(), buildTeachingStatementPrompt() in ai-helpers.js
- saveAcademicDocToDrive() in drive-api.js for saving plain text as Google Doc + PDF
- Default Package dropdown in Settings updated with Academic option
- CV/CL save guard fix — empty CV no longer created in CL-only mode; fixed silent
  fallback in drive-api.js
- AI call failures now surface as visible errors instead of silently saving broken
  documents
- OpenAI GPT integration — GPT-4o, GPT-4o Mini, GPT-4 Turbo, o1, o1-mini, o3-mini

Test results: All four package modes confirmed working.
Known issues: OpenAI requires funded account at platform.openai.com/settings/billing.
Next steps: Dashboard improvements — move jobs between status folders, better job
management UI.

---

Session 41 — Complete
Date: 2026-03-05
Branch: main
What was built:

- View in Drive link — appears after both Save to Drive and Prepare Package complete;
  persists when navigating back to a previously saved job via checkDuplicate(); hidden
  on clear and job navigation
- Subfolder cache invalidation — when user changes save location in Settings, cached
  Preparation/Submitted/Rejected folder IDs are cleared and recreated in new location
- Parent folder verification in ensureStatusFolders — detects stale cached IDs and
  recreates subfolders if pointing to wrong parent
- Indeed scraper loop fix — dedup guard prevents repeated scraping of same URL
- LinkedIn scraper loop fix — lastScrapedJobId guard prevents repeated scraping of
  same job
- OpenAI GPT integration — GPT-4o, GPT-4o Mini, GPT-4 Turbo, o1, o1-mini, o3-mini
  added to all model dropdowns and modelMaps; callOpenAI() routes through callAI()
- Package mode fix — CV and CL save steps now correctly wrapped in packageMode guards;
  AI call failures now surface as visible errors instead of silently saving broken
  documents
- Duplicate check dedup guard and 5-second timeout

Test results: Cover Letter only mode confirmed working with Gemini. View in Drive link
confirmed working. OpenAI integration confirmed working (requires funded account).
Known issues: OpenAI requires credits at platform.openai.com/settings/billing.
Next steps: Dashboard improvements — move jobs between status folders from dashboard UI.

---

Session 40 — Complete
Date: 2026-03-05
Branch: main
What was built:

- Stale data yellow warning banner — shown when job title contains feed page junk
  text; also shown on empty state when tab is a web page; hides automatically when
  clean job data loads
- Default Package setting wired up in handlePreparePackage() — respects cv, cl,
  both from storage; progress indicator shows only relevant steps per mode
- Settings page: Default Package section with CV only / Cover Letter only / Both
  options
- Settings page: Choose buttons for CV Templates, Cover Letter Templates, My Profile
  folders fixed — folder picker moved to fixed overlay position
- Progress indicator resets when navigating to a new job
- Duplicate checker dedup guard — prevents repeated Drive API calls for same job
- Duplicate check timeout — 5 second cap prevents UI blocking
- "Checking Drive..." indicator made less prominent — moved to small grey hint text
  below the status bar instead of replacing the bar content

Test results: CV only, Cover Letter only, and Both modes all confirmed working.
Folder picker confirmed working. Progress indicator resets correctly on job navigation.

Known issues: None.
Next steps: Consider OpenAI GPT-4o integration. Continue testing generic scraper on
more careers sites.

---

Session 39 — Complete
Date: 2026-03-05
Branch: main
What was built:

- AI-based company/location extraction via extractJobMetadata() — fallback when
  scraped fields are empty or garbled
- Auto-enrichment on job load via enrichCompanyMetadata() called from showJob()
- Restored missing Evaluate Fit button; now uses selected AI model
- MutationObserver retry logic: 5 retries, 1500ms delay, DOM-watch fallback
- Removed retired Gemini 2.0 Flash model
- Generic WEB scraper (content-scripts/generic.js) for any careers page
- LinkedIn email digest URL support and tracking parameter cleanup
- document.title fallback for job title and company
- Company name noise word cleanup in generic scraper
- tabs.onUpdated trigger with shouldScrapeOnLoad() guard
- LinkedIn scraper null guard to prevent feed page data populating sidepanel
- Progress indicator for Prepare Package (6 real-time steps)
- Settings page refactored: each section saves independently, Close button added
- Empty state hint updated to mention page refresh if fields don't populate

Test results: All features confirmed working. Auto-scraping works reliably after
one tab refresh following extension reload — standard Chrome extension behavior.
Known issues: None.
Next steps: Add default package option (CV only / CL only / Both) to Settings.

---

Session 45 — Complete
Date: 2026-03-05
Branch: fix-linkedin-spa-dom-staleness
What was built:

- Reverted isVisible() visibility filter approach: removed isVisible() helper
  and all querySelectorAll+isVisible loops; extractText, extractLocation, and
  extractDescription now use standard querySelector again
- Added lastScrapedJobId and lastScrapedSignature state variables at top of
  IIFE to track the identity and content signature of the last successfully
  sent job
- Added isDomStale() helper inside runScrape(): detects the SPA race condition
  where URL has changed to a new job but DOM still shows previous job — triggers
  when currentJobId !== lastScrapedJobId AND title+company signature is unchanged
- Staleness check applied after initial scrape (attempt 1): if stale, clears
  description to force the retry loop
- Staleness check applied in every retry iteration after Object.assign: if
  still stale after re-scrape, description is cleared again
- State saved (lastScrapedJobId, lastScrapedSignature) immediately before each
  sendJobData() call — covers early-return path, retry-success path, and the
  exhausted-retries fallback path

Test results: Reload extension and test in Chrome manually.
Known issues: None
Next steps: Manual test on split-panel LinkedIn — navigate between jobs and
verify correct job data is shown in the side panel on each click.

---

Session 44 — Complete
Date: 2026-03-05
Branch: feature-always-fresh-start
What was built:

- clearJobOnStartup(): new function called at the very start of DOMContentLoaded;
  resets currentJob=null, clears all field values to empty strings, resets
  sourceBadge, switches to empty state, and removes CURRENT_JOB from session
  storage — panel always opens blank regardless of previous session state
- Removed session-storage restore block from DOMContentLoaded: the panel no
  longer pre-populates with the last scraped job on open; a live scrape always
  populates it instead
- requestScrapeIfJobChanged: removed the early-return match optimisation;
  scrape is now always fired unconditionally; the job-ID comparison is retained
  but only controls whether to clear the display (clear on mismatch, leave
  as-is on same-job refresh so display stays stable during the in-flight scrape)

Test results: Panel opens blank on every launch; fresh scrape always populates
it; switching jobs clears the display immediately.

Known issues: None
Next steps: End-to-end test

---

Session 43 — Complete
Date: 2026-03-05
Branch: feature-job-id-change-detection
What was built:

- Job-ID change detection in sidepanel: added jobIdFromUrl(url) helper that
  extracts a stable identity from any URL (LinkedIn: numeric job ID from
  currentJobId param or /jobs/view/{id}; other sites: origin+pathname+search);
  added requestScrapeIfJobChanged(tab) that compares tab URL identity against
  currentJob.applicationUrl — if they match, does nothing; if they differ,
  clears the panel immediately (preventing stale data from lingering) and fires
  REQUEST_SCRAPE via both direct tabs.sendMessage and SIDEPANEL_OPENED paths
- DOMContentLoaded and visibilitychange both now call requestScrapeIfJobChanged
  instead of unconditionally triggering a scrape
- linkedin.js REQUEST_SCRAPE handler: added clearTimeout(debounceTimer) before
  runScrape() so any pending navigation-debounce is cancelled and the externally
  requested scrape runs fresh without a duplicate follow-up

Test results: Panel clears immediately when switching to a different LinkedIn
job; panel stays stable when re-opening on the same job.

Known issues: None
Next steps: End-to-end test across tab switching and panel reopen scenarios

---

Session 42 — Complete
Date: 2026-03-05
Branch: feature-sidepanel-active-scrape
What was built:

- Sidepanel active-pull scrape on open: on DOMContentLoaded the panel now sends
  two parallel messages instead of one TRIGGER_SCRAPE_FOR_TAB:
  1. Direct chrome.tabs.sendMessage REQUEST_SCRAPE to content script (fast path;
     instant when content script is already loaded in the tab)
  2. SIDEPANEL_OPENED to the service worker (injects content script if not yet
     present, then sends REQUEST_SCRAPE — handles cold-start tabs)
- SIDEPANEL_OPENED service-worker handler: added alongside TRIGGER_SCRAPE_FOR_TAB;
  calls triggerScrapeForTab(tab) which injects the content script if needed and
  sends REQUEST_SCRAPE with up to 3 retries
- 3-second fallback: if currentJob is still null 3 s after panel open, sends
  REQUEST_SCRAPE once more via direct chrome.tabs.sendMessage (replaces the old
  2.5 s TRIGGER_SCRAPE_FOR_TAB + 1 s session-storage poll)
- linkedin.js REQUEST_SCRAPE handler was already present; no change needed

Test results: Extension loads without console errors; sidepanel initiates scrape
on open via both paths; fallback fires only when panel remains empty after 3 s.

Known issues: None
Next steps: End-to-end test on cold-start LinkedIn tabs

---

Session 41 — Complete
Date: 2026-03-04
Branch: feature-independent-section-saves
What was built:

- Setup page refactored: removed single "Complete Setup" button; each settings
  section now has its own independent Save button (Save Folder, Save, Save, Save
  Templates, Save Keys)
- First-run banner: shown at top of page when SETUP_COMPLETE is not set in
  storage; hidden after the user saves a folder for the first time
- Close button: added to bottom of page (window.close()); users can exit
  settings at any time without completing all sections
- Pre-populate on load: all fields now pre-filled from storage on page load;
  non-interactive auth token attempt restores Drive connected state and resolves
  folder names via Drive API without requiring a button click
- Inline save confirmation: each save button shows "Saved ✓" next to it for
  2 seconds after a successful save, then fades out
- My Profile Folder: added to Application Materials section (UI + storage key
  PROFILE_FOLDER_ID added to helpers.js) so users can configure which Drive
  folder holds their candidate profile documents
- Removed three-panel setup flow (setup-form / setup-complete / setup-success);
  settings page is now always a single form view

Test results: Extension loads without console errors; all save buttons save
independently; pre-population works for all fields; banner shows on first
install; Close button closes the tab.

Known issues: sidepanel.js still looks up My_Profile folder by name — it can
be updated to use PROFILE_FOLDER_ID from storage in a future session.
Next steps: Test with real data; update sidepanel.js to use stored profile
folder ID

---

Session 40 — Complete
Date: 2026-03-04
Branch: feature-default-package-setting
What was built:

- Default Package setting: added "Default Package" dropdown to Setup page
  (options: CV + Cover Letter / CV only / Cover Letter only); stored in
  chrome.storage.sync as 'defaultPackage'; loaded at sidepanel startup into
  currentPackageMode variable
- Conditional Prepare Package flow: handlePreparePackage() now snapshots
  packageMode at invocation; steps for CV (1+3) are skipped when mode is 'cl',
  steps for CL (2+4) are skipped when mode is 'cv'; skipped steps show greyed
  italic '—' rows in the progress indicator
- Progress indicator extended: updateProgress() gains 'skipped' status with
  '—' icon and .progress-step--skipped CSS class
- helpers.js updated: DEFAULT_PACKAGE key added to STORAGE_KEYS and
  DEFAULT_STORAGE with default value 'both'
- LinkedIn scraper: added tabs.onUpdated listener in service worker to
  auto-trigger scraping on page load; added shouldScrapeOnLoad() URL guard to
  prevent scraping on LinkedIn feed/list pages; null guard in scrapeLinkedInJob()

Test results: Extension loads without console errors; Default Package dropdown
saves and loads correctly; Prepare Package correctly skips steps based on
selected mode; progress rows show '—' for skipped steps.

Known issues: None
Next steps: Test with real LinkedIn/Indeed/generic pages end to end

---

Session 39 — Complete
Date: 2026-03-04
Branch: main (multiple feature branches merged)
What was built:

- AI-based company/location extraction: added extractJobMetadata() in
  utils/ai-helpers.js to extract company and location from job description
  text when scraped fields are empty or garbled
- Auto-enrichment on job load: added enrichCompanyMetadata() in
  sidepanel/sidepanel.js, called from showJob() — fields update automatically
  without user interaction
- Restored Evaluate Fit button: was accidentally removed in a previous session;
  restored to sidepanel.html and re-wired in sidepanel.js
- Evaluate Fit now uses selected AI model from the package dropdown instead of
  hardcoded Claude Sonnet
- MutationObserver retry logic: increased retries to 5, delays to 1500ms, added
  DOM-watch fallback observer that fires immediately when .jobs-description
  appears in DOM
- Removed Gemini 2.0 Flash: model retired by Google (404 NOT_FOUND); removed
  from all dropdowns and modelMaps across 4 files
- Generic WEB scraper: new content-scripts/generic.js that scrapes any careers
  page using common class/id patterns and page title fallback; shows WEB badge
  in sidepanel
- LinkedIn email digest support: added document.title fallback for job title and
  company; cleaned tracking parameters from application URL
- Company name noise word cleanup: generic.js strips trailing noise words
  (migration, careers, jobs, etc.)
- tabs.onUpdated trigger: service worker now triggers scraping whenever a
  qualifying page finishes loading
- shouldScrapeOnLoad() guard: prevents scraping LinkedIn feed/search/collections
  pages — only triggers on specific job pages (/jobs/view/ for LinkedIn, jk=
  param for Indeed)
- LinkedIn scraper null guard: returns early if no job ID found in URL,
  preventing feed page data from populating the sidepanel

---

Session 44 — Complete
Date: 2026-03-04
Branch: feature-package-progress-indicator
What was built:
Step-by-step progress indicator for the Prepare Package flow. Replaces the
single rolling text line with a persistent 6-row list that updates in real
time as each stage completes.

HTML: added <div id="package-progress"> with 6 .progress-step rows, each
containing a .progress-icon span and a .progress-label span. Hidden by
default; shown when Prepare Package starts and left visible on completion.
Existing #package-status div retained for fatal error messages below the list.

CSS: .progress-step base style (small font, muted grey for pending).
Modifier classes --active (light text + bold), --done (green), --error (red).

JS: updateProgress(step, status) updates the icon emoji and CSS modifier
class for the given row. resetProgress() resets all 6 rows to pending and
shows the container. handlePreparePackage() restructured around the 6 steps:
each step sets activeStep, calls updateProgress(n, 'active') at start and
updateProgress(n, 'done') at end. The outer catch calls
updateProgress(activeStep, 'error') and shows the error in #package-status.

Files changed:
- sidepanel/sidepanel.html: package-progress div with 6 step rows
- sidepanel/sidepanel.css: progress step styles
- sidepanel/sidepanel.js: packageProgress ref; updateProgress(); resetProgress();
  handlePreparePackage() rewritten to drive the indicator

---

Session 43 — Complete
Date: 2026-03-04
Branch: feature-scrape-url-guards
What was built:
Two guards to prevent scraping LinkedIn list/feed pages:

1. shouldScrapeOnLoad() (service-worker.js): New helper called by the
   tabs.onUpdated listener before triggerScrapeForTab(). Returns false for
   LinkedIn URLs that are not /jobs/view/{id} (blocks /jobs/search/,
   /jobs/collections/, homepage). Returns false for Indeed URLs without a
   jk= query param (blocks search result pages). Returns true for all other
   http/https URLs (generic scraper's internal quality filter handles those).
   The listener is now two lines: status check + shouldScrapeOnLoad check.

2. Guard in scrapeLinkedInJob() (content-scripts/linkedin.js): Returns null
   immediately if getCurrentJobId() returns an empty string. Prevents DOM
   reads on feed/list pages from returning partial data. runScrape() handles
   the null with an early return after the first call, and guards the retry
   loop with `if (retryData) Object.assign(jobData, retryData)` so a mid-
   scrape URL change (which would cause getCurrentJobId() to return '' again)
   can't corrupt the accumulated job data.

Files changed:
- background/service-worker.js: shouldScrapeOnLoad() helper; tabs.onUpdated
  listener simplified to use it
- content-scripts/linkedin.js: null guard at top of scrapeLinkedInJob();
  null check after initial call in runScrape(); null-safe retryData assignment
  in retry loop

Test results:
- Requires manual testing in Chrome
- Verify: browsing to linkedin.com/jobs/search/ does NOT populate the panel
- Verify: opening linkedin.com/jobs/view/12345 DOES populate the panel
- Verify: Indeed search page does not trigger; viewjob?jk=abc123 does

---

Session 42 — Complete
Date: 2026-03-04
Branch: feature-tabs-onupdated-scrape
What was built:
Added a chrome.tabs.onUpdated listener to background/service-worker.js.
Previously scraping was only triggered when the user clicked the extension
toolbar icon. Now it also fires automatically whenever any tab completes
loading — covering email digest links, direct URL navigation, bookmarks, and
any other path that bypasses the action click. The listener guards on
changeInfo.status === 'complete' and skips non-http/https URLs (chrome://,
extension pages, etc.). Delegates to the existing triggerScrapeForTab()
which selects the right content script and sends REQUEST_SCRAPE with retries.

Files changed:
- background/service-worker.js: chrome.tabs.onUpdated listener added after
  the chrome.action.onClicked listener block

Test results:
- Requires manual testing in Chrome
- Verify: opening a LinkedIn email digest link auto-populates the side panel
- Verify: navigating directly to an Indeed job URL triggers scraping
- Verify: switching to a chrome:// tab does not cause console errors

Known issues / next steps:
- onUpdated fires for every tab load including non-job pages; the generic
  scraper content script will run but will silently no-op when it finds no
  job title or the description is too short

---

Session 41 — Complete
Date: 2026-03-03
Branch: feature-generic-company-cleanup
What was built:
Added cleanCompanyName() helper to content-scripts/generic.js. Strips trailing
standalone noise words ("migration", "careers", "jobs", "hiring", "inc", "llc")
using a do/while loop so sequences like "Acme Jobs Careers" are fully reduced.
Words must be preceded by whitespace or a comma to count as standalone, so
compound names like "AcmeCareers" or "WorkMigration" are left untouched.
After noise words are removed, any residual trailing punctuation is stripped.
Every return path in extractCompany() now passes through cleanCompanyName().

Files changed:
- content-scripts/generic.js: new cleanCompanyName() function; extractCompany()
  updated to call it on every return path

Test results:
- Requires manual testing in Chrome
- "Acme Careers" → "Acme"
- "Acme Jobs Careers" → "Acme"
- "Acme, Inc." → "Acme"
- "AcmeCareers" → "AcmeCareers" (unchanged — no standalone word boundary)

Known issues / next steps:
- "Inc" and "LLC" stripped even when they are intentionally part of the brand;
  acceptable tradeoff for a personal-use tool where the user can edit in-panel

---

Session 40 — Complete
Date: 2026-03-03
Branch: feature-linkedin-scraper-fallbacks
What was built:
Three improvements to the LinkedIn scraper's fallback coverage:

1. document.title fallback (scrapeLinkedInJob): When DOM selectors return empty
   strings for job title or company name, the page title is parsed by splitting
   on " | " — index 0 becomes the job title fallback, index 1 becomes the company
   fallback. Matches LinkedIn's "Job Title | Company Name | LinkedIn" format.

2. Meta description fallback (extractLocation): When all DOM-based location
   selectors fail, the content of meta[name="description"] or
   meta[property="og:description"] is returned as a last resort. LinkedIn's
   meta description often contains location info (e.g. "Austin, TX · Hybrid").

3. "See more" expansion (expandDescriptionIfTruncated + runScrape): A new async
   helper clicks .jobs-description__content .feed-shared-inline-show-more-text__see-more-less-toggle
   if present, then waits 500 ms. Called once at the top of runScrape() before
   the first scrapeLinkedInJob() call, ensuring full description text is available.

Files changed:
- content-scripts/linkedin.js: extractLocation meta fallback; scrapeLinkedInJob
  document.title fallback; new expandDescriptionIfTruncated() helper; runScrape
  calls expandDescriptionIfTruncated() before first scrapeLinkedInJob()

Test results:
- Requires manual testing in Chrome
- Verify: job pages where DOM selectors fail still populate title/company from page title
- Verify: "see more" button is clicked on pages with truncated descriptions
- Verify: normal pages unaffected (button absent → no delay, title/company from DOM)

Known issues / next steps:
- Meta description fallback returns the full meta string, not just the location;
  user may need to trim it in the sidepanel

---

Session 39 — Complete
Date: 2026-03-03
Branch: feature-linkedin-url-and-email-layout
What was built:
Two fixes to the LinkedIn content script:

Fix 1 — URL cleaning: extractApplicationUrl() now always returns a clean
https://www.linkedin.com/jobs/view/{jobId}/ URL by extracting only the
numeric job ID from the canonical link tag, the current page pathname, or
the currentJobId query param, then constructing a fresh URL. Tracking params
like ?trk=eml…, ?refId=… are dropped.

Fix 2 — Email digest layout support: scrapeLinkedInJob() now handles
standalone job view pages (linkedin.com/jobs/view/{id}?trk=eml…) in addition
to the split-panel search layout. Added selectors for:
- Job title: 'h1.job-title' and bare 'h1' as final fallbacks
- Company: added explicit comment for 'a[href*="/company/"]' covering email
  digest layout; added first-line trim (rawCompany.split('\n')[0]) to strip
  follower count lines rendered in the same element
- Description: added '.jobs-description__content' and
  '.jobs-description-content__text' as dedicated email-digest selectors
Updated file-level JSDoc to document both supported layouts.

Files changed:
- content-scripts/linkedin.js: extractApplicationUrl rewritten; scrapeLinkedInJob
  updated with email-digest selectors and company first-line cleanup;
  extractDescription updated with two new selectors

Test results:
- Requires manual testing in Chrome
- Verify: opening a job from a LinkedIn email digest (URL with ?trk=eml)
  populates all fields and applicationUrl is clean (no tracking params)
- Verify: split-panel search layout is unaffected

Known issues / next steps:
- None

---

Session 38 — Complete
Date: 2026-03-03
Branch: feature-generic-scraper
What was built:
Added a generic job page scraper that works on any careers page that is not LinkedIn
or Indeed. The scraper uses common DOM heuristics (h1/h2 headings, class/id keyword
matching, meta tags, and largest block fallback) to extract job data from arbitrary
career sites. Data is only sent when a job title is found and the description exceeds
200 characters. A grey "WEB" source badge is shown in the side panel.

Files changed:
- content-scripts/generic.js: New generic scraper content script
- manifest.json: Added <all_urls> to host_permissions; added generic.js content script
    entry with exclude_matches for LinkedIn and Indeed; run_at document_idle
- background/service-worker.js: Updated getContentScriptForUrl to return generic.js
    for http/https URLs that are not LinkedIn or Indeed
- sidepanel/sidepanel.js: Updated showJob badge logic to handle source 'generic' → 'WEB'
- sidepanel/sidepanel.css: Added .source-badge--generic (grey) style
- sidepanel/sidepanel.html: Updated empty-state hint text to mention "any careers page"

Test results:
- Requires manual testing in Chrome by loading extension via chrome://extensions
- Verify: WEB badge appears on non-LinkedIn/Indeed career pages with a job title + description
- Verify: LinkedIn and Indeed pages are unaffected (excluded from generic script)
- Verify: Generic script is silent on pages with no job title or short descriptions

Known issues / next steps:
- The largest-div fallback in extractDescription can grab navigation bars or footers
  on pages with minimal semantic structure; an AI cleanup step on save would mitigate
- No SPA navigation watcher in the generic scraper (single-page career apps won't re-scrape
  on job change); add if needed for specific sites

---

Session 37 — Complete
Date: 2026-03-02
Branch: main (committed directly)
What was built:
Fixed recursive subfolder traversal for the My_Profile folder. Previously, profile
documents nested inside subfolders within My_Profile were not found — only files at
the top level of the folder were read. The fix adds recursive traversal so all Google
Docs anywhere within the My_Profile folder hierarchy are included when building the
candidate profile text sent to AI prompts.

Files changed:
- drive/drive-api.js: readDocsFromFolder updated to recursively enumerate subfolders
    and collect Docs from each level before returning the merged result.

Test results: Profile documents stored in subfolders within My_Profile now appear in
AI prompts correctly.
Next steps: None — profile reading pipeline fully functional.

---

Session 36 — Complete
Date: 2026-03-02
Branch: main (committed directly)
What was built:
Added Google Doc as a fourth save format alongside the existing JSON, HTML, and PDF
files. When a job is saved to Drive, a formatted Google Doc is now created in the job
folder in addition to the three existing file types. All four files are generated and
uploaded in the same Save to Drive operation — partial saves are not permitted.

Files changed:
- drive/drive-api.js: savePreparedPackage (or equivalent save function) extended to
    create a Google Doc via the Drive API using the job summary content.
- sidepanel/sidepanel.js: updated the save call to include the new Doc creation step;
    all four file types must succeed or the operation is treated as failed.

Test results: Job folders in Drive now contain four files: job_info.json,
job_summary.html, job_summary.pdf, and a Google Doc.
Next steps: None.

---

Session 35 — Complete
Date: 2026-03-02
Branch: main (committed directly)
What was built:
Moved the Default AI Model selector from the side panel into the Setup page so model
preference is configured once at setup time rather than persisted as a per-session
dropdown state. Removed the bottom Claude-only AI selector that previously appeared in
the side panel below the action buttons. Added Gemini 2.5 Pro (gemini-2.5-pro) as a
selectable model option in both the Setup page dropdown and the Prepare Package dropdown.

Files changed:
- setup/setup.html: added Default AI Model section with select element matching all
    supported model keys (sonnet, haiku, geminiFlash, geminiFlash25, gemini-2.5-pro).
- setup/setup.js: reads and saves the selected model to STORAGE_KEYS.DEFAULT_AI_MODEL
    on form submit; populates the dropdown from storage on page load.
- sidepanel/sidepanel.html: removed the evaluate-only AI selector; Prepare Package
    dropdown now includes Gemini 2.5 Pro option; panel reads saved default on load.
- sidepanel/sidepanel.js: DOMContentLoaded reads STORAGE_KEYS.DEFAULT_AI_MODEL and
    pre-selects the matching option in the package-model dropdown; modelMap extended
    with 'gemini-2.5-pro' entry.
- utils/ai-helpers.js: added geminiPro: 'gemini-2.5-pro' to AI_MODELS constants.

Test results: Default model saved in Setup is correctly pre-selected when the side
panel opens. Gemini 2.5 Pro appears in both dropdowns and routes correctly to the
Gemini API.
Next steps: None.

---

Session 34 — Complete
Date: 2026-03-02
Branch: main (committed directly)
What was built:
Added Gemini 2.0 Flash and Gemini 2.5 Flash as selectable AI models for the Prepare
Package pipeline. Fixed model name references — Gemini 1.5 Flash has been retired by
Google and was replaced with the correct current model IDs. Added a Google (Gemini)
API key input field to the Setup page so users can store their Gemini key without
editing storage directly.

Files changed:
- utils/ai-helpers.js: added geminiFlash: 'gemini-2.0-flash' and
    geminiFlash25: 'gemini-2.5-flash' to AI_MODELS; removed retired 1.5 Flash reference.
    callAI dispatcher updated: model IDs starting with 'gemini-' are detected by prefix
    and routed to callGeminiAPI using the stored Gemini key, regardless of the provider
    argument — allows Gemini models to be selected from the package dropdown without
    changing the provider field.
- setup/setup.html: added Google (Gemini) API Key password input field in the AI
    Provider Keys section.
- setup/setup.js: reads and saves STORAGE_KEYS.GEMINI_API_KEY on form submit;
    populates the field from storage on page load.
- sidepanel/sidepanel.html: added Gemini 2.0 Flash and Gemini 2.5 Flash options to
    the Prepare Package model dropdown.
- sidepanel/sidepanel.js: modelMap extended with geminiFlash and geminiFlash25 entries.

Test results: Gemini Flash models selectable and callable from the Prepare Package
pipeline using a stored Gemini API key.
Next steps: None.

---

Session 33 — Complete
Date: 2026-02-27
Branch: main (committed directly)
What was built:
Cover letter company block now extracted by Claude from the job description rather than
relying on scraped fields. Previously, {{COMPANY_NAME}}, {{DEPARTMENT}}, and {{LOCATION}}
were populated from jobToSave.company and jobToSave.location — which are often incomplete
or missing the department entirely. Claude now extracts all three from the raw job
description text as part of the same prompt that writes the letter body.

Files changed:
- utils/ai-helpers.js: buildCLBodyPrompt updated to return a JSON object with two keys:
    companyBlock: { name, department, location } — extracted from the job description
    bodyParagraphs: [] — variable-length array of letter body paragraphs (unchanged)
    Prompt instructs Claude to read company name, department/division, and city/state
    directly from the description text.
- sidepanel/sidepanel.js: step 9 now initialises clCompanyBlock as a fallback from
    jobToSave fields, then overwrites with parsed.companyBlock if Claude returns a valid
    object. Passes clCompanyBlock into clData.companyBlock. Debug log for CL companyBlock
    removed after verification.

Also removed in this session: several debug console.log lines added during the
31b/32 debugging cycle (job fields, job company/location, jobToSave full, CL companyBlock).
Next steps: None — pipeline complete and clean.

---

Session 32 — Complete
Date: 2026-02-26
Branch: feature-session32-cl-hybrid
What was built:
Hybrid CL tailoring — replaceAllText for company block + insertText for body paragraphs.
Replaced the brittle paragraph-extraction approach entirely with a two-phase Docs API strategy
that does not depend on finding anchor text in the template body:

Phase 1 — replaceAllText: fills {{COMPANY_NAME}}, {{DEPARTMENT}}, {{LOCATION}} placeholders
  in the address block of the copied template.
Phase 2 — insertText (reverse order): re-reads the copied doc to find the character startIndex
  of the "Sincerely," paragraph, then inserts each Claude-generated body paragraph at that
  index in reverse order so the final paragraph sequence is correct without tracking shifts.

All debug console.log lines from the 31b debugging session were removed as part of this rewrite.
The full Prepare Package pipeline (profile read → CV template selection → CV Docs API tailoring
→ CL body generation → CL Docs API hybrid tailoring → save to Submitted) is now working
end-to-end.

Files changed:
- utils/ai-helpers.js: removed buildTailorCLStructuredPrompt; added buildCLBodyPrompt(job,
    cvSummary) which asks Claude for a plain JSON array of paragraph strings (Claude decides
    the count, typically 3–4); no reference to existing template content required.
- sidepanel/sidepanel.js: removed all old CL structure-reading code (Docs API fetch, clParas
    loop, dearIdx/sincerelyIdx search, bodyPara extraction, all debug logs); step 8 now just
    gets the template doc ID; step 9 calls buildCLBodyPrompt with job data + newSummary;
    clData passed as { templateDocId, companyBlock: { name, department, location },
    bodyParagraphs }.
- drive/drive-api.js: rewrote tailorCLWithDocsAPI with new 5-step flow; savePreparedPackage
    step 6 simplified — always calls tailorCLWithDocsAPI when templateDocId present.

Template requirement: the CL Google Doc template must contain {{COMPANY_NAME}},
  {{DEPARTMENT}}, and {{LOCATION}} as literal placeholder strings in the address block.
Next steps: None — pipeline complete.

---

Session 31b — Complete
Date: 2026-02-26
Branch: feature-session31b-cl-fix
What was built:
Debugging and fixing the cover letter anchor matching. Multiple fixes applied across commits:

Fix 1 — Diagnostic logging in sidepanel.js handlePreparePackage:
  Added console.log lines to expose CL template doc ID, dearIdx/sincerelyIdx values,
  opening/closing extracts, body paragraph count, and all paragraph text after extraction.
  (These logs were removed in Session 32 once the root cause was resolved.)

Fix 2 — More lenient skip condition in savePreparedPackage in drive-api.js:
  Changed the cover letter branch so that if templateDocId is present but replacements is
  null, the template is copied unmodified rather than skipped entirely.

Fix 3 — Anchor matching improved:
  Changed dearIdx detection from startsWith('Dear Hiring Manager') to
  includes('Dear') && includes('Hiring Manager'), then further simplified to
  includes('Hiring Manager') alone after logs showed the paragraph containing
  that string was the correct anchor regardless of leading characters.

Files changed:
- sidepanel/sidepanel.js: diagnostic logs (later removed); dearIdx condition updated
- drive/drive-api.js: savePreparedPackage step 6 branching; dearIdx condition updated

Testing checklist:
  Superseded by Session 32 rewrite — anchor matching is no longer needed.
Known issues: None — root cause resolved by switching to insertText approach in Session 32.

---

Session 31 — Complete
Date: 2026-02-26
Branch: feature-session31-cl-tailoring
What was built:
Docs API in-place cover letter tailoring. Mirrors the CV tailoring approach from Session 30.
The pipeline now: (1) reads the CL template Google Doc structure via Docs API; (2) extracts
the company address block, opening paragraph, body paragraphs, and closing paragraph by
anchoring on "Hiring Manager" / "Dear Hiring Manager," / "Sincerely," markers; (3) asks
Claude for structured JSON replacements; (4) applies them with tailorCLWithDocsAPI using
replaceAllText batchUpdate. All original formatting, fonts, and layout are preserved.

Files changed:
- drive/drive-api.js:
    Added tailorCLWithDocsAPI(accessToken, templateDocId, parentFolderId, title,
      replacements): copies CL template, reads paragraph structure, builds replaceAllText
      requests for companyBlock lines, openingParagraph, each bodyParagraph, and
      closingParagraph; applies all in a single batchUpdate call.
    Updated savePreparedPackage() signature: sixth param renamed coverLetterText → clData
      (object with templateDocId + replacements, or html fallback).
    Step 6 updated: uses tailorCLWithDocsAPI when clData.templateDocId && clData.replacements
      present; falls back to createGoogleDoc with HTML if not; skips with warning if neither.
- utils/ai-helpers.js:
    Added buildTailorCLStructuredPrompt(job, profileText, currentOpening, currentBodyParas,
      currentClosing): returns a prompt asking Claude for
      { companyBlock[], openingParagraph, bodyParagraphs[], closingParagraph } JSON —
      no HTML, no formatting instructions, just the text that needs to change.
- sidepanel/sidepanel.js (handlePreparePackage):
    Step 8 (new): reads CL template Doc structure via Docs API to extract currentCLOpening,
      currentCLBodyParas[], and currentCLClosing before calling Claude.
    Step 9 (new): calls buildTailorCLStructuredPrompt → parseAIResponse; falls back silently
      if the call fails or returns unexpected structure.
    savePreparedPackage call updated to pass clData = { templateDocId, replacements } object.

Architecture note: CL template parsing anchors on plain-text paragraph markers
("Hiring Manager" for company block, "Dear Hiring Manager," for opening, "Sincerely," for
closing). Body paragraphs are everything between opening and closing. These markers are
hardcoded and assumed to match the specific CL template in use.

Testing checklist:
  1. Reload extension. Ensure CL Templates folder is set in Settings.
  2. Navigate to a job posting. Click 📦 Prepare Package.
  3. Watch status: Reading cover letter template → Writing cover letter → Saving...
  4. In Google Drive → Submitted → job folder, open the Cover Letter Google Doc.
     Verify: company block, opening, body, and closing are all rewritten for the role;
     all other formatting, fonts, and layout unchanged.
  5. Check CV Doc is also present and correctly tailored.
Known issues: CL paragraph markers hardcoded — will not work if template uses different
  anchor text. Generalisation deferred.
Next steps: Merge to main. Test end-to-end with real CL template.

---

Session 30 — Complete
Date: 2026-02-26
Branch: feature-session30-docs-api
What was built:
Docs API in-place CV tailoring. Instead of generating full HTML and uploading as a new
Doc, the pipeline now: (1) copies the chosen template Google Doc; (2) reads its current
Professional Summary and Director role bullet text via the Docs API; (3) asks Claude for
structured JSON replacements only; (4) applies them with batchUpdate replaceAllText.
All fonts, formatting, tables, and layout from the original template are preserved.

Files changed:
- drive/drive-api.js:
    Added tailorCVWithDocsAPI(accessToken, templateDocId, parentFolderId, title,
      newSummary, newBullets): copies template, reads structure, builds replaceAllText
      requests for the Professional Summary and up to 4 Director role bullets, applies
      all replacements in a single batchUpdate call.
    Updated savePreparedPackage() signature: third param renamed tailoredCVText → cvData
      (object with templateDocId, newSummary, newBullets or html fallback).
    Step 5 updated: uses tailorCVWithDocsAPI when cvData.templateDocId present;
      falls back to createGoogleDoc with HTML if not.
- utils/ai-helpers.js:
    Added buildTailorCVStructuredPrompt(job, profileText, currentSummary, currentBullets):
      returns a prompt asking Claude for { summary, bullets[] } JSON — no HTML, no
      formatting instructions, just the text that needs to change.
- sidepanel/sidepanel.js (handlePreparePackage):
    Step 6 (new): reads template Doc structure via Docs API to extract currentSummary
      and currentBullets before calling Claude.
    Step 7 (new): calls buildTailorCVStructuredPrompt → parseAIResponse; falls back to
      original text if the call fails or returns unexpected structure.
    Step 8: cover letter prompt now uses selectedTemplate.text for context (plain text
      export) rather than the HTML tailored CV.
    Step 10: savePreparedPackage call updated to pass cvData object.

Architecture note: getParagraphText is defined locally inside tailorCVWithDocsAPI in
drive-api.js and also inside the Docs API reading block in handlePreparePackage. The
duplication is intentional — both contexts are self-contained and the function is trivial.

Testing checklist:
  1. Reload extension. Re-authenticate (documents scope already added in Session 29).
  2. Set CV Templates folder in Settings to a folder containing at least one Google Doc
     CV template that has "PROFESSIONAL SUMMARY" and "Director of Bioimaging" sections.
  3. Navigate to a job posting. Click 📦 Prepare Package.
  4. Watch status: Reading template structure → Tailoring CV content → Writing cover
     letter → Saving...
  5. In Google Drive → Submitted → job folder, open the CV Google Doc.
     Verify: Professional Summary is rewritten for the role; Director bullets are updated;
     all other sections, fonts, formatting, tables unchanged.
  6. Verify the CV PDF is also present.
Known issues: Heading markers ("PROFESSIONAL SUMMARY", "Director of Bioimaging") are
  hardcoded — will not work if templates use different text. Generalisation deferred.
Next steps: Merge to main. Test with real CV template.

---

Session 29d — Complete
Date: 2026-02-26
Branch: feature-session29d-haiku-option
What was built:
Haiku model option for the Prepare Package pipeline. A "Claude model" dropdown above the
Prepare Package button lets the user choose between Sonnet 4.6 (best quality) and
Haiku 4.5 (faster & cheaper) before running the pipeline.

Files changed:
- utils/ai-helpers.js:
    Added claudeHaiku: 'claude-haiku-4-5-20251001' to AI_MODELS.
    callAnthropicAPI() gains optional model parameter (default: AI_MODELS.claude).
    callAI() gains optional model parameter (null by default); passes it through to
      callAnthropicAPI for the claude provider; ignored for openai/gemini.
- sidepanel/sidepanel.html:
    Added .action-row--package-model div with a "Claude model" label and
    #package-model <select> (options: Sonnet 4.6, Haiku 4.5) above the Prepare Package button.
- sidepanel/sidepanel.css:
    Added .action-row--package-model (flex row), .selector-label, .ai-selector styles.
- sidepanel/sidepanel.js:
    Added packageModel DOM reference.
    In handlePreparePackage, resolves selectedModel from packageModel.value before the
      AI calls; passes selectedModel to all three callAI('claude', prompt, selectedModel)
      calls (template selection, CV tailoring, cover letter generation).

Testing checklist:
  1. Reload extension. Navigate to a job posting.
  2. Verify "Claude model" dropdown appears above Prepare Package button.
  3. Select "Haiku 4.5 — faster & cheaper". Click Prepare Package.
     Confirm the pipeline completes (faster than Sonnet).
  4. Select "Sonnet 4.6 — best quality". Repeat. Confirm higher-quality output.
  5. Evaluate Fit button is unaffected — still uses the ai-provider dropdown.
Known issues: None identified.
Next steps: Merge to main.

---

Session 29c — Complete
Date: 2026-02-26
Branch: feature-session29c-fetch-fix
What was built:
Three defensive fixes to savePreparedPackage to prevent a single step failure from
aborting the whole operation, plus improved error logging.

Files changed:
- drive/drive-api.js (savePreparedPackage steps 3 and 4):
    Step 3 (Preparation cleanup) wrapped in try/catch — failure logs a warning and
      continues rather than propagating (fixes "Failed to fetch" when the Submitted
      subfolder already exists and the copy operation conflicts).
    Step 4 (job file saves) — each of the three uploads (JSON, HTML, PDF) now has its
      own try/catch so one file failure doesn't abort the others or the CV/CL steps.
- sidepanel/sidepanel.js (handlePreparePackage catch block):
    Added console.error('[JobLink] Error stack:', err.stack) for full stack trace
      visibility in DevTools.
- Fix 3 (name check): generateJobSummaryHtml is already used correctly in sidepanel.js
    (line 472) — no code change required, confirmed by grep.

Testing checklist:
  1. Reload extension.
  2. Run Prepare Package on a job that was previously packaged (Submitted subfolder
     already exists). Should complete without "Failed to fetch" error.
  3. Check console — only warnings for any skipped steps, no fatal error.
  4. Verify all 6 files present in the Submitted folder.
Known issues: None identified.
Next steps: Merge to main.

---

Session 29b — Complete
Date: 2026-02-26
Branch: feature-session29b-package-fixes
What was built:
Two fixes to Prepare Package: (1) works on fresh jobs with no prior Save; (2) always saves
job files (JSON, HTML, PDF) directly to Submitted regardless of Preparation state.

Files changed:
- drive/drive-api.js:
    Added uploadTextFile(accessToken, parentFolderId, filename, content, mimeType) — uploads
      a plain text or HTML string as a Drive file via multipart upload.
    Added uploadBase64File(accessToken, parentFolderId, filename, base64Data, mimeType) —
      uploads a base64-encoded binary file (used for jsPDF output) via multipart upload.
    Replaced savePreparedPackage() — new signature adds optional jobFiles = {} as 6th param.
      Preparation folder ID is no longer required (only Submitted ID is mandatory).
      Step 3: copies/deletes Preparation subfolder only if it exists (was previously a hard
        requirement, now optional cleanup).
      Step 4 (new): saves job_info.json, job_summary.html, job_summary.pdf directly to
        Submitted using uploadTextFile/uploadBase64File; skips any file whose content is empty.
      Steps 5-6: CV Google Doc + PDF (unchanged).
      Steps 7-8: Cover Letter Google Doc + PDF (unchanged).
- sidepanel/sidepanel.js (handlePreparePackage):
    Added jobToSave object (merges currentJob with current field values including location)
      built before the token fetch; used for all AI prompts and saving.
    Step 7 (new): generates job files in sidepanel context where jsPDF is available —
      generateJobPdfBase64(jobToSave), generateJobSummaryHtml(jobToSave), JSON.stringify.
      PDF generation is wrapped in try/catch; missing files are skipped silently.
    Updated savePreparedPackage call to pass jobToSave (not currentJob) and jobFiles object.

Architecture note: generateJobPdfBase64 requires jsPDF (window.jspdf) which is loaded in
the sidepanel after drive-api.js. Generating files in sidepanel.js before calling
savePreparedPackage() ensures jsPDF is available and keeps drive-api.js dependency-free.

Testing checklist:
  1. Reload extension. Re-authenticate.
  2. Navigate to a fresh job (not previously saved). Click 📦 Prepare Package directly.
     Verify Google Drive → Submitted → job folder contains all 6 files:
     job_info.json, job_summary.html, job_summary.pdf, CV (Doc + PDF), Cover Letter (Doc + PDF).
  3. Status bar should show 📤 Submitted.
  4. Also test: save a job (→ Preparation), then Prepare Package.
     Verify Preparation subfolder is gone, all files in Submitted.
Known issues: None identified.
Next steps: Manual end-to-end test per checklist above. Merge to main.

---

Session 29 — Complete
Date: 2026-02-26
Branch: feature-session29-settings-folders
What was built:
Settings page gains two functional folder pickers (CV Templates, Cover Letter Templates).
Profile and template reading unified using the new readDocsFromFolder() helper.
All AI prompt builders updated to include candidate profile context.

Files changed:
- utils/helpers.js:
    Added CV_TEMPLATES_FOLDER_ID: 'cvTemplatesFolderId' and
    CL_TEMPLATES_FOLDER_ID: 'clTemplatesFolderId' to STORAGE_KEYS and DEFAULT_STORAGE.
- setup/setup.html:
    Replaced "Coming Soon" section with functional "Application Materials" section containing
    two folder picker rows — CV Templates Folder and Cover Letter Templates Folder.
- setup/setup.css:
    Added .field-group, .field-input, .field-input[readonly], .folder-picker-row,
    .folder-picker-row .field-input, .field-status classes.
- setup/setup.js:
    Added pendingPickContext state variable.
    Added getFolderName(token, folderId) helper — resolves folder name from Drive ID.
    Added pickFolder(inputId, statusId, storageKey) helper — opens shared folder picker
      for a secondary field, sets pendingPickContext.
    Refactored selectFolderAndClose() to branch on pendingPickContext: if set, saves folder
      ID to the specified storage key and updates the specified input; if not set, uses
      original main-folder behavior.
    Updated hideFolderPicker() to also clear pendingPickContext.
    Updated showSetupForm() async IIFE to pre-fill CV/CL folder names on load (silently
      gets auth token; no-ops if user not yet authenticated).
    Added click listeners for btn-pick-cv-templates and btn-pick-cl-templates.
- drive/drive-api.js:
    Deleted readCVTemplatesFromDrive() (replaced by the general readDocsFromFolder).
    Added readDocsFromFolder(accessToken, folderId, maxFiles=10) — lists and exports all
      Google Docs in a folder as plain text; unreadable files silently skipped.
- utils/ai-helpers.js:
    buildSelectTemplatePrompt() refactored from 5-arg (two hardcoded templates) to
      (job, profileText, templates[]) — accepts any number of templates, returns
      { "selected": <integer 1..N>, "reason": "..." }.
    buildTailorCVPrompt() — added profileText as second parameter (before cvTemplateText).
    buildCoverLetterPrompt() — added profileText as second parameter (before cvText).
    All three prompt builders now include a CANDIDATE PROFILE section.
- sidepanel/sidepanel.js:
    handleEvaluate() — replaced readProfileFromDrive call with
      findFolderByName + readDocsFromFolder pattern for consistency.
    handlePreparePackage() — replaced readCVTemplatesFromDrive with:
      (1) reads My_Profile docs via findFolderByName + readDocsFromFolder (non-fatal);
      (2) reads CV templates from CV_TEMPLATES_FOLDER_ID storage key;
      Updated buildSelectTemplatePrompt, buildTailorCVPrompt, buildCoverLetterPrompt
      calls to pass profileText as second argument.
- manifest.json:
    Added https://www.googleapis.com/auth/documents to oauth2.scopes.

Architecture decision: readDocsFromFolder() is a general-purpose Drive folder reader.
Profile reading, CV template reading, and future CL template reading all use the same
function — just with different folder IDs. This replaces the old approach of hard-coding
folder-name filters inside readCVTemplatesFromDrive.

Testing checklist:
  1. Reload extension. Re-authenticate (new documents scope added).
  2. Open Settings page. Connect Drive. Verify "Application Materials" section is visible.
  3. Click "Choose" next to "CV Templates Folder". Select a folder. Verify:
     - Input shows folder name
     - Status briefly shows "Saved."
     - Closing settings and reopening pre-fills the folder name.
  4. Repeat for "Cover Letter Templates Folder".
  5. Navigate to a job. Click "Evaluate Fit". Verify profile is loaded from My_Profile
     (check console for any profile warnings).
  6. Click "Prepare Package". Verify status cycles through:
     Reading profile and CV templates → Selecting template → Tailoring CV →
     Writing cover letter → Saving...
  7. Verify final ✅ status and check Drive for correct files.
Known issues: None identified.
Next steps: End-to-end manual test. If passing, merge to main.

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

Session 28 — Complete
Date: 2026-02-26
Branch: feature-session28-html-formatting
What was built:
Changed CV and cover letter output from plain text to HTML so Google Drive
auto-converts to properly formatted Google Docs with headings, bullet points,
and bold text.

Root cause of the previous formatting problem:
createGoogleDoc was uploading content with Content-Type: text/plain, so Drive
converted it as a flat plain-text document regardless of what Claude returned.
Changing the upload content-type to text/html causes Drive to interpret and
render the HTML, producing a formatted Doc.

Changes:
- utils/ai-helpers.js — buildTailorCVPrompt():
    Replaced the plain-text return instruction with HTML output rules.
    Claude is instructed to use <h1>/<h2>/<h3>/<p>/<ul>/<li>/<strong>/<em>/<br>
    and explicitly forbidden from including <html>/<head>/<body>/<style>/CSS/markdown.
- utils/ai-helpers.js — buildCoverLetterPrompt():
    Same change: replaced plain-text return instruction with HTML output rules.
    Claude uses <p> for paragraphs and <strong> for emphasis only.
- drive/drive-api.js — added wrapHtmlDocument(title, htmlBody):
    Wraps the bare HTML fragment Claude returns in a complete <!DOCTYPE html> document
    with inline CSS (Arial 11pt, styled h1/h2/h3, margins). Required because Google Drive
    renders styles from the uploaded HTML document; a bare fragment loses formatting.
    Inserted immediately before createGoogleDoc.
- drive/drive-api.js — createGoogleDoc():
    Added mimeType parameter with default 'text/html'. Content-Type in the multipart
    body now uses this parameter instead of the hard-coded 'text/plain'.
    Existing callers that don't pass mimeType automatically use text/html.
- drive/drive-api.js — savePreparedPackage():
    Both createGoogleDoc calls now wrap content with wrapHtmlDocument() before
    passing it to the upload function.

Test results: Manual testing required.
  1. Reload the extension in chrome://extensions.
  2. Navigate to a job posting, save it to Drive (lands in Preparation).
  3. Click 📦 Prepare Package.
  4. Open Google Drive → Submitted → job folder.
  5. Open the CV Google Doc — verify proper headings, bullet points, bold text.
  6. Open the Cover Letter Google Doc — verify clean paragraph formatting.
  7. Check both PDFs export cleanly from the Google Docs.
Known issues: None.
Next steps: Manual end-to-end test per checklist above. If passing, merge to main.

---

Session 27 — Complete
Date: 2026-02-26
Branch: feature-session27-drive-save
What was built:
Wired up the Drive save half of the Prepare Package feature. AI generation was already working
(Session 26). This session replaces the TODO stub with a full Drive save pipeline.

Pipeline (triggered after cover letter generation):
  1. Resolve PREPARATION_FOLDER_ID and SUBMITTED_FOLDER_ID from chrome.storage.sync
  2. Find the existing Preparation job subfolder by sanitised folder name
  3. Create (or find) the same-named folder in Submitted
  4. Copy all files from Preparation subfolder → Submitted subfolder
  5. Delete the Preparation subfolder permanently
  6. Create tailored CV as Google Doc in Submitted subfolder
  7. Export CV Google Doc as PDF, upload to Submitted subfolder
  8. Create cover letter as Google Doc in Submitted subfolder
  9. Export cover letter Google Doc as PDF, upload to Submitted subfolder

Files changed:
- drive/drive-api.js: appended five helper functions and savePreparedPackage():
    findFolderByName(accessToken, parentId, name) — returns folder ID string or null
    copyFolderContents(accessToken, sourceFolderId, destFolderId) — copies non-folder files
    deleteFolderAndContents(accessToken, folderId) — DELETE call on folder (Drive deletes recursively)
    createGoogleDoc(accessToken, parentFolderId, title, plainText) — multipart upload to create
      a Google Doc from plain text; returns doc ID
    exportDocAsPDF(accessToken, docId, parentFolderId, title) — exports Doc as PDF bytes,
      binary-safe ArrayBuffer concatenation for multipart upload; returns PDF file ID
    savePreparedPackage(accessToken, job, tailoredCVText, coverLetterText, selectedTemplateName)
      — orchestrates the full pipeline above
  Corrections applied vs session prompt:
    - DRIVE_PREP_FOLDER_ID → STORAGE_KEYS.PREPARATION_FOLDER_ID (actual key name)
    - DRIVE_SUBMITTED_FOLDER_ID → STORAGE_KEYS.SUBMITTED_FOLDER_ID (actual key name)
    - sanitiseFolderName(combined) → sanitiseFolderName(company, jobTitle) (correct 2-arg call)
    - getOrCreateNamedFolder arg order corrected (name, parentId) + return destructured as {id}
    - supportsAllDrives param removed from DELETE call (not needed for personal Drive)
- sidepanel/sidepanel.js: replaced the TODO stub in handlePreparePackage with:
    await savePreparedPackage(token, currentJob, tailoredCV, coverLetter, selectedTemplate.name);
    packageStatus.textContent = '✅ Package saved to Submitted!';
    setStatusBar('submitted');
- utils/ai-helpers.js: increased max_tokens from 1024 to 4096 to accommodate full CV and
  cover letter responses from Claude.

Testing checklist:
  1. Reload extension. Re-authenticate (drive scope added in Session 26).
  2. Navigate to a job that is saved in Preparation (status bar shows 📝 In Preparation).
  3. Click 📦 Prepare Package.
  4. Watch status cycle: Reading templates → Selecting → Tailoring CV → Writing CL → Saving...
  5. Final status should show ✅ Package saved to Submitted! and status bar → 📤 Submitted.
  6. In Google Drive, verify:
     - Job folder exists in Submitted (not Preparation)
     - Folder contains job_info.json, job_summary.html, job_summary.pdf (moved from Prep)
     - Plus: CV (Google Doc + PDF) and Cover Letter (Google Doc + PDF)
     - Preparation subfolder for this job is gone
Known issues: None.
Next steps: Manual end-to-end test per checklist above. If passing, merge to main.

---

Session 26 — Complete
Date: 2026-02-26
Branch: feature-prepare-package
What was built:
Prepare Package feature — UI, AI prompt builders, and content generation pipeline. Drive save
is stubbed with a TODO; wired in Session 27.

Overview:
When the user clicks "Prepare Package", the extension:
  1. Reads CV template Google Docs from My_Profile (filtered by "cv"/"template" in filename)
  2. If two or more templates are found, asks Claude to select the most suitable one
  3. Asks Claude to tailor the selected CV for the specific role
  4. Asks Claude to write a cover letter using the tailored CV for context
  5. Logs the generated content lengths (Drive save stubbed — Session 27)

Files changed:
- manifest.json: added https://www.googleapis.com/auth/drive to oauth2.scopes (full Drive
  write access needed to save the generated package to the user's own folders in Session 27).
- sidepanel/sidepanel.html: added .action-row--package containing #btn-prepare-package and
  #package-status div below the existing Save/Clear action row.
- sidepanel/sidepanel.css: added .action-row--package, .btn--package (with hover/disabled
  states), .package-status, and .package-status.package-error styles.
- utils/ai-helpers.js: appended three new prompt builders:
    buildSelectTemplatePrompt(job, cv1Text, cv1Name, cv2Text, cv2Name) — returns JSON with
      "selected" ("1" or "2") and "reason"
    buildTailorCVPrompt(job, cvTemplateText) — returns full tailored CV as plain text
    buildCoverLetterPrompt(job, cvText) — returns 3-4 paragraph cover letter as plain text
- sidepanel/sidepanel.js: added btnPreparePackage and packageStatus DOM refs; added
  btnPreparePackage click listener; added handlePreparePackage() async function implementing
  the five-step pipeline above.
- drive/drive-api.js: added readCVTemplatesFromDrive(accessToken, rootFolderId) inserted
  before checkExistingApplication. Finds My_Profile, lists Google Docs, filters by
  /cv|template/i in filename (falls back to all docs), exports up to 3 as plain text,
  returns array of { id, name, text }.

Note: Drive save is stubbed — after cover letter generation the handler logs content lengths
and shows "Package generated! (Drive save coming in next session)". Session 27 will replace
the TODO with a call to savePreparedPackage().

Test results: Manual testing required.
  1. Reload the extension. Re-authenticate if prompted (new drive scope).
  2. Add at least one Google Doc CV template to My_Profile in Drive (name it with "CV" or
     "Template" in the filename).
  3. Navigate to a LinkedIn or Indeed job and open the side panel.
  4. Ensure an Anthropic API key is set in Settings.
  5. Click "Prepare Package" — confirm the status bar cycles through the steps.
  6. Open the side panel DevTools console and confirm CV/cover letter lengths are logged.
  7. Confirm the status shows "Package generated!" at the end.
Known issues: Drive save not yet implemented (Session 27).
Next steps: Session 27 — implement savePreparedPackage() in drive-api.js and wire into handler.

---

Session 25 — Complete
Date: 2026-02-26
Branch: feature-session25-scrape-on-focus
What was built:
Fixed scraping on panel reopen by adding a visibilitychange listener that fires REQUEST_SCRAPE
every time the panel becomes visible.

Root cause:
DOMContentLoaded fires only once — when the side panel's document first loads. Closing and
reopening the panel doesn't reload the document; Chrome preserves the panel's page state.
This meant REQUEST_SCRAPE was only sent on the very first open. Subsequent open/close cycles
produced a stale or empty panel even when the active tab had a new job loaded.

Changes:
- sidepanel/sidepanel.js: added a document visibilitychange listener immediately after the
  DOMContentLoaded block. When document.visibilityState becomes 'visible', it queries the
  active tab and sends REQUEST_SCRAPE. Errors are caught and logged. This fires on every
  panel open after the first, covering close/reopen and tab switches.
- sidepanel/sidepanel.js: increased the DOMContentLoaded retry timeout from 1500ms to 2500ms
  to give content scripts more time to initialise on slow page loads.

Test results: Manual testing required.
  1. Reload the extension in chrome://extensions.
  2. Navigate to a LinkedIn job page. Open the side panel — confirm job data appears.
  3. Close the side panel. Navigate to a different LinkedIn job. Reopen the panel.
  4. Confirm the panel now shows the new job (not the previous one).
  5. Repeat on an Indeed page to confirm both content scripts respond.
Known issues: None.
Next steps: Manual end-to-end test. If passing, merge to main.

---

Session 24 — Complete
Date: 2026-02-26
Branch: feature-session24-status-badge
What was built:
Two improvements: more reliable initial load and an always-visible application status bar
replacing the previous hidden duplicate-warning banner.

Fix 1 — More reliable REQUEST_SCRAPE:
  The previous implementation fired REQUEST_SCRAPE once at panel open with no fallback. If the
  content script hadn't finished initialising yet, the scrape was lost.

  - sidepanel/sidepanel.js: replaced the single REQUEST_SCRAPE send with a version that also
    sets a 1.5 s timeout: if currentJob is still null after that delay, it re-reads session
    storage one more time. This covers the case where the content script was slow to start and
    the JOB_DATA_EXTRACTED message arrived after the initial session-storage check but before
    the timeout fires — in that case the guard (if (currentJob) return) skips the re-read.

Fix 2 — Always-visible job status bar:
  The previous approach hid the duplicate banner until a match was found, giving no feedback
  during the Drive check. Replaced with a persistent status bar that cycles through states:
  Checking Drive... → Not yet saved / In Preparation / Submitted / Previously rejected.

  - sidepanel/sidepanel.html: replaced #msg-duplicate with #job-status-bar containing
    #job-status-icon and #job-status-text spans.
  - sidepanel/sidepanel.css: removed .msg--duplicate and .msg--duplicate-serious; added
    .job-status-bar base styles and five state modifiers:
      .status-unknown  (grey)  — initial/checking state
      .status-new      (grey)  — not yet saved to Drive
      .status-prep     (amber) — folder found in Preparation
      .status-submitted (blue) — folder found in Submitted
      .status-rejected  (red)  — folder found in Rejected
  - sidepanel/sidepanel.js:
    - Replaced msgDuplicate DOM ref with jobStatusBar, jobStatusText, jobStatusIcon.
    - Added setStatusBar(status) helper.
    - showJob(): calls setStatusBar('checking') immediately (was hiding a banner).
    - checkDuplicate(): rewritten to use setStatusBar for all outcomes including errors
      (falls back to 'new' on any exception).
    - handleClear(): removed msgDuplicate hide line (status bar is inside stateJob which
      is hidden on clear); btnEvaluate.disabled = false retained.

Test results: Manual testing required.
  1. Reload the extension in chrome://extensions.
  2. Navigate to a LinkedIn or Indeed job page and open the side panel.
  3. Confirm the status bar shows "Checking Drive..." briefly then "Not yet saved".
  4. Save the job to Drive, then re-open the side panel on the same page.
  5. Confirm the status bar shows "In Preparation".
  6. Move the Drive folder to Submitted; confirm "Submitted" and Evaluate Fit disabled.
  7. Move to Rejected; confirm "Previously rejected" and Evaluate Fit disabled.
Known issues: None.
Next steps: Manual end-to-end test. If passing, merge to main.

---

Session 23 — Complete
Date: 2026-02-26
Branch: feature-session23-fixes
What was built:
Two fixes: on-demand scraping when the side panel opens, and debug logging for the duplicate
application check.

Fix 1 — On-demand scrape on panel open:
  The side panel was showing empty when opened on a page that had already loaded, because the
  initial auto-scrape ran before the panel existed and session storage was empty.

  - sidepanel/sidepanel.js: In DOMContentLoaded, after the session storage restore block, added
    a chrome.tabs.query call to find the active tab and send it a REQUEST_SCRAPE message. If no
    content script is present on the tab (e.g. a non-job page), the sendMessage promise rejects
    silently via .catch(). Errors from the tabs.query call are caught and logged.
  - content-scripts/linkedin.js: Added chrome.runtime.onMessage listener at the bottom of the
    file. Calls runScrape() when a REQUEST_SCRAPE message is received.
  - content-scripts/indeed.js: Same listener added, also calling runScrape().

Fix 2 — Duplicate check debug logging:
  Added console.log statements to help diagnose cases where the duplicate check silently finds
  nothing even though a matching folder should exist.

  - sidepanel/sidepanel.js, checkDuplicate(): Logs job.company / job.jobTitle before calling
    checkExistingApplication, and logs the raw match result immediately after.
  - drive/drive-api.js, checkExistingApplication(): Logs the sanitised folder name and all three
    status folder IDs (prepId, subId, rejId) after reading them from storage. This makes it
    immediately visible in the console whether the IDs are populated or empty strings.

Test results: Manual testing required.
  1. Reload the extension in chrome://extensions.
  2. Navigate to a LinkedIn or Indeed job page (let it fully load first).
  3. Open the side panel — confirm job data appears immediately without needing to reload the page.
  4. Open DevTools on the side panel and check the console for the duplicate check log lines.
  5. Confirm the folder name and IDs are logged correctly when Evaluate Fit runs.
Known issues: None.
Next steps: Manual end-to-end test. If passing, merge to main.

---

Session 22 — Complete
Date: 2026-02-26
Branch: main (merge session)
What was built:
Merged all outstanding feature branches from Sessions 16–21 into main. All merges were
fast-forwards with no conflicts.

Branches merged (in order):
  feature-sidepanel-script-fix           → Session 16: remove bad script tags from sidepanel.html
  feature-linkedin-collections-selectors → Session 17: add location selector for collections layout
  feature-evaluate-fit                   → Session 18: wire up Evaluate Fit end-to-end
  feature-evaluate-fit-profile           → Session 19: read candidate profile from Drive
  feature-fix-profile-read               → Session 21: add drive.readonly scope to manifest
  feature-duplicate-check                → Session 20: duplicate application check in side panel
    (already included in feature-fix-profile-read — reported "Already up to date")

State of main after merge: all Sessions 1–21 present and integrated.

Test results: No automated tests. Manual end-to-end test recommended:
  1. Reload extension from chrome://extensions.
  2. Re-authenticate to pick up the new drive.readonly scope.
  3. Navigate to a LinkedIn job page, open side panel — confirm job data populates.
  4. Click Evaluate Fit — confirm fit score and collapsibles render.
  5. Save to Drive — confirm job folder and files created correctly.
  6. Re-open the same job — confirm duplicate warning banner appears.
Known issues: None.
Next steps: End-to-end manual smoke test across all features.

---

Session 21 — Complete
Date: 2026-02-26
Branch: feature-fix-profile-read
What was built:
Fixed the drive.file scope limitation that prevented readProfileFromDrive from reading Google Docs
created by the user directly (not by the extension).

Root cause:
The drive.file OAuth scope only permits access to files that the extension itself created via the
Drive API. Google Docs placed in My_Profile by the user are not owned by the extension, so the
export API call (files/{id}/export?mimeType=text/plain) returned 403 Forbidden. The error was
caught and silently swallowed inside the per-file try/catch in readProfileFromDrive, resulting in
an empty texts array and the throw "No readable profile files found in My_Profile". This error
propagated up to handleEvaluate(), which caught it and logged "Could not load profile — evaluating
without it", causing Evaluate Fit to run without any profile context.

Fix:
- manifest.json: added https://www.googleapis.com/auth/drive.readonly to the oauth2.scopes array.
  This scope grants read access to all files in the user's Drive, enabling the export endpoint to
  return the Google Doc content. The existing drive.file and drive.metadata.readonly scopes are
  retained. No code changes required — the existing readProfileFromDrive implementation is correct.

Testing note:
After reloading the extension, the user must re-authenticate to grant the new scope. The existing
OAuth token will not include drive.readonly until consent is re-granted. To force re-auth:
  Option A: Open the JobLink setup page and reconnect Google Drive.
  Option B: Go to myaccount.google.com/permissions, revoke JobLink access, then trigger any Drive
  action in the extension to re-prompt the OAuth consent screen.

Test results: Manual testing required.
  1. Reload the extension in chrome://extensions.
  2. Re-authenticate to grant the new drive.readonly scope.
  3. Ensure My_Profile folder exists in the JobLink root Drive folder, containing at least one
     Google Doc or .txt file.
  4. Open the side panel on a job page and click Evaluate Fit.
  5. Confirm the evaluation runs with profile context (check console: no "Could not load profile"
     warning should appear).
  6. Confirm the fit score and collapsible sections render correctly.
Known issues: None.
Next steps: Manual end-to-end test. If passing, merge to main.

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
