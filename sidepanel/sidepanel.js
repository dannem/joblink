/**
 * Side panel UI logic for JobLink.
 *
 * Manages two UI states:
 *   empty  — no job captured yet; shows instructional message
 *   loaded — job data ready for review/edit before saving to Drive
 *
 * Data flow in:
 *   Content script → service worker (normalises & stores) →
 *   chrome.runtime.sendMessage → onMessage listener here
 *   OR: chrome.storage.session (restores data when the panel is re-opened)
 *
 * Data flow out:
 *   Save button → SAVE_TO_DRIVE message → service worker (stubbed in Session 6,
 *   real Drive upload wired in Session 7)
 */

// ── DOM references ────────────────────────────────────────────

const stateEmpty     = document.getElementById('state-empty');
const stateJob       = document.getElementById('state-job');
const sourceBadge    = document.getElementById('source-badge');
const scrapedTime    = document.getElementById('scraped-time');
const fieldTitle     = document.getElementById('field-title');
const fieldCompany   = document.getElementById('field-company');
const fieldLocation  = document.getElementById('field-location');
const fieldUrl       = document.getElementById('field-url');
const fieldDesc      = document.getElementById('field-description');
const btnSave        = document.getElementById('btn-save');
const btnClear       = document.getElementById('btn-clear');
const msgSuccess     = document.getElementById('msg-success');
const msgError       = document.getElementById('msg-error');
const staleWarning   = document.getElementById('stale-warning');
const settingsBtn    = document.getElementById('settings-btn');

// AI evaluation elements
const btnDashboard      = document.getElementById('btn-dashboard');
const aiSpinner         = document.getElementById('ai-spinner');
const aiError           = document.getElementById('ai-error');
const aiResults         = document.getElementById('ai-results');
const fitScoreNumber    = document.getElementById('fit-score-number');
const aiCorrespondence  = document.getElementById('ai-correspondence');
const aiDiscrepancies   = document.getElementById('ai-discrepancies');
const aiRecommendation  = document.getElementById('ai-recommendation');
const jobStatusBar      = document.getElementById('job-status-bar');
const jobStatusText     = document.getElementById('job-status-text');
const jobStatusIcon     = document.getElementById('job-status-icon');
const btnPreparePackage  = document.getElementById('btn-prepare-package');
const btnEvaluateFit     = document.getElementById('evaluate-fit-btn');
const packageModel       = document.getElementById('package-model');
const packageStatus      = document.getElementById('package-status');
const packageProgress    = document.getElementById('package-progress');

// ── Module state ──────────────────────────────────────────────

/** The raw job object currently displayed (before user edits). */
let currentJob = null;

/** Which documents to generate in Prepare Package: 'both' | 'cv' | 'cl' */
let currentPackageMode = 'both';

// ── Initialisation ────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Always start with a blank slate — never show stale data from a previous session.
  clearJobOnStartup();

  // Load saved default AI model and package mode.
  try {
    const savedModel = await getStorageValue(STORAGE_KEYS.DEFAULT_AI_MODEL);
    if (savedModel) packageModel.value = savedModel;
  } catch (_) { /* non-fatal — dropdown stays at HTML default */ }

  try {
    const savedPackage = await getStorageValue(STORAGE_KEYS.DEFAULT_PACKAGE);
    if (savedPackage) currentPackageMode = savedPackage;
  } catch (_) { /* non-fatal — defaults to 'both' */ }

  // Trigger a fresh scrape from the active tab.
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log('[JobLink] DOMContentLoaded tab.url:', tab?.url);
    if (tab?.id) {
      // In the empty state, show the refresh banner so the user knows to
      // reload if nothing populates — hide it once a good job arrives.
      if (!currentJob && isJobRelevantUrl(tab.url)) {
        staleWarning.style.display = 'flex';
      }

      requestScrapeIfJobChanged(tab);

      // Fallback: one retry after 3 s for cold-start tabs where the content
      // script was still initialising when the panel opened.
      setTimeout(() => {
        if (currentJob) return;
        chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_SCRAPE' }, () => {
          void chrome.runtime.lastError;
        });
      }, 3000);
    }
  } catch (err) {
    console.warn('[JobLink] Could not initiate scrape on panel open:', err.message);
  }
});

