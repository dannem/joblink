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

const stateEmpty          = document.getElementById('state-empty');
const stateJob            = document.getElementById('state-job');
const upgradeBanner       = document.getElementById('upgrade-banner');
const upgradeCtaBtn       = document.getElementById('upgrade-cta-btn');
const upgradeHaveKeyBtn   = document.getElementById('upgrade-have-key-btn');
const proStatusBadge      = document.getElementById('pro-status-badge');
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
const closeBtn       = document.getElementById('close-btn');

// AI evaluation elements
const btnDashboard      = document.getElementById('btn-dashboard');
const aiSpinner         = document.getElementById('ai-spinner');
const aiError           = document.getElementById('ai-error');
const aiResults         = document.getElementById('ai-results');
const fitScoreNumber    = document.getElementById('fit-score-number');
const aiCorrespondence  = document.getElementById('ai-correspondence');
const aiDiscrepancies   = document.getElementById('ai-discrepancies');
const aiRecommendation  = document.getElementById('ai-recommendation');
const btnCheckStatus = document.getElementById('btn-check-status');
const statusResult   = document.getElementById('status-result');
const driveLinkContainer  = document.getElementById('drive-link-container');
const driveLink           = document.getElementById('drive-link');
const btnPreparePackage  = document.getElementById('btn-prepare-package');
const btnEvaluateFit     = document.getElementById('evaluate-fit-btn');
const packageType        = document.getElementById('package-type');
const packageModel       = document.getElementById('package-model');
const packageStatus      = document.getElementById('package-status');
const packageProgress    = document.getElementById('package-progress');

const DEFAULT_CV_TEMPLATE = {
  id: 'default-cv',
  name: 'Default CV Template',
  text: `
    [Your Name]
    [Your Contact Information]

    PROFESSIONAL SUMMARY
    [Your Professional Summary]

    WORK EXPERIENCE
    [Your Most Recent Role]
    * [Bullet point 1]
    * [Bullet point 2]
    * [Bullet point 3]
  `
};

const DEFAULT_CL_TEMPLATE = {
    id: 'default-cl',
    name: 'Default Cover Letter Template',
    text: `
      [Your Name]
      [Your Contact Information]

      [Date]

      [Hiring Manager Name] (If known, otherwise use title)
      [Hiring Manager Title]
      [Company Name]
      [Company Address]

      Dear [Mr./Ms./Mx. Last Name],

      [Body Paragraph 1: Introduction]
      [Body Paragraph 2: Elaborate on your skills and experience]
      [Body Paragraph 3: Closing]

      Sincerely,
      [Your Name]
    `
};

/**
 * Maps package-model dropdown values to AI_MODELS constants.
 * Used by enrichCompanyMetadata, handleSave, handleEvaluate, and handlePreparePackage.
 */
const MODEL_MAP = {
  sonnet:           'claude-sonnet-4-6',
  haiku:            'claude-haiku-4-5-20251001',
  'gpt-4o':         'gpt-4o',
  'gpt-4o-mini':    'gpt-4o-mini',
  'gpt-4-turbo':    'gpt-4-turbo',
  o1:               'o1',
  'o1-mini':        'o1-mini',
  'o3-mini':        'o3-mini',
  geminiFlash3:    'gemini-3-flash-preview',
  geminiPro31:     'gemini-3.1-pro-preview',
  geminiFlashLite: 'gemini-3.1-flash-lite-preview',
  gemini25Flash:   'gemini-2.5-flash',
};

// ── Module state ──────────────────────────────────────────────

/** The raw job object currently displayed (before user edits). */
let currentJob = null;

/** True once the current job has been successfully saved to Drive. */
let currentJobSaved = false;

/** Which documents to generate in Prepare Package: 'both' | 'cv' | 'cl' */
let currentPackageMode = 'both';

