/**
 * Shared utilities for JobLink extension.
 * All chrome.storage.sync keys must be defined here as constants.
 */

// chrome.storage.sync key constants — use these everywhere, never raw strings
const STORAGE_KEYS = {
  DRIVE_ROOT_FOLDER_ID: 'DRIVE_ROOT_FOLDER_ID',
  DRIVE_ROOT_FOLDER_NAME: 'DRIVE_ROOT_FOLDER_NAME',
  PREPARATION_FOLDER_ID: 'PREPARATION_FOLDER_ID',
  SUBMITTED_FOLDER_ID: 'SUBMITTED_FOLDER_ID',
  REJECTED_FOLDER_ID: 'REJECTED_FOLDER_ID',
  DRIVE_CV_FOLDER_ID: 'DRIVE_CV_FOLDER_ID',
  DRIVE_TEMPLATES_FOLDER_ID: 'DRIVE_TEMPLATES_FOLDER_ID',
  CV_TEMPLATES_FOLDER_ID: 'cvTemplatesFolderId',
  CV_TEMPLATES_FOLDER_NAME: 'cvTemplatesFolderName',
  CL_TEMPLATES_FOLDER_ID: 'clTemplatesFolderId',
  CL_TEMPLATES_FOLDER_NAME: 'clTemplatesFolderName',
  PROFILE_FOLDER_ID: 'profileFolderId',
  PROFILE_FOLDER_NAME: 'profileFolderName',
  SETUP_COMPLETE: 'SETUP_COMPLETE',
  CONNECTED_EMAIL: 'CONNECTED_EMAIL',
  // AI provider API keys — stored locally, never transmitted except to the chosen provider
  ANTHROPIC_API_KEY: 'ANTHROPIC_API_KEY',
  OPENAI_API_KEY: 'OPENAI_API_KEY',
  GEMINI_API_KEY: 'GEMINI_API_KEY',
  // User preference for the default Prepare Package AI model
  DEFAULT_AI_MODEL: 'defaultAiModel',
  // User preference for which documents to generate in Prepare Package
  DEFAULT_PACKAGE: 'defaultPackage',
  LICENCE_KEY: 'LICENCE_KEY',
  LICENCE_VALID: 'LICENCE_VALID',
};

// chrome.storage.session key constants — cleared when the browser session ends
const SESSION_KEYS = {
  CURRENT_JOB: 'CURRENT_JOB', // The most recently scraped job, pending review/save
};

