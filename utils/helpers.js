/**
 * Shared utilities for JobLink extension.
 * All chrome.storage.sync keys must be defined here as constants.
 */

// chrome.storage.sync key constants — use these everywhere, never raw strings
const STORAGE_KEYS = {
  DRIVE_ROOT_FOLDER_ID: 'DRIVE_ROOT_FOLDER_ID',
  DRIVE_ROOT_FOLDER_NAME: 'DRIVE_ROOT_FOLDER_NAME',
  DRIVE_CV_FOLDER_ID: 'DRIVE_CV_FOLDER_ID',
  DRIVE_TEMPLATES_FOLDER_ID: 'DRIVE_TEMPLATES_FOLDER_ID',
  SETUP_COMPLETE: 'SETUP_COMPLETE'
};

// chrome.storage.session key constants — cleared when the browser session ends
const SESSION_KEYS = {
  CURRENT_JOB: 'CURRENT_JOB', // The most recently scraped job, pending review/save
};

// Default storage values for first install
const DEFAULT_STORAGE = {
  [STORAGE_KEYS.DRIVE_ROOT_FOLDER_ID]: '',
  [STORAGE_KEYS.DRIVE_ROOT_FOLDER_NAME]: '',
  [STORAGE_KEYS.DRIVE_CV_FOLDER_ID]: '',
  [STORAGE_KEYS.DRIVE_TEMPLATES_FOLDER_ID]: '',
  [STORAGE_KEYS.SETUP_COMPLETE]: false
};

/**
 * Get a value from chrome.storage.sync
 * @param {string} key - Storage key from STORAGE_KEYS
 * @returns {Promise<any>} The stored value
 */
async function getStorageValue(key) {
  const result = await chrome.storage.sync.get(key);
  return result[key];
}

/**
 * Set a value in chrome.storage.sync
 * @param {string} key - Storage key from STORAGE_KEYS
 * @param {any} value - Value to store
 * @returns {Promise<void>}
 */
async function setStorageValue(key, value) {
  await chrome.storage.sync.set({ [key]: value });
}

/**
 * Initialize storage with default values if not already set
 * @returns {Promise<void>}
 */
async function initializeStorage() {
  const current = await chrome.storage.sync.get(Object.keys(DEFAULT_STORAGE));
  const updates = {};

  for (const [key, defaultValue] of Object.entries(DEFAULT_STORAGE)) {
    if (current[key] === undefined) {
      updates[key] = defaultValue;
    }
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.sync.set(updates);
  }
}

/**
 * Sanitise a Drive folder name by removing characters that Google Drive does not allow.
 * Illegal characters: \ / : * ? " < > |
 * @param {string} company - Company name from the scraped job
 * @param {string} jobTitle - Job title from the scraped job
 * @returns {string} Sanitised folder name in the format "[Company] - [Job Title]"
 */
function sanitiseFolderName(company, jobTitle) {
  const illegal = /[\\/:*?"<>|]/g;
  const safe = (str) => (str || '').replace(illegal, '').trim();
  return `${safe(company)} - ${safe(jobTitle)}`;
}

/**
 * Generate a human-readable HTML summary of a scraped job.
 * @param {Object} job - The job object in the standard scraper output format
 * @returns {string} A complete HTML document as a string
 */
function generateJobSummaryHtml(job) {
  // Escape HTML special characters to prevent XSS in the generated document
  const esc = (str) => (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const savedDate = job.scrapedAt
    ? new Date(job.scrapedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  const applyLink = job.applicationUrl
    ? `<p><a href="${esc(job.applicationUrl)}" target="_blank">View original posting &rarr;</a></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(job.jobTitle)} at ${esc(job.company)}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.6; }
    h1 { font-size: 1.75rem; margin-bottom: 6px; }
    .meta { color: #555; font-size: 0.95rem; margin-bottom: 8px; }
    .meta span + span::before { content: ' \u00B7  '; }
    .apply-link { margin-bottom: 28px; }
    .apply-link a { color: #0073b1; text-decoration: none; font-weight: 500; }
    .apply-link a:hover { text-decoration: underline; }
    h2 { font-size: 1.1rem; border-bottom: 1px solid #e5e5e5; padding-bottom: 6px; margin-top: 28px; color: #333; }
    .description { white-space: pre-wrap; font-size: 0.95rem; color: #222; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e5e5; font-size: 0.8rem; color: #999; }
  </style>
</head>
<body>
  <h1>${esc(job.jobTitle)}</h1>
  <p class="meta">
    <span>${esc(job.company)}</span>
    ${job.location ? `<span>${esc(job.location)}</span>` : ''}
    ${savedDate ? `<span>Saved ${esc(savedDate)}</span>` : ''}
    <span>Source: ${esc(job.source)}</span>
  </p>
  <div class="apply-link">${applyLink}</div>
  <h2>Job Description</h2>
  <div class="description">${esc(job.description)}</div>
  <div class="footer">Saved by JobLink &mdash; ${esc(savedDate)}</div>
</body>
</html>`;
}