// ── Initialisation ────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Always start with a blank slate — never show stale data from a previous session.
  clearJobOnStartup();

  // Show unconfigured state for brand-new users who haven't completed setup
  try {
    const setupComplete = await getStorageValue(STORAGE_KEYS.SETUP_COMPLETE);
    if (!setupComplete) {
      document.getElementById('empty-configured').style.display = 'none';
      document.getElementById('empty-unconfigured').style.display = 'flex';
      document.getElementById('empty-unconfigured').style.flexDirection = 'column';
      document.getElementById('empty-unconfigured').style.alignItems = 'center';
    }
  } catch (_) { /* non-fatal — defaults to configured state */ }

  // Load saved default AI model and populate the dropdown
  try {
    await refreshModelDropdown();

  } catch (_) { /* non-fatal — dropdown stays at HTML default */ }

  try {
    const savedPackage = await getStorageValue(STORAGE_KEYS.DEFAULT_PACKAGE);
    if (savedPackage) {
      currentPackageMode = savedPackage;
      packageType.value  = savedPackage;
    }
  } catch (_) { /* non-fatal — defaults to 'both' */ }

  // Show Pro badge and pre-check gate
  await refreshProStatus();

  // Trigger a fresh scrape from the active tab.
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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

// ── Storage change listener — keep Pro badge and model dropdown in sync ───────

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync') return;

  const proKeys = [
    STORAGE_KEYS.LICENCE_VALID,
    STORAGE_KEYS.ANTHROPIC_API_KEY,
    STORAGE_KEYS.OPENAI_API_KEY,
    STORAGE_KEYS.GEMINI_API_KEY,
  ];
  if (proKeys.some(k => k in changes)) {
    await refreshProStatus();
    // Re-run the dropdown filter with updated keys
    await refreshModelDropdown();
  }

  if (STORAGE_KEYS.DEFAULT_AI_MODEL in changes) {
    await refreshModelDropdown();
  }
  if (STORAGE_KEYS.DEFAULT_PACKAGE in changes) {
    const newVal = changes[STORAGE_KEYS.DEFAULT_PACKAGE].newValue;
    if (newVal) {
      currentPackageMode = newVal;
      packageType.value  = newVal;
    }
  }
});

/**
 * Re-read the saved API keys and re-apply the disabled/enabled state and
 * best-available selection to the package-model dropdown.
 * Called on DOMContentLoaded and whenever API keys change in storage.
 */
async function refreshModelDropdown() {
  try {
    const [savedModel, anthropic, openai, gemini] = await Promise.all([
      getStorageValue(STORAGE_KEYS.DEFAULT_AI_MODEL),
      getStorageValue(STORAGE_KEYS.ANTHROPIC_API_KEY),
      getStorageValue(STORAGE_KEYS.OPENAI_API_KEY),
      getStorageValue(STORAGE_KEYS.GEMINI_API_KEY),
    ]);

    // If savedModel references a retired Gemini 1.5 model, clear it
    const retiredModels = ['geminiFlash25', 'geminiPro15'];
    const effectiveSavedModel = retiredModels.includes(savedModel) ? null : savedModel;

    const allModels = [
      { value: 'sonnet', text: 'Claude 3.5 Sonnet (Best)', provider: 'anthropic' },
      { value: 'haiku', text: 'Claude 3 Haiku (Fastest)', provider: 'anthropic' },
      { value: 'o1', text: 'OpenAI GPT-4o', provider: 'openai' },
      { value: 'o1-mini', text: 'OpenAI GPT-4o mini', provider: 'openai' },
      { value: 'gpt-4-turbo', text: 'OpenAI GPT-4 Turbo', provider: 'openai' },
      { value: 'geminiFlash3',    text: 'Gemini 3 Flash — best quality',   provider: 'gemini' },
      { value: 'geminiPro31',     text: 'Gemini 3.1 Pro — most capable',   provider: 'gemini' },
      { value: 'geminiFlashLite', text: 'Gemini 3.1 Flash-Lite — fastest', provider: 'gemini' },
      { value: 'gemini25Flash',   text: 'Gemini 2.5 Flash — stable',       provider: 'gemini' },
    ];

    packageModel.innerHTML = '';

    const availableModels = allModels.filter(model => {
      if (model.provider === 'anthropic') return !!anthropic;
      if (model.provider === 'openai') return !!openai;
      if (model.provider === 'gemini') return !!gemini;
      return false;
    });

    if (availableModels.length > 0) {
      availableModels.forEach(model => {
        const option = document.createElement('option');
        option.value = model.value;
        option.textContent = model.text;
        packageModel.appendChild(option);
      });
    } else {
      const option = document.createElement('option');
      option.value = 'no-keys';
      option.textContent = 'No API keys set in Settings';
      option.disabled = true;
      packageModel.appendChild(option);
    }

    const PROVIDER_PRIORITY = ['sonnet', 'geminiFlash3', 'o1', 'haiku'];
    if (effectiveSavedModel && availableModels.some(m => m.value === effectiveSavedModel)) {
      packageModel.value = effectiveSavedModel;
    } else if (availableModels.length > 0) {
      const fallback = PROVIDER_PRIORITY.find(v => availableModels.some(m => m.value === v));
      if (fallback) {
        packageModel.value = fallback;
      } else {
        packageModel.value = availableModels[0].value;
      }
    }

  } catch (_) { /* non-fatal */ }
}