// On every visibility gain (panel reopened, tab switched) check whether the
// active tab has changed to a different job.  If so, clear stale data and
// scrape.  If the same job is still showing, do nothing.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) requestScrapeIfJobChanged(tab);
  } catch (err) {
    console.warn('[JobLink] visibilitychange scrape check failed:', err.message);
  }
});

// ── Incoming messages ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'JOB_DATA_EXTRACTED' && message.payload) {
    showJob(message.payload);
  }
});

// ── Button handlers ───────────────────────────────────────────

btnSave.addEventListener('click', handleSave);
btnClear.addEventListener('click', handleClear);
document.getElementById('stale-warning-dismiss').addEventListener('click', () => {
  staleWarning.style.display = 'none';
});
btnPreparePackage.addEventListener('click', handlePreparePackage);
btnEvaluateFit.addEventListener('click', handleEvaluate);

btnDashboard.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

// Gear icon opens the settings / setup page in a new tab.
settingsBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('setup/setup.html') });
});

document.querySelectorAll('.collapsible-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const body  = btn.nextElementSibling;
    const arrow = btn.querySelector('.collapsible-arrow');
    const isOpen = body.style.display !== 'none';
    body.style.display  = isOpen ? 'none' : 'block';
    arrow.textContent   = isOpen ? '▼' : '▲';
  });
});

// ── UI functions ──────────────────────────────────────────────

/**
 * Reset all job fields and UI state to a clean blank slate.
 * Called at the very start of DOMContentLoaded so the panel never shows stale
 * data from a previous session before the fresh scrape arrives.
 * Also clears session storage so the old job does not re-appear on the next open.
 */
function clearJobOnStartup() {
  currentJob = null;

  fieldTitle.value        = '';
  fieldCompany.value      = '';
  fieldLocation.value     = '';
  fieldDesc.value         = '';
  fieldUrl.href           = '';
  fieldUrl.textContent    = '—';
  scrapedTime.textContent = '';
  sourceBadge.textContent = '';
  sourceBadge.className   = 'source-badge';

  stateJob.style.display      = 'none';
  stateEmpty.style.display    = 'flex';
  staleWarning.style.display  = 'none';
  hideMessages();

  chrome.storage.session.remove(SESSION_KEYS.CURRENT_JOB).catch(() => {});
}

/**
 * Return true when a URL is a regular web page (http/https).
 * Returns false for new-tab pages, chrome:// URLs, and anything else that
 * cannot host a content script.
 *
 * @param {string|undefined} url
 * @returns {boolean}
 */
function isJobRelevantUrl(url) {
  return typeof url === 'string' &&
    (url.startsWith('http://') || url.startsWith('https://'));
}

/**
 * Extract a stable job identity string from a URL.
 *
 * LinkedIn: returns the numeric job ID found in the currentJobId query param
 * or the /jobs/view/{id} path segment (both formats map to the same posting).
 * Other sites: returns origin + pathname + search so any URL change is caught.
 * Returns null when no URL is provided or parsing fails.
 *
 * @param {string|undefined} url
 * @returns {string|null}
 */
function jobIdFromUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'linkedin.com' || parsed.hostname.endsWith('.linkedin.com')) {
      const fromQuery = parsed.searchParams.get('currentJobId');
      if (fromQuery) return fromQuery;
      const m = parsed.pathname.match(/\/jobs\/view\/(\d+)/);
      if (m) return m[1];
      return null; // LinkedIn list/feed page — no job identity
    }
    return parsed.origin + parsed.pathname + parsed.search;
  } catch (_) {
    return null;
  }
}

/**
 * Optionally clear the displayed job, then always request a fresh scrape.
 *
 * The job-ID comparison is used only to decide whether to clear the panel:
 * if the tab shows a different job than what is currently displayed, clear
 * immediately so stale data does not linger while the scrape is in flight.
 * If the IDs match (same job), leave the display as-is while the refresh runs.
 *
 * The scrape is fired unconditionally — the match check never short-circuits it.
 * Two parallel paths ensure delivery in warm and cold-start scenarios:
 *   1. Direct chrome.tabs.sendMessage (instant when content script is loaded)
 *   2. SIDEPANEL_OPENED to the service worker (injects the content script first
 *      if it is not yet present — handles cold-start tabs)
 *
 * @param {{id: number, url?: string}} tab
 */
