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
const settingsBtn    = document.getElementById('settings-btn');

// AI evaluation elements
const btnDashboard      = document.getElementById('btn-dashboard');
const aiProvider        = document.getElementById('ai-provider');
const btnEvaluate       = document.getElementById('btn-evaluate');
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
const btnPreparePackage = document.getElementById('btn-prepare-package');
const packageStatus     = document.getElementById('package-status');

// ── Module state ──────────────────────────────────────────────

/** The raw job object currently displayed (before user edits). */
let currentJob = null;

// ── Initialisation ────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Restore any job captured earlier in this browser session
  // (handles the panel being closed and re-opened mid-session)
  try {
    const result = await chrome.storage.session.get(SESSION_KEYS.CURRENT_JOB);
    if (result[SESSION_KEYS.CURRENT_JOB]) {
      showJob(result[SESSION_KEYS.CURRENT_JOB]);
    }
  } catch (err) {
    console.warn('[JobLink] Could not restore job from session storage:', err);
  }

  // Send REQUEST_SCRAPE to the active tab.
  // If session storage was empty (job not yet scraped), wait 1.5s then check again.
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_SCRAPE' })
        .catch(() => {});

      // If panel is still empty after 2.5s, check session storage again
      // (handles slow content script initialisation)
      if (!currentJob) {
        setTimeout(async () => {
          if (currentJob) return; // Already populated by message
          try {
            const result = await chrome.storage.session.get(SESSION_KEYS.CURRENT_JOB);
            if (result[SESSION_KEYS.CURRENT_JOB]) {
              showJob(result[SESSION_KEYS.CURRENT_JOB]);
            }
          } catch (_) {}
        }, 2500);
      }
    }
  } catch (err) {
    console.warn('[JobLink] Could not send REQUEST_SCRAPE:', err.message);
  }
});

// Re-send REQUEST_SCRAPE every time the panel becomes visible.
// DOMContentLoaded fires only once; this covers panel close/reopen and
// tab switches that bring the panel back into view on a different job.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_SCRAPE' })
        .catch(() => {});
    }
  } catch (err) {
    console.warn('[JobLink] visibilitychange REQUEST_SCRAPE failed:', err.message);
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
btnEvaluate.addEventListener('click', handleEvaluate);
btnPreparePackage.addEventListener('click', handlePreparePackage);

btnDashboard.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

// chrome.runtime.openOptionsPage() requires options_page/options_ui in manifest.json,
// which is not declared. Use chrome.tabs.create directly instead.
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
 * Populate the form fields and switch to the loaded state.
 *
 * @param {Object} job - Normalised job data from the scraper
 */
function showJob(job) {
  currentJob = job;

  // Source badge
  const source = (job.source || '').toLowerCase();
  sourceBadge.textContent = source === 'linkedin' ? 'LinkedIn' : 'Indeed';
  sourceBadge.className   = 'source-badge source-badge--' + source;

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

  hideMessages();
  setStatusBar('checking');
  stateEmpty.style.display = 'none';
  stateJob.style.display   = 'flex';

  // Fire the duplicate check in the background — non-blocking
  checkDuplicate(job);
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
  btnEvaluate.disabled = false;

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
      btnEvaluate.disabled = true;
    } else if (match.status === 'rejected') {
      setStatusBar('rejected');
      btnEvaluate.disabled = true;
    } else {
      setStatusBar('prep');
    }
  } catch (err) {
    console.warn('[JobLink] Duplicate check failed:', err.message);
    setStatusBar('new');
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
 */
function handleClear() {
  currentJob = null;
  chrome.storage.session.remove(SESSION_KEYS.CURRENT_JOB).catch(() => {});
  hideMessages();
  btnEvaluate.disabled     = false;
  stateJob.style.display   = 'none';
  stateEmpty.style.display = 'flex';
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
  btnEvaluate.disabled    = true;

  try {
    const provider = aiProvider.value;

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
        profileText = await readProfileFromDrive(token, rootFolderId);
      }
    } catch (profileErr) {
      console.warn('[JobLink] Could not load profile — evaluating without it:', profileErr.message);
    }

    const prompt = buildEvaluatePrompt({
      jobTitle:    fieldTitle.value.trim(),
      company:     fieldCompany.value.trim(),
      description: fieldDesc.value.trim(),
    }, profileText);

    const rawText = await callAI(provider, prompt);
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
    btnEvaluate.disabled    = false;
  }
}

/**
 * Prepare a tailored CV and cover letter for the current job using Claude AI.
 *
 * Flow:
 *   1. Read CV templates from My_Profile in Drive
 *   2. Ask Claude to pick the best template (if more than one)
 *   3. Ask Claude to tailor the CV for this specific role
 *   4. Ask Claude to write a cover letter
 *   5. Hand off to savePreparedPackage() — wired in Session 27
 */
async function handlePreparePackage() {
  if (!currentJob) return;

  btnPreparePackage.disabled  = true;
  packageStatus.className     = 'package-status';
  packageStatus.textContent   = '⏳ Reading your CV templates...';
  packageStatus.style.display = 'block';

  try {
    // 1. Get OAuth token
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: false }, (t) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(t);
      });
    });

    const rootFolderId = await getStorageValue(STORAGE_KEYS.DRIVE_ROOT_FOLDER_ID);
    if (!rootFolderId) throw new Error('No Drive folder configured.');

    // 2. Read CV templates from My_Profile
    const cvTemplates = await readCVTemplatesFromDrive(token, rootFolderId);
    if (cvTemplates.length < 1) throw new Error('No CV templates found in My_Profile.');

    const job = {
      jobTitle:    fieldTitle.value.trim(),
      company:     fieldCompany.value.trim(),
      description: fieldDesc.value.trim(),
    };

    // 3. Select best template (if only one, use it directly)
    let selectedTemplate = cvTemplates[0];
    if (cvTemplates.length >= 2) {
      packageStatus.textContent = '⏳ Selecting best CV template for this role...';
      const selectPrompt = buildSelectTemplatePrompt(
        job,
        cvTemplates[0].text, cvTemplates[0].name,
        cvTemplates[1].text, cvTemplates[1].name
      );
      const selectRaw    = await callAI('claude', selectPrompt);
      const selectResult = parseAIResponse(selectRaw);
      if (selectResult?.selected === '2') selectedTemplate = cvTemplates[1];
      console.log('[JobLink] Template selected:', selectedTemplate.name, '—', selectResult?.reason);
    }

    // 4. Generate tailored CV
    packageStatus.textContent = '⏳ Tailoring CV for this role...';
    const cvPrompt   = buildTailorCVPrompt(job, selectedTemplate.text);
    const tailoredCV = await callAI('claude', cvPrompt);

    // 5. Generate cover letter
    packageStatus.textContent = '⏳ Writing cover letter...';
    const clPrompt    = buildCoverLetterPrompt(job, tailoredCV);
    const coverLetter = await callAI('claude', clPrompt);

    packageStatus.textContent = '⏳ Saving package to Drive...';

    // 6. Hand off to Drive (Session 27)
    // TODO: call savePreparedPackage(token, currentJob, tailoredCV, coverLetter, selectedTemplate.name)
    console.log('[JobLink] Package ready — CV length:', tailoredCV.length, 'CL length:', coverLetter.length);
    packageStatus.textContent = '✅ Package generated! (Drive save coming in next session)';

  } catch (err) {
    packageStatus.className   = 'package-status package-error';
    packageStatus.textContent = '❌ ' + (err.message || 'Package preparation failed.');
    console.error('[JobLink] Prepare package error:', err);
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