// ── Button handlers ───────────────────────────────────────────

btnSave.addEventListener('click', handleSave);
btnClear.addEventListener('click', handleClear);
btnCheckStatus.addEventListener('click', handleCheckStatus);
document.getElementById('stale-warning-dismiss').addEventListener('click', () => {
  staleWarning.style.display = 'none';
});
btnPreparePackage.addEventListener('click', handlePreparePackage);
btnEvaluateFit.addEventListener('click', handleEvaluate);

btnDashboard.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

document.getElementById('btn-open-setup').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('setup/setup.html') });
});

// Gear icon opens the settings / setup page in a new tab.
settingsBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('setup/setup.html') });
});

closeBtn.addEventListener('click', () => window.close());

document.querySelectorAll('.collapsible-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const body  = btn.nextElementSibling;
    const arrow = btn.querySelector('.collapsible-arrow');
    const isOpen = body.style.display !== 'none';
    body.style.display  = isOpen ? 'none' : 'block';
    arrow.textContent   = isOpen ? '▼' : '▲';
  });
});

upgradeHaveKeyBtn.addEventListener('click', () => {
  hideUpgradeBanner();
  chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS' });
});

// Banner hides when any other part of the panel is clicked
document.addEventListener('click', (e) => {
  if (!upgradeBanner.contains(e.target) &&
      e.target !== btnEvaluateFit &&
      e.target !== btnPreparePackage) {
    hideUpgradeBanner();
  }
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
  currentJobSaved = false;

  fieldTitle.value        = '';
  fieldCompany.value      = '';
  fieldLocation.value     = '';
  fieldDesc.value         = '';
  fieldUrl.href           = '';
  fieldUrl.textContent    = '—';
  scrapedTime.textContent = '';
  sourceBadge.textContent = '';
  sourceBadge.className   = 'source-badge';

  stateJob.style.display        = 'none';
  stateEmpty.style.display      = 'flex';
  staleWarning.style.display    = 'none';
  driveLinkContainer.style.display = 'none';
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
    if (parsed.hostname === 'indeed.com' || parsed.hostname.endsWith('.indeed.com')) {
      const jk = parsed.searchParams.get('jk');
      if (jk) return 'indeed:' + jk;
      return null; // Indeed search/home page — no job identity
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
    statusResult.style.display  = 'none';
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

  const title = job.jobTitle || '';

  // Only apply feed/notification checks to LinkedIn URLs — these patterns
  // could produce false positives on generic career pages.
  const isLinkedIn = url.includes('linkedin.com');
  const looksStale =
    title.toLowerCase().includes('top job picks') ||
    title.toLowerCase().includes('picks for you') ||
    (isLinkedIn && title.toLowerCase().includes('notifications')) ||
    (isLinkedIn && url.includes('/feed'));

  // If the data doesn't look like a real job, show the stale warning and
  // stay in (or return to) the empty state — don't populate any fields.
  if (looksStale) {
    staleWarning.style.display = 'flex';
    stateJob.style.display     = 'none';
    stateEmpty.style.display   = 'flex';
    currentJob = null;
    return;
  }

  staleWarning.style.display = 'none';

  // Reset package progress so the previous job's steps don't persist
  resetProgress(currentPackageMode, false);

  hideMessages();
  statusResult.style.display = 'none';
  stateEmpty.style.display = 'none';
  stateJob.style.display   = 'flex';

  // Fire background tasks — non-blocking
  enrichCompanyMetadata(job);
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
  const pro = await isProUser();
  if (!pro) return;   // silent no-op for free users
  const co = job.company || '';
  const needsEnrichment = !co || co.length > 50 ||
    co.includes('employees') || co.includes('Metropolitan');

  if (!needsEnrichment || !job.description) return;

  try {
    const selectedModel = MODEL_MAP[packageModel.value] || AI_MODELS.claude;
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
      const selectedModel = MODEL_MAP[packageModel.value] || AI_MODELS.claude;
      const extracted = await extractJobMetadata(jobToSave.description, null, selectedModel);
      if (extracted.company) {
        jobToSave.company  = extracted.company;
        fieldCompany.value = extracted.company;
      }
      if (extracted.location) {
        jobToSave.location  = extracted.location;
        fieldLocation.value = extracted.location;
      }
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
      statusResult.className   = 'status-result status-result--prep';
      statusResult.textContent = '📝 In Preparation';
      statusResult.style.display = 'block';
      currentJobSaved = true;
      if (response.folderUrl) showDriveLink(response.folderUrl);
    } else {
      showError(friendlyDriveError(response?.error || 'Save failed — please try again.'));
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
  currentJobSaved = false;
  chrome.storage.session.remove(SESSION_KEYS.CURRENT_JOB).catch(() => {});
  hideMessages();
  driveLinkContainer.style.display = 'none';
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
 * On demand: query Drive for this job's application status and show the result
 * inline below the action buttons. Works for LinkedIn, Indeed, and any site.
 */
async function handleCheckStatus() {
  if (!currentJob) return;

  statusResult.className    = 'status-result status-result--checking';
  statusResult.textContent  = '⏳ Checking Drive…';
  statusResult.style.display = 'block';

  try {
    const token = await getOAuthToken(false);

    const match = await checkExistingApplication(token, currentJob);

    if (!match) {
      statusResult.className   = 'status-result status-result--new';
      statusResult.textContent = '🆕 Not yet saved';
    } else if (match.status === 'submitted') {
      statusResult.className   = 'status-result status-result--submitted';
      statusResult.textContent = '📤 Submitted';
      if (match.folder?.id) showDriveLink(`https://drive.google.com/drive/folders/${match.folder.id}`);
    } else if (match.status === 'rejected') {
      statusResult.className   = 'status-result status-result--rejected';
      statusResult.textContent = '❌ Previously rejected';
      if (match.folder?.id) showDriveLink(`https://drive.google.com/drive/folders/${match.folder.id}`);
    } else {
      statusResult.className   = 'status-result status-result--prep';
      statusResult.textContent = '📝 In Preparation';
      if (match.folder?.id) showDriveLink(`https://drive.google.com/drive/folders/${match.folder.id}`);
    }
  } catch (err) {
    statusResult.className   = 'status-result status-result--new';
    statusResult.textContent = '⚠️ Could not check — ' + (err.message || 'Drive error');
  }
}

/**
 * Refresh the Pro badge in the header to reflect current gate status.
 */
async function refreshProStatus() {
  const pro = await isProUser();
  proStatusBadge.style.display = 'inline';
  if (pro) {
    proStatusBadge.textContent = 'Pro';
    proStatusBadge.className = 'pro-badge pro-badge--pro';
  } else {
    proStatusBadge.textContent = 'Free';
    proStatusBadge.className = 'pro-badge pro-badge--free';
  }
}

/**
 * Show the upgrade banner and scroll it into view.
 * Hides automatically if the user clicks outside it.
 */
function showUpgradeBanner() {
  upgradeBanner.style.display = 'block';
  upgradeBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Hide the upgrade banner.
 */
function hideUpgradeBanner() {
  upgradeBanner.style.display = 'none';
}

/**
 * Validate all prerequisites before running an AI operation.
 * Returns an object with:
 *   - aiError: string|null — fatal AI access error (no keys at all)
 *   - aiWarning: string|null — non-fatal AI warning (Pro key but no API key for selected model)
 *   - profileError: string|null — fatal profile error (not set, or empty)
 *   - profileWarning: string|null — non-fatal profile warning (content too short)
 *   - profileText: string — the loaded profile text (empty string if unavailable)
 *   - token: string|null — the OAuth token (null if unavailable)
 *
 * @returns {Promise<{aiError, aiWarning, profileError, profileWarning, profileText, token}>}
 */
async function validateAIPrerequisites() {
  const result = {
    aiError: null,
    aiWarning: null,
    profileError: null,
    profileWarning: null,
    profileText: '',
    token: null,
  };

  // ── AI access check ──────────────────────────────────────────
  const [anthropic, openai, gemini, licenceValid] = await Promise.all([
    getStorageValue(STORAGE_KEYS.ANTHROPIC_API_KEY),
    getStorageValue(STORAGE_KEYS.OPENAI_API_KEY),
    getStorageValue(STORAGE_KEYS.GEMINI_API_KEY),
    getStorageValue(STORAGE_KEYS.LICENCE_VALID),
  ]);

  const hasAnyApiKey = !!(anthropic || openai || gemini);
  const hasPro = !!licenceValid;

  if (!hasAnyApiKey && !hasPro) {
    result.aiError = 'JobLink Pro is required for AI features. Upgrade at the Settings page, or enter your own API keys under AI Provider Keys.';
    return result; // No point checking further
  }

  if (!hasAnyApiKey) {
    result.aiWarning = 'No AI API keys set. Add at least one API key in Settings → AI Provider Keys.';
  } else if (packageModel.value === 'no-keys') {
    result.aiWarning = 'No AI model available. Check your API keys in Settings → AI Provider Keys.';
  }

  // ── OAuth token ──────────────────────────────────────────────
  try {
    result.token = await getOAuthToken(false);
  } catch (_) {
    // Non-fatal for profile loading — token failure handled later
  }

  // ── Profile folder checks ────────────────────────────────────
  const profileFolderId = await getStorageValue(STORAGE_KEYS.PROFILE_FOLDER_ID);

  if (!profileFolderId) {
    result.profileError = 'No profile folder set. Go to Settings → Application Materials and select the folder containing your CV and background documents.';
  } else if (!result.token) {
    // Can't check folder contents without a token — treat as warning not error
    result.profileWarning = 'Could not verify your profile folder — Google Drive not connected. Reconnect in Settings.';
  } else {
    try {
      const profileDocs = await readDocsFromFolder(result.token, profileFolderId);

      if (profileDocs.length === 0) {
        result.profileError = 'Your profile folder is empty. Add your CV or professional background as Google Docs to the selected folder in Drive.';
      } else {
        result.profileText = profileDocs.map(d => `=== ${d.name} ===\n${d.text}`).join('\n\n');

        if (result.profileText.length < 200) {
          result.profileWarning = 'Your profile folder doesn\'t appear to contain useful background information. Make sure it contains Google Docs with your professional history, not empty or non-text files.';
        }
      }
    } catch (err) {
      result.profileWarning = 'Could not read your profile folder from Drive. Check your Google Drive connection in Settings.';
      console.warn('[JobLink] Profile folder read failed:', err.message);
    }
  }

  return result;
}

/**
 * Run an AI fit evaluation for the currently displayed job.
 * Reads the API key from storage, calls the selected provider via ai-helpers.js,
 * and renders the score and collapsible result sections.
 */
async function handleEvaluate() {
  const pro = await isProUser();
  if (!pro) {
    showUpgradeBanner();
    return;
  }
  if (!currentJob) return;

  aiSpinner.style.display = 'block';
  aiError.style.display   = 'none';
  aiResults.style.display = 'none';

  try {
    const prereqs = await validateAIPrerequisites();

    // Collect all error and warning messages
    const errorMessages   = [prereqs.aiError,   prereqs.profileError ].filter(Boolean);
    const warningMessages = [prereqs.aiWarning,  prereqs.profileWarning].filter(Boolean);
    const allMessages     = [...errorMessages, ...warningMessages];

    if (allMessages.length > 0) {
      aiError.textContent   = allMessages.join(' ');
      aiError.style.display = 'block';
    }

    // Stop if there are any fatal errors
    if (errorMessages.length > 0) {
      aiSpinner.style.display = 'none';
      return;
    }

    const profileText   = prereqs.profileText;
    const selectedModel = MODEL_MAP[packageModel.value] || AI_MODELS.claude;

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
  for (let i = 0; i < 9; i++) {
    const row = document.getElementById(`progress-step-${i}`);
    if (row) row.style.display = '';
    updateProgress(i, 'pending');
  }
  const hide = (...ids) => ids.forEach(id => {
    const r = document.getElementById(id); if (r) r.style.display = 'none';
  });
  if (packageMode === 'cv') {
    hide('progress-step-2', 'progress-step-4', 'progress-step-6', 'progress-step-7', 'progress-step-8');
  } else if (packageMode === 'cl') {
    hide('progress-step-1', 'progress-step-3', 'progress-step-6', 'progress-step-7', 'progress-step-8');
  } else if (packageMode === 'both') {
    hide('progress-step-6', 'progress-step-7', 'progress-step-8');
  }
  // packageMode === 'academic': all 9 steps visible
  packageProgress.style.display = show ? 'block' : 'none';
  packageStatus.style.display   = 'none';
  packageStatus.className       = 'package-status';
  packageStatus.textContent     = '';
  if (!show) driveLinkContainer.style.display = 'none';
}

async function handlePreparePackage() {
  const pro = await isProUser();
  if (!pro) {
    showUpgradeBanner();
    return;
  }
  if (!currentJob) return;

  // Merge any field edits into a jobToSave object used for both AI prompts and saving
  const jobToSave = {
    ...currentJob,
    jobTitle:    fieldTitle.value.trim(),
    company:     fieldCompany.value.trim(),
    location:    fieldLocation.value.trim(),
    description: fieldDesc.value.trim(),
  };

  // Read packageMode from the sidepanel dropdown (user's active choice).
  // currentPackageMode is only used to set the initial dropdown value on startup.
  const rawMode = packageType.value || currentPackageMode;
  const packageMode = rawMode === 'cv_only' ? 'cv' : rawMode === 'cl_only' ? 'cl' : rawMode;

  let parsedCVData = null;
  btnPreparePackage.disabled = true;
  resetProgress(packageMode); // shows container and hides irrelevant rows

  // Track the active step so the catch block can mark it as errored.
  let activeStep = -1;

  try {
    // Pre-flight validation — check AI access and profile before starting UI
    const prereqs = await validateAIPrerequisites();

    // Collect all error and warning messages
    const errorMessages   = [prereqs.aiError,   prereqs.profileError ].filter(Boolean);
    const warningMessages = [prereqs.aiWarning,  prereqs.profileWarning].filter(Boolean);
    const allMessages     = [...errorMessages, ...warningMessages];

    if (allMessages.length > 0) {
      packageStatus.className     = errorMessages.length > 0
        ? 'package-status package-error'
        : 'package-status package-warning';
      packageStatus.textContent   = allMessages.join(' ');
      packageStatus.style.display = 'block';
    }

    // Stop if there are any fatal errors
    if (errorMessages.length > 0) {
      btnPreparePackage.disabled = false;
      return;
    }

    const profileText = prereqs.profileText;
    const token       = prereqs.token;

    // Step 0 — Profile loaded (mark done — actual loading was done in validateAIPrerequisites)
    activeStep = 0;
    updateProgress(0, profileText ? 'done' : 'skipped');

    const rootFolderId = await getStorageValue(STORAGE_KEYS.DRIVE_ROOT_FOLDER_ID);
    if (!rootFolderId) throw new Error('No save folder set. Open Settings and choose a Google Drive folder first.');

    // Resolve selected AI model from the dropdown (used by CV and CL tailoring)
    const selectedModel = MODEL_MAP[packageModel.value] || AI_MODELS.claude;

    // Step 1 — Read CV template (skip when mode is 'cl')
    let selectedTemplate = null;
    let currentSummary = '';
    const currentBullets = [];
    if (packageMode !== 'cl') {
      activeStep = 1;
      updateProgress(1, 'active');
      const cvFolderId = await getStorageValue(STORAGE_KEYS.CV_TEMPLATES_FOLDER_ID);
      let cvTemplates = null; // Will be set below
      if (cvFolderId) {
        try {
          const userCvTemplates = await readDocsFromFolder(token, cvFolderId);
          if (userCvTemplates.length > 0) {
            cvTemplates = userCvTemplates;
          }
        } catch (err) {
          console.warn('[JobLink] Could not read CV templates folder:', err.message);
        }
      }

      // No CV folder set or empty — search Drive for any CV/Resume doc
      if (!cvTemplates) {
        try {
          const foundCV = await findCVDocInDrive(token);
          if (foundCV) {
            console.log('[JobLink] Found CV doc in Drive:', foundCV.name);
            cvTemplates = [foundCV];
          }
        } catch (err) {
          console.warn('[JobLink] Could not search Drive for CV:', err.message);
        }
      }

      // Final fallback — use default template
      if (!cvTemplates) {
        cvTemplates = [DEFAULT_CV_TEMPLATE];
      }

      selectedTemplate = cvTemplates[0];
      if (cvTemplates.length >= 2) {
        const selectPrompt = buildSelectTemplatePrompt(jobToSave, profileText, cvTemplates);
        const selectRaw    = await callAI('claude', selectPrompt, selectedModel);
        const selectResult = parseAIResponse(selectRaw);
        const idx = (selectResult?.selected ?? 1) - 1;
        if (idx > 0 && idx < cvTemplates.length) selectedTemplate = cvTemplates[idx];
      }

      // Skip Google Docs API call for the default template
      if (selectedTemplate.id !== 'default-cv') {
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
      } else {
          // For the default template, we can extract a dummy summary and bullets
          currentSummary = 'A highly motivated and skilled professional seeking a challenging role.';
          currentBullets.push('Key achievement 1.');
          currentBullets.push('Key achievement 2.');
          currentBullets.push('Key achievement 3.');
      }
      updateProgress(1, 'done');
    } else {
      updateProgress(1, 'skipped');
    }

    // Step 2 — Read CL template (skip when mode is 'cv')
    let clTemplateDocId = null;
    if (packageMode !== 'cv') {
      activeStep = 2;
      updateProgress(2, 'active');
      const clFolderId = await getStorageValue(STORAGE_KEYS.CL_TEMPLATES_FOLDER_ID);
      let clTemplate = DEFAULT_CL_TEMPLATE; // Default fallback
      if (clFolderId) {
        try {
          const userClTemplates = await readDocsFromFolder(token, clFolderId, 3);
          if (userClTemplates.length > 0) {
            clTemplate = userClTemplates[0];
          }
        } catch (err) {
          console.warn('[JobLink] Could not read CL template folder, using default:', err.message);
        }
      }
      clTemplateDocId = clTemplate.id;
      updateProgress(2, 'done');
    }

    // Step 3 — Tailor CV (skip when mode is 'cl')
    let newSummary = currentSummary;
    let newBullets = [...currentBullets];
    if (packageMode !== 'cl') {
      activeStep = 3;
      updateProgress(3, 'active');
      const usingRealTemplate = selectedTemplate && selectedTemplate.id !== 'default-cv';
      try {
        const structuredPrompt = buildTailorCVStructuredPrompt(jobToSave, profileText, currentSummary, currentBullets);
        const rawJson = await callAI('claude', structuredPrompt, selectedModel);
        const parsed = parseAIResponse(rawJson);
        if (parsed && parsed.summary) newSummary = parsed.summary;
        if (parsed && Array.isArray(parsed.bullets) && parsed.bullets.length > 0) newBullets = parsed.bullets;
        if (parsed && parsed.experience) parsedCVData = parsed;
        console.log('[JobLink] parsedCVData set:', !!parsedCVData, parsedCVData ? Object.keys(parsedCVData) : 'null');
      } catch (err) {
        console.warn('[JobLink] Structured CV tailoring failed, using originals:', err.message);
      }
      updateProgress(3, 'done');
    } else {
      updateProgress(3, 'skipped');
    }

    // Step 4 — Tailor cover letter (skip when mode is 'cv')
    let clBodyParagraphs = null;
    let clCompanyBlock = { name: jobToSave.company || '', department: '', location: jobToSave.location || '' };
    if (packageMode !== 'cv') {
      activeStep = 4;
      updateProgress(4, 'active');
      if (clTemplateDocId) {
        const clPrompt = buildCLBodyPrompt(jobToSave, newSummary);
        const rawClJson = await callAI('claude', clPrompt, selectedModel);
        const parsed = parseAIResponse(rawClJson);
        if (parsed && Array.isArray(parsed.bodyParagraphs) && parsed.bodyParagraphs.length > 0) {
          clBodyParagraphs = parsed.bodyParagraphs;
        }
        if (parsed && parsed.companyBlock && typeof parsed.companyBlock === 'object') {
          clCompanyBlock = parsed.companyBlock;
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

    // Use null for default template IDs so savePreparedPackage knows not to
    // make a Docs API call against a non-Google-Doc ID.
    const cvTemplateDocId = (selectedTemplate && selectedTemplate.id !== 'default-cv')
      ? selectedTemplate.id
      : null;
    const resolvedClTemplateDocId = (clTemplateDocId && clTemplateDocId !== 'default-cl')
      ? clTemplateDocId
      : null;

    const clData = {
      templateDocId:  resolvedClTemplateDocId,
      companyBlock:   clCompanyBlock,
      bodyParagraphs: clBodyParagraphs,
    };
    console.log('[JobLink] cvTemplateDocId:', cvTemplateDocId, 'parsedCVData:', !!parsedCVData);
    const saveResult = await savePreparedPackage(
      token, jobToSave,
      { templateDocId: cvTemplateDocId, newSummary, newBullets, parsedCV: (!cvTemplateDocId && parsedCVData) ? parsedCVData : null },
      clData,
      selectedTemplate?.name ?? '',
      { pdfBase64, htmlContent, jsonContent }
    );

    updateProgress(5, 'done');

    // Steps 6, 7, 8 — Academic statements (academic mode only)
    if (packageMode === 'academic' && saveResult?.submittedFolderId) {
      const academicSteps = [
        { step: 6, label: 'Research Statement',  buildPrompt: () => buildResearchStatementPrompt(jobToSave, profileText) },
        { step: 7, label: 'Diversity Statement', buildPrompt: () => buildDiversityStatementPrompt(jobToSave, profileText) },
        { step: 8, label: 'Teaching Statement',  buildPrompt: () => buildTeachingStatementPrompt(jobToSave, profileText) },
      ];
      for (const { step, label, buildPrompt } of academicSteps) {
        activeStep = step;
        updateProgress(step, 'active');
        const prompt = buildPrompt();
        const text = await callAI('claude', prompt, selectedModel);
        const docTitle = `${label} - ${jobToSave.jobTitle || 'Application'} (${jobToSave.company || 'Company'})`;
        await saveAcademicDocToDrive(token, saveResult.submittedFolderId, docTitle, text);
        updateProgress(step, 'done');
      }
    }

    statusResult.className   = 'status-result status-result--submitted';
    statusResult.textContent = '📤 Submitted';
    statusResult.style.display = 'block';
    if (saveResult?.submittedFolderId) {
      showDriveLink(`https://drive.google.com/drive/folders/${saveResult.submittedFolderId}`);
    }

  } catch (err) {
    if (activeStep >= 0) updateProgress(activeStep, 'error');
    packageStatus.className   = 'package-status package-error';
    packageStatus.textContent = friendlyDriveError(err) || 'Package preparation failed.';
    packageStatus.style.display = 'block';
    console.error('[JobLink] Prepare package error:', err);
    console.error('[JobLink] Error stack:', err.stack);
  } finally {
    btnPreparePackage.disabled = false;
  }
}

/**
 * Translate a raw Drive/OAuth error message into plain English for the user.
 * Catches the most common failure modes — any unrecognised error passes through as-is.
 *
 * @param {Error|string} err
 * @returns {string} User-facing message
 */
function friendlyDriveError(err) {
  const msg = (err?.message || String(err)).toLowerCase();
  if (msg.includes('no drive folder configured') || msg.includes('no folder configured')) {
    return 'No save folder set. Open Settings and choose a Google Drive folder first.';
  }
  if (msg.includes('not signed in') || msg.includes('oauth') || msg.includes('invalid_grant') || msg.includes('unauthorized') || msg.includes('401')) {
    return 'Google Drive sign-in expired. Open Settings and reconnect your account.';
  }
  if (msg.includes('403') || msg.includes('forbidden') || msg.includes('access denied') || msg.includes('insufficient permission')) {
    return 'Google Drive access denied. Check your Drive permissions in Settings.';
  }
  if (msg.includes('quota') || msg.includes('storage') || msg.includes('limit')) {
    return 'Google Drive storage full or quota exceeded. Free up space in Drive and try again.';
  }
  if (msg.includes('network') || msg.includes('failed to fetch') || msg.includes('load failed')) {
    return 'Network error — check your internet connection and try again.';
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'Request timed out. Check your connection and try again.';
  }
  if (msg.includes('no cv templates folder') || msg.includes('cv template')) {
    return 'No CV Templates folder set. Open Settings and choose your CV Templates folder.';
  }
  if (msg.includes('no cv template documents')) {
    return 'No CV template documents found. Add a Google Doc to your CV Templates folder in Drive.';
  }
  if (msg.includes('no readable profile')) {
    return 'No readable profile files found in your My_Profile folder. Add Google Docs or text files there.';
  }
  // Return original message if no pattern matched, but capitalise the first letter
  const original = err?.message || String(err);
  return original.charAt(0).toUpperCase() + original.slice(1);
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

/**
 * Show the Drive folder link below the Save/Clear buttons.
 * @param {string} url - Full Drive folder URL
 */
function showDriveLink(url) {
  driveLink.href = url;
  driveLinkContainer.style.display = 'block';
}

/** Hide both status banners. */
function hideMessages() {
  msgSuccess.style.display = 'none';
  msgError.style.display   = 'none';
}