// Default storage values for first install
const DEFAULT_STORAGE = {
  [STORAGE_KEYS.DRIVE_ROOT_FOLDER_ID]: '',
  [STORAGE_KEYS.DRIVE_ROOT_FOLDER_NAME]: '',
  [STORAGE_KEYS.PREPARATION_FOLDER_ID]: '',
  [STORAGE_KEYS.SUBMITTED_FOLDER_ID]: '',
  [STORAGE_KEYS.REJECTED_FOLDER_ID]: '',
  [STORAGE_KEYS.DRIVE_CV_FOLDER_ID]: '',
  [STORAGE_KEYS.DRIVE_TEMPLATES_FOLDER_ID]: '',
  [STORAGE_KEYS.CV_TEMPLATES_FOLDER_ID]: '',
  [STORAGE_KEYS.CV_TEMPLATES_FOLDER_NAME]: '',
  [STORAGE_KEYS.CL_TEMPLATES_FOLDER_ID]: '',
  [STORAGE_KEYS.CL_TEMPLATES_FOLDER_NAME]: '',
  [STORAGE_KEYS.PROFILE_FOLDER_ID]: '',
  [STORAGE_KEYS.PROFILE_FOLDER_NAME]: '',
  [STORAGE_KEYS.SETUP_COMPLETE]: false,
  [STORAGE_KEYS.CONNECTED_EMAIL]: '',
  [STORAGE_KEYS.ANTHROPIC_API_KEY]: '',
  [STORAGE_KEYS.OPENAI_API_KEY]: '',
  [STORAGE_KEYS.GEMINI_API_KEY]: '',
  [STORAGE_KEYS.DEFAULT_AI_MODEL]: 'sonnet',
  [STORAGE_KEYS.DEFAULT_PACKAGE]: 'both',
  [STORAGE_KEYS.LICENCE_KEY]: '',
  [STORAGE_KEYS.LICENCE_VALID]: false,
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
function sanitiseFolderName(company, jobTitle, job) {
  const illegal = /[\\/:*?"<>|]/g;
  const safe = (str) => (str || '').replace(illegal, '').trim();
  const base = `${safe(company)} - ${safe(jobTitle)}`;
  if (!job) return base;
  return `${base} [${jobHashId(job)}]`;
}

function jobHashId(job) {
  const source = (job.applicationUrl || `${job.company || ''}|${job.jobTitle || ''}`).trim();
  let hash = 5381;
  for (let i = 0; i < source.length; i++) {
    hash = ((hash << 5) + hash) ^ source.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 6);
}

/**
 * Build the base filename for all job posting files (without extension).
 * Format: "Post - Job Title (Company)"
 * Used for the Google Doc name, JSON, HTML, and PDF so all four match.
 *
 * @param {Object} job - { jobTitle?, company? }
 * @returns {string} e.g. "Post - Senior Engineer (Acme Corp)"
 */
function jobPostingFileName(job) {
  const illegal = /[\\/:*?"<>|]/g;
  const safe = (str) => (str || '').replace(illegal, '').trim();
  const title   = safe(job.jobTitle) || 'Job';
  const company = safe(job.company)  || 'Company';
  return `Post - ${title} (${company})`;
}

/**
 * Generate a PDF of a scraped job and return it as a base64 string.
 *
 * Must be called from a page/panel context where jsPDF is loaded via CDN.
 * Never call this from a service worker — window.jspdf is not available there.
 *
 * @param {Object} job - The job object in the standard scraper output format
 * @returns {string} Base64-encoded PDF bytes (no data-URI prefix)
 * @throws {Error} If jsPDF is not available or PDF generation fails
 */
function generateJobPdfBase64(job) {
  if (typeof window === 'undefined' || !window.jspdf) {
    throw new Error('jsPDF is not available in this context.');
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

  const PAGE_W  = doc.internal.pageSize.getWidth();
  const PAGE_H  = doc.internal.pageSize.getHeight();
  const MARGIN  = 56;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  let y = MARGIN;

  // Adds one or more wrapped lines of text, adding new pages as needed.
  function addText(text, size, bold, rgb) {
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setTextColor(rgb ? rgb[0] : 0, rgb ? rgb[1] : 0, rgb ? rgb[2] : 0);
    const lineH = size * 1.4;
    const lines = doc.splitTextToSize(text || '', CONTENT_W);
    lines.forEach(line => {
      if (y + lineH > PAGE_H - MARGIN) {
        doc.addPage();
        y = MARGIN;
      }
      doc.text(line, MARGIN, y);
      y += lineH;
    });
  }

  function addSpacer(pts) { y += pts; }

  function addRule() {
    doc.setDrawColor(220, 220, 220);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    addSpacer(16);
  }

  // ── Header ────────────────────────────────────────────────────
  addText(job.jobTitle || 'Untitled Position', 20, true);
  addSpacer(6);

  const metaLine = [job.company, job.location].filter(Boolean).join('  \u00b7  ');
  if (metaLine) {
    addText(metaLine, 11, false);
    addSpacer(4);
  }

  const savedDate = job.scrapedAt
    ? new Date(job.scrapedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  const subLine = [savedDate ? 'Saved ' + savedDate : '', job.source || ''].filter(Boolean).join('  \u00b7  ');
  if (subLine) {
    addText(subLine, 9, false, [120, 120, 120]);
    addSpacer(4);
  }

  if (job.applicationUrl) {
    addText(job.applicationUrl, 9, false, [0, 115, 177]);
    addSpacer(4);
  }

  addSpacer(10);
  addRule();

  // ── Body ──────────────────────────────────────────────────────
  addText('Job Description', 12, true);
  addSpacer(8);
  addText(job.description || '', 10, false);

  // ── Footer ────────────────────────────────────────────────────
  addSpacer(24);
  addText('Saved by JobLink \u2014 ' + savedDate, 8, false, [160, 160, 160]);

  // Return only the base64 data — strip the "data:application/pdf;base64," prefix
  return doc.output('datauristring').split(',')[1];
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
    .meta span + span::before { content: ' ·  '; }
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

/**
 * Returns true if the user qualifies as a Pro user.
 * V1: true if at least one AI provider API key is saved, OR a valid licence key is stored.
 * V2 will replace licence key validation with a live server check.
 * @returns {Promise<boolean>}
 */
async function isProUser() {
  const [anthropic, openai, gemini, licenceValid] = await Promise.all([
    getStorageValue(STORAGE_KEYS.ANTHROPIC_API_KEY),
    getStorageValue(STORAGE_KEYS.OPENAI_API_KEY),
    getStorageValue(STORAGE_KEYS.GEMINI_API_KEY),
    getStorageValue(STORAGE_KEYS.LICENCE_VALID),
  ]);
  return !!(anthropic || openai || gemini || licenceValid);
}

/**
 * Get a Google OAuth access token. Works in both Chrome and Edge.
 *
 * Strategy:
 *   1. If a cached token exists in session storage, return it immediately.
 *   2. Otherwise, detect the browser:
 *      - Chrome: use chrome.identity.getAuthToken() (silent cached flow)
 *      - Edge / other: use chrome.identity.launchWebAuthFlow()
 *   3. Store the resulting token in chrome.storage.session for reuse.
 *
 * @param {boolean} interactive - If true, show the consent screen if needed.
 * @returns {Promise<string>} OAuth access token
 * @throws {Error} If authentication fails or user cancels
 */
async function getOAuthToken(interactive = true) {
  // 1. Return cached token if available
  try {
    const cached = await chrome.storage.session.get('OAUTH_ACCESS_TOKEN');
    if (cached && cached.OAUTH_ACCESS_TOKEN) {
      return cached.OAUTH_ACCESS_TOKEN;
    }
  } catch (_) {}

  // 2. Detect browser
  const isChrome = navigator.userAgent.includes('Chrome') &&
                   !navigator.userAgent.includes('Edg');

  let token;

  if (isChrome) {
    // Chrome: use built-in cached OAuth flow
    token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
  } else {
    // Edge / other: use launchWebAuthFlow
    const clientId = '406710056933-s0p707igu50ij1h6ia8ev542odvad00s.apps.googleusercontent.com';
    const scopes = [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/userinfo.email'
    ].join(' ');

    const redirectUrl = chrome.identity.getRedirectURL();
    console.log('[JobLink] OAuth redirect URL:', redirectUrl);
    const authUrl =
      'https://accounts.google.com/o/oauth2/auth' +
      '?client_id=' + encodeURIComponent(clientId) +
      '&response_type=token' +
      '&redirect_uri=' + encodeURIComponent(redirectUrl) +
      '&scope=' + encodeURIComponent(scopes);

    const responseUrl = await new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        { url: authUrl, interactive },
        (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(result);
          }
        }
      );
    });

    // Extract access_token from the redirect URL hash
    const hash = new URL(responseUrl).hash.substring(1);
    const params = new URLSearchParams(hash);
    token = params.get('access_token');
    if (!token) {
      throw new Error('No access token returned from OAuth flow');
    }
  }

  // 3. Cache token in session storage
  try {
    await chrome.storage.session.set({ OAUTH_ACCESS_TOKEN: token });
  } catch (_) {}

  return token;
}

/**
 * Clear the cached OAuth token (call this on sign-out or auth errors).
 * @returns {Promise<void>}
 */
async function clearCachedOAuthToken() {
  try {
    await chrome.storage.session.remove('OAUTH_ACCESS_TOKEN');
  } catch (_) {}

  // Also clear from Chrome's internal cache if available
  try {
    await new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (token) {
          chrome.identity.removeCachedAuthToken({ token }, resolve);
        } else {
          resolve();
        }
      });
    });
  } catch (_) {}
}

/**
 * Get the Google OAuth client ID from the extension's manifest.
 * @returns {string} The OAuth client ID
 */
function getGoogleClientId() {
  const manifest = chrome.runtime.getManifest();
  const clientId = manifest.oauth2 && manifest.oauth2.client_id;
  if (!clientId) {
    throw new Error('No OAuth client ID found in manifest.json');
  }
  return clientId;
}