function requestScrapeIfJobChanged(tab) {
  if (!tab?.id) return;

  const tabJobId       = jobIdFromUrl(tab.url);
  const displayedJobId = currentJob ? jobIdFromUrl(currentJob.applicationUrl) : null;
  const sameJob        = tabJobId && displayedJobId && tabJobId === displayedJobId;

  // Clear the panel only when the job has changed — keeps the display stable
  // on same-job refreshes while still preventing stale data on navigation.
  if (currentJob && !sameJob) {
    currentJob = null;
    stateJob.style.display      = 'none';
    stateEmpty.style.display    = 'flex';
    staleWarning.style.display  = isJobRelevantUrl(tab.url) ? 'flex' : 'none';
    hideMessages();
  }

  // Always scrape — the match check above never prevents this.
  // Path 1: direct to content script — fast path, no service-worker round-trip
  chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_SCRAPE' }, () => {
    void chrome.runtime.lastError; // suppress "no receiver" on chrome-internal URLs
  });

  // Path 2: service worker injects the content script if not yet present
  chrome.runtime.sendMessage({ type: 'SIDEPANEL_OPENED', tabId: tab.id })
    .catch(() => {});
}

/**
 * Populate the form fields and switch to the loaded state.
 *
 * @param {Object} job - Normalised job data from the scraper
 */
function showJob(job) {
  currentJob = job;

  // Source badge
  const source = (job.source || '').toLowerCase();
  const badgeLabels = { linkedin: 'LinkedIn', indeed: 'Indeed', generic: 'WEB' };
  sourceBadge.textContent = badgeLabels[source] || 'WEB';
  sourceBadge.className   = 'source-badge source-badge--' + (source || 'generic');

  // Capture time
  if (job.scrapedAt) {
    const d = new Date(job.scrapedAt);
    scrapedTime.textContent = d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Editable fields
  fieldTitle.value    = job.jobTitle    || '';
  fieldCompany.value  = job.company     || '';
  fieldLocation.value = job.location    || '';
  fieldDesc.value     = job.description || '';

  // Read-only URL link
  const url = job.applicationUrl || '';
  fieldUrl.href        = url;
  fieldUrl.textContent = url || '—';

  // Stale data check — show yellow warning when the title looks like a LinkedIn
  // feed/collection heading rather than an actual job title.
  // Note: length-based checks are intentionally omitted — real job titles can
  // exceed 80 characters and would cause false positives.
  const title = job.jobTitle || '';
  const looksStale = title.toLowerCase().includes('top job picks') ||
    title.toLowerCase().includes('picks for you');
  staleWarning.style.display = looksStale ? 'flex' : 'none';

  // Reset package progress so the previous job's steps don't persist
  resetProgress(currentPackageMode, false);

  hideMessages();
  setStatusBar('checking');
  stateEmpty.style.display = 'none';
  stateJob.style.display   = 'flex';

  // Fire background tasks — non-blocking
  checkDuplicate(job);
  enrichCompanyMetadata(job);
}

/**
 * Update the always-visible status bar to reflect the application state.
 *
 * @param {'checking'|'new'|'prep'|'submitted'|'rejected'} status
 */
function setStatusBar(status) {
  const states = {
    checking:  { cls: 'status-unknown',   icon: '⏳', text: 'Checking Drive...' },
    new:       { cls: 'status-new',       icon: '🆕', text: 'Not yet saved' },
    prep:      { cls: 'status-prep',      icon: '📝', text: 'In Preparation' },
    submitted: { cls: 'status-submitted', icon: '📤', text: 'Submitted' },
    rejected:  { cls: 'status-rejected',  icon: '❌', text: 'Previously rejected' },
  };
  const s = states[status] || states.checking;
  jobStatusBar.className    = 'job-status-bar ' + s.cls;
  jobStatusIcon.textContent = s.icon;
  jobStatusText.textContent = s.text;
}

/**
 * Check whether a folder matching this job exists in any status subfolder and
 * update the status bar accordingly.
 *
 * Non-fatal — errors fall back to 'new' so the panel stays functional even
 * when Drive is unreachable or no status folders are configured.
 *
 * @param {Object} job - { company, jobTitle } from the current job
 */
async function checkDuplicate(job) {
  setStatusBar('checking');

  try {
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: false }, (t) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(t);
      });
    });

    if (!token) { setStatusBar('new'); return; }

    console.log('[JobLink] Checking duplicate for:', job.company, '/', job.jobTitle);
    const match = await checkExistingApplication(token, job);
    console.log('[JobLink] Duplicate check result:', match);

    if (!match) {
      setStatusBar('new');
    } else if (match.status === 'submitted') {
      setStatusBar('submitted');
    } else if (match.status === 'rejected') {
      setStatusBar('rejected');
    } else {
      setStatusBar('prep');
    }
  } catch (err) {
    console.warn('[JobLink] Duplicate check failed:', err.message);
    setStatusBar('new');
  }
}

