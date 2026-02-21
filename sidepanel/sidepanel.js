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

// chrome.runtime.openOptionsPage() requires options_page/options_ui in manifest.json,
// which is not declared. Use chrome.tabs.create directly instead.
settingsBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('setup/setup.html') });
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
  stateEmpty.style.display = 'none';
  stateJob.style.display   = 'flex';
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
  stateJob.style.display   = 'none';
  stateEmpty.style.display = 'flex';
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