/**
 * If the scraped company is missing or looks like a LinkedIn DOM artefact,
 * ask the AI to extract the real company name and location from the description.
 * Runs non-blocking after showJob() — updates currentJob and the visible fields
 * in place when the result arrives.
 *
 * The currentJob === job guard prevents a stale response from overwriting a
 * newer job if the user navigated to a different posting before the call returned.
 *
 * @param {Object} job - The job object as returned by the scraper
 */
async function enrichCompanyMetadata(job) {
  const co = job.company || '';
  const needsEnrichment = !co || co.length > 50 ||
    co.includes('employees') || co.includes('Metropolitan');

  if (!needsEnrichment || !job.description) return;

  try {
    const modelMap = {
      sonnet:           AI_MODELS.claude,
      haiku:            AI_MODELS.claudeHaiku,
      geminiFlash25:    AI_MODELS.geminiFlash25,
      'gemini-2.5-pro': AI_MODELS.geminiPro,
    };
    const selectedModel = modelMap[packageModel.value] || AI_MODELS.claude;
    const extracted = await extractJobMetadata(job.description, null, selectedModel);

    if (currentJob !== job) return; // User has moved to a different job — discard

    if (extracted.company) {
      currentJob.company = extracted.company;
      fieldCompany.value = extracted.company;
    }
    if (extracted.location) {
      currentJob.location = extracted.location;
      fieldLocation.value = extracted.location;
    }
    console.log('[JobLink] Enriched company/location on load:', extracted);
  } catch (err) {
    console.warn('[JobLink] enrichCompanyMetadata failed:', err.message);
  }
}

/**
 * Collect the current (possibly edited) field values and request a Drive save.
 * Generates the PDF here (jsPDF cannot run in a service worker), then sends
 * the job data and the base64 PDF together in one message.
 * The service worker handles the actual upload; this function manages UI state.
 */
async function handleSave() {
  if (!currentJob) return;

  // Merge user edits back into the job object
  const jobToSave = {
    ...currentJob,
    jobTitle:     fieldTitle.value.trim(),
    company:      fieldCompany.value.trim(),
    location:     fieldLocation.value.trim(),
    description:  fieldDesc.value.trim(),
  };

  setSaving(true);
  hideMessages();

  // If the scraped company looks wrong (empty, too long, or contains known
  // junk strings from LinkedIn's DOM), ask the AI to extract it from the
  // description before saving.
  const co = jobToSave.company;
  const companyLooksWrong = !co || co.length > 50 ||
    co.includes('employees') || co.includes('Metropolitan');

  if (companyLooksWrong && jobToSave.description) {
    try {
      const modelMap = {
        sonnet:           AI_MODELS.claude,
        haiku:            AI_MODELS.claudeHaiku,
        geminiFlash25:    AI_MODELS.geminiFlash25,
        'gemini-2.5-pro': AI_MODELS.geminiPro,
      };
      const selectedModel = modelMap[packageModel.value] || AI_MODELS.claude;
      const extracted = await extractJobMetadata(jobToSave.description, null, selectedModel);
      if (extracted.company) {
        jobToSave.company  = extracted.company;
        fieldCompany.value = extracted.company;
      }
      if (extracted.location) {
        jobToSave.location  = extracted.location;
        fieldLocation.value = extracted.location;
      }
      console.log('[JobLink] AI-corrected metadata:', extracted);
    } catch (metaErr) {
      console.warn('[JobLink] extractJobMetadata failed — saving with original values:', metaErr.message);
    }
  }

  // Generate the PDF in the side panel — jsPDF is not available in the service worker.
  // If generation fails, log the error and continue without PDF so JSON/HTML are not blocked.
  let pdfBase64 = '';
  try {
    pdfBase64 = generateJobPdfBase64(jobToSave);
  } catch (pdfErr) {
    console.warn('[JobLink] PDF generation failed — save will continue without PDF:', pdfErr);
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type:     'SAVE_TO_DRIVE',
      payload:  jobToSave,
      pdfBase64,
    });

    if (response && response.success) {
      showSuccess();
    } else {
      showError(response?.error || 'Save failed — please try again.');
    }
  } catch (err) {
    showError('Could not reach the service worker. Try reloading the extension.');
    console.error('[JobLink] Save error:', err);
  } finally {
    setSaving(false);
  }
}

/**
 * Reset to the empty state and remove the stored job from session storage.
 * Shows the stale-data banner if the active tab is still on a web page,
 * so the user knows a refresh will re-capture.
 */
async function handleClear() {
  currentJob = null;
  chrome.storage.session.remove(SESSION_KEYS.CURRENT_JOB).catch(() => {});
  hideMessages();
  stateJob.style.display   = 'none';
  stateEmpty.style.display = 'flex';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    staleWarning.style.display = isJobRelevantUrl(tab?.url) ? 'flex' : 'none';
  } catch (_) {
    staleWarning.style.display = 'none';
  }
}

/**
 * Run an AI fit evaluation for the currently displayed job.
 * Reads the API key from storage, calls the selected provider via ai-helpers.js,
 * and renders the score and collapsible result sections.
 */
async function handleEvaluate() {
  if (!currentJob) return;

  aiSpinner.style.display = 'block';
  aiError.style.display   = 'none';
  aiResults.style.display = 'none';

  try {
    const modelMap = {
      sonnet:           AI_MODELS.claude,
      haiku:            AI_MODELS.claudeHaiku,
      geminiFlash25:    AI_MODELS.geminiFlash25,
      'gemini-2.5-pro': AI_MODELS.geminiPro,
    };
    const selectedModel = modelMap[packageModel.value] || AI_MODELS.claude;

    // Attempt to load the candidate profile from Drive before building the prompt.
    // Failure is non-fatal — evaluation proceeds with a no-profile notice in the prompt.
    let profileText = '';
    try {
      const token = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: false }, (t) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(t);
        });
      });
      const rootFolderId = await getStorageValue(STORAGE_KEYS.DRIVE_ROOT_FOLDER_ID);
      if (token && rootFolderId) {
        const profileFolderId = await findFolderByName(token, rootFolderId, 'My_Profile');
        if (profileFolderId) {
          const profileDocs = await readDocsFromFolder(token, profileFolderId);
          profileText = profileDocs.map(d => `=== ${d.name} ===\n${d.text}`).join('\n\n');
        }
      }
    } catch (profileErr) {
      console.warn('[JobLink] Could not load profile — evaluating without it:', profileErr.message);
    }

    const prompt = buildEvaluatePrompt({
      jobTitle:    fieldTitle.value.trim(),
      company:     fieldCompany.value.trim(),
      description: fieldDesc.value.trim(),
    }, profileText);

    const rawText = await callAI('claude', prompt, selectedModel);
    const result  = parseAIResponse(rawText);

    if (!result || typeof result.score !== 'number') {
      throw new Error('AI returned an unexpected response format.');
    }

    fitScoreNumber.textContent = result.score;
    fitScoreNumber.className   = 'fit-score-number ' + (
      result.score >= 70 ? 'score-green' :
      result.score >= 40 ? 'score-amber' : 'score-red'
    );

    aiCorrespondence.textContent = result.correspondence  || '';
    aiDiscrepancies.textContent  = result.discrepancies   || '';
    aiRecommendation.textContent = result.recommendation  || '';

    aiResults.style.display = 'block';
  } catch (err) {
    aiError.textContent   = err.message || 'Evaluation failed.';
    aiError.style.display = 'block';
  } finally {
    aiSpinner.style.display = 'none';
  }
}

/**
 * Prepare a tailored CV and cover letter for the current job using Claude AI.
 *
 * Flow:
 *   1. Read candidate profile from My_Profile folder in Drive
 *   2. Read CV templates from the configured CV Templates folder
 *   3. Ask Claude to pick the best template (if more than one)
 *   4. Ask Claude to tailor the CV for this specific role
 *   5. Ask Claude to write a cover letter
 *   6. Save the package to Drive via savePreparedPackage()
 */
/**
 * Update one step row in the package progress list.
 *
 * @param {number} step   - 0-based index matching the progress-step-N ids
 * @param {'pending'|'active'|'done'|'error'} status
 */
function updateProgress(step, status) {
  const ICONS = { pending: '⏳', active: '🔄', done: '✅', error: '❌', skipped: '—' };
  const row = document.getElementById(`progress-step-${step}`);
  if (!row) return;
  row.querySelector('.progress-icon').textContent = ICONS[status] ?? '⏳';
  row.className = `progress-step progress-step--${status}`;
}

/**
 * Reset all step rows to pending, hide rows irrelevant to the package mode,
 * and optionally show the progress container.
 *
 * @param {'both'|'cv'|'cl'} packageMode
 * @param {boolean} [show=true] - Pass false to hide the container (e.g. on job change)
 */
function resetProgress(packageMode, show = true) {
  // Show all rows first, then hide the ones not needed for this mode
  for (let i = 0; i < 6; i++) {
    const row = document.getElementById(`progress-step-${i}`);
    if (row) row.style.display = '';
    updateProgress(i, 'pending');
  }
  if (packageMode === 'cv') {
    // CV only — hide CL-related steps
    const r2 = document.getElementById('progress-step-2');
    const r4 = document.getElementById('progress-step-4');
    if (r2) r2.style.display = 'none';
    if (r4) r4.style.display = 'none';
  } else if (packageMode === 'cl') {
    // CL only — hide CV-related steps
    const r1 = document.getElementById('progress-step-1');
    const r3 = document.getElementById('progress-step-3');
    if (r1) r1.style.display = 'none';
    if (r3) r3.style.display = 'none';
  }
  packageProgress.style.display = show ? 'block' : 'none';
  packageStatus.style.display   = 'none';
  packageStatus.className       = 'package-status';
  packageStatus.textContent     = '';
}

async function handlePreparePackage() {
  if (!currentJob) return;
  console.log('[JobLink] handlePreparePackage start — currentPackageMode:', currentPackageMode);

  // Merge any field edits into a jobToSave object used for both AI prompts and saving
  const jobToSave = {
    ...currentJob,
    jobTitle:    fieldTitle.value.trim(),
    company:     fieldCompany.value.trim(),
    location:    fieldLocation.value.trim(),
    description: fieldDesc.value.trim(),
  };

  // Normalize storage values ('cv_only'/'cl_only') to internal short form ('cv'/'cl').
  const rawMode = currentPackageMode;
  const packageMode = rawMode === 'cv_only' ? 'cv' : rawMode === 'cl_only' ? 'cl' : rawMode;
  console.log('[JobLink] handlePreparePackage: currentPackageMode =', currentPackageMode, '→ packageMode =', packageMode);

  btnPreparePackage.disabled = true;
  resetProgress(packageMode); // shows container and hides irrelevant rows

  // Track the active step so the catch block can mark it as errored.
  let activeStep = -1;

  try {
    // Infrastructure — get OAuth token (no progress step)
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: false }, (t) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(t);
      });
    });

    const rootFolderId = await getStorageValue(STORAGE_KEYS.DRIVE_ROOT_FOLDER_ID);
    if (!rootFolderId) throw new Error('No Drive folder configured.');

    // Step 0 — Read candidate profile from My_Profile (always; non-fatal)
    activeStep = 0;
    updateProgress(0, 'active');
    let profileText = '';
    try {
      const profileFolderId = await findFolderByName(token, rootFolderId, 'My_Profile');
      if (profileFolderId) {
        const profileDocs = await readDocsFromFolder(token, profileFolderId);
        profileText = profileDocs.map(d => `=== ${d.name} ===\n${d.text}`).join('\n\n');
      }
    } catch (_) { /* non-fatal — proceed without profile */ }
    updateProgress(0, 'done');

    // Resolve selected AI model from the dropdown (used by CV and CL tailoring)
    const modelMap = {
      sonnet:           AI_MODELS.claude,
      haiku:            AI_MODELS.claudeHaiku,
      geminiFlash25:    AI_MODELS.geminiFlash25,
      'gemini-2.5-pro': AI_MODELS.geminiPro,
    };
    const selectedModel = modelMap[packageModel.value] || AI_MODELS.claude;

    // Step 1 — Read CV template (skip when mode is 'cl')
    let selectedTemplate = null;
    let currentSummary = '';
    const currentBullets = [];
    if (packageMode !== 'cl') {
      activeStep = 1;
      updateProgress(1, 'active');
      const cvFolderId = await getStorageValue(STORAGE_KEYS.CV_TEMPLATES_FOLDER_ID);
      if (!cvFolderId) throw new Error('No CV Templates folder configured. Open Settings to add it.');
      const cvTemplates = await readDocsFromFolder(token, cvFolderId);
      if (cvTemplates.length < 1) throw new Error('No CV template documents found in the CV Templates folder.');

      selectedTemplate = cvTemplates[0];
      if (cvTemplates.length >= 2) {
        const selectPrompt = buildSelectTemplatePrompt(jobToSave, profileText, cvTemplates);
        const selectRaw    = await callAI('claude', selectPrompt, selectedModel);
        const selectResult = parseAIResponse(selectRaw);
        const idx = (selectResult?.selected ?? 1) - 1;
        if (idx > 0 && idx < cvTemplates.length) selectedTemplate = cvTemplates[idx];
        console.log('[JobLink] Template selected:', selectedTemplate.name, '—', selectResult?.reason);
      }

      try {
        const docRes = await fetch(
          `https://docs.googleapis.com/v1/documents/${selectedTemplate.id}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (docRes.ok) {
          const doc = await docRes.json();
          const body = doc.body.content;

          function getParagraphText(paragraph) {
            return (paragraph.elements || [])
              .map(e => e.textRun?.content || '')
              .join('')
              .replace(/\n$/, '');
          }

          let foundSummaryHeading = false;
          let foundDirectorRole = false;
          let bulletCount = 0;

          for (const block of body) {
            if (!block.paragraph) continue;
            const text = getParagraphText(block.paragraph);
            if (text.includes('PROFESSIONAL SUMMARY')) { foundSummaryHeading = true; continue; }
            if (foundSummaryHeading && !currentSummary && text.trim().length > 20) {
              currentSummary = text;
            }
            if (text.includes('Director of Bioimaging')) { foundDirectorRole = true; continue; }
            if (foundDirectorRole && block.paragraph.bullet && text.trim().length > 0 && bulletCount < 4) {
              currentBullets.push(text);
              bulletCount++;
            }
          }
        }
      } catch (err) {
        console.warn('[JobLink] Could not read template structure:', err.message);
      }
      updateProgress(1, 'done');
    }

    // Step 2 — Read CL template (skip when mode is 'cv')
    let clTemplateDocId = null;
    if (packageMode !== 'cv') {
      activeStep = 2;
      updateProgress(2, 'active');
      const clFolderId = await getStorageValue(STORAGE_KEYS.CL_TEMPLATES_FOLDER_ID);
      if (clFolderId) {
        try {
          const clDocs = await readDocsFromFolder(token, clFolderId, 3);
          if (clDocs.length > 0) clTemplateDocId = clDocs[0].id;
        } catch (err) {
          console.warn('[JobLink] Could not read CL template folder:', err.message);
        }
      }
      updateProgress(2, 'done');
    }

    // Step 3 — Tailor CV (skip when mode is 'cl')
    let newSummary = currentSummary;
    let newBullets = [...currentBullets];
    if (packageMode !== 'cl') {
      activeStep = 3;
      updateProgress(3, 'active');
      if (currentSummary) {
        try {
          const structuredPrompt = buildTailorCVStructuredPrompt(jobToSave, profileText, currentSummary, currentBullets);
          const rawJson = await callAI('claude', structuredPrompt, selectedModel);
          const parsed = parseAIResponse(rawJson);
          if (parsed && parsed.summary) newSummary = parsed.summary;
          if (parsed && Array.isArray(parsed.bullets) && parsed.bullets.length > 0) newBullets = parsed.bullets;
        } catch (err) {
          console.warn('[JobLink] Structured CV tailoring failed, using originals:', err.message);
        }
      }
      updateProgress(3, 'done');
    }

    // Step 4 — Tailor cover letter (skip when mode is 'cv')
    let clBodyParagraphs = null;
    let clCompanyBlock = { name: jobToSave.company || '', department: '', location: jobToSave.location || '' };
    if (packageMode !== 'cv') {
      activeStep = 4;
      updateProgress(4, 'active');
      if (clTemplateDocId) {
        try {
          const clPrompt = buildCLBodyPrompt(jobToSave, newSummary);
          const rawClJson = await callAI('claude', clPrompt, selectedModel);
          const parsed = parseAIResponse(rawClJson);
          if (parsed && Array.isArray(parsed.bodyParagraphs) && parsed.bodyParagraphs.length > 0) {
            clBodyParagraphs = parsed.bodyParagraphs;
          }
          if (parsed && parsed.companyBlock && typeof parsed.companyBlock === 'object') {
            clCompanyBlock = parsed.companyBlock;
          }
          console.log('[JobLink] CL body paragraphs:', clBodyParagraphs ? clBodyParagraphs.length + ' paras' : 'NULL');
        } catch (err) {
          console.warn('[JobLink] CL generation failed:', err.message);
        }
      }
      updateProgress(4, 'done');
    }

    // Step 5 — Save to Drive (always)
    activeStep = 5;
    updateProgress(5, 'active');

    let pdfBase64 = '';
    try { pdfBase64 = generateJobPdfBase64(jobToSave); } catch (_) {}
    const htmlContent = generateJobSummaryHtml(jobToSave);
    const jsonContent = JSON.stringify(jobToSave, null, 2);

    const clData = {
      templateDocId:  clTemplateDocId,
      companyBlock:   clCompanyBlock,
      bodyParagraphs: clBodyParagraphs,
    };
    await savePreparedPackage(
      token, jobToSave,
      { templateDocId: selectedTemplate?.id ?? null, newSummary, newBullets },
      clData,
      selectedTemplate?.name ?? '',
      { pdfBase64, htmlContent, jsonContent }
    );

    updateProgress(5, 'done');
    setStatusBar('submitted');

  } catch (err) {
    if (activeStep >= 0) updateProgress(activeStep, 'error');
    packageStatus.className   = 'package-status package-error';
    packageStatus.textContent = err.message || 'Package preparation failed.';
    packageStatus.style.display = 'block';
    console.error('[JobLink] Prepare package error:', err);
    console.error('[JobLink] Error stack:', err.stack);
  } finally {
    btnPreparePackage.disabled = false;
  }
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Disable/re-enable buttons and update the Save button label during a save.
 *
 * @param {boolean} saving
 */
function setSaving(saving) {
  btnSave.disabled    = saving;
  btnClear.disabled   = saving;
  btnSave.textContent = saving ? 'Saving…' : 'Save to Drive';
}

/** Show the success banner, then auto-hide it after 3 s. */
function showSuccess() {
  msgSuccess.style.display = 'block';
  msgError.style.display   = 'none';
  setTimeout(() => {
    msgSuccess.style.display = 'none';
  }, 3000);
}

/**
 * Show the error banner with the given message.
 *
 * @param {string} text
 */
function showError(text) {
  msgError.textContent     = text;
  msgError.style.display   = 'block';
  msgSuccess.style.display = 'none';
}

/** Hide both status banners. */
function hideMessages() {
  msgSuccess.style.display = 'none';
  msgError.style.display   = 'none';
}
