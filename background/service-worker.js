/**
 * Service worker for JobLink extension.
 * Handles extension install events, OAuth token management, and message routing.
 */

// Import helpers for storage key constants and utility functions
importScripts('../utils/helpers.js');
// Import Drive API functions — all Drive calls must go through this module
importScripts('../drive/drive-api.js');

/**
 * Handle extension installation.
 * Opens the setup page on first install.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await handleFirstInstall();
  } else if (details.reason === 'update') {
    console.log('JobLink updated to version', chrome.runtime.getManifest().version);
  }
});

/**
 * Handle first-time installation of the extension.
 * Initializes storage with defaults and opens the setup page.
 */
async function handleFirstInstall() {
  try {
    // Initialize storage with default values
    await initializeStorage();

    // Open the setup page in a new tab
    const setupUrl = chrome.runtime.getURL('setup/setup.html');
    await chrome.tabs.create({ url: setupUrl });

    console.log('JobLink installed — setup page opened');
  } catch (error) {
    console.error('Failed to handle first install:', error);
  }
}

/**
 * Handle clicks on the extension action (toolbar icon).
 * Opens the side panel immediately (while click gesture is active), then
 * best-effort bootstraps the matching content script for scrape requests.
 */
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) {
    console.error('[JobLink] No active tab id on action click.');
    return;
  }

  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (error) {
    console.error('Failed to open side panel:', error);
    return;
  }

  try {
    await triggerScrapeForTab(tab);
  } catch (injectErr) {
    console.warn('[JobLink] Content script bootstrap failed (continuing):', injectErr.message);
  }
});

/**
 * Decide whether a fully-loaded tab URL warrants an automatic scrape trigger.
 *
 * Rules by host:
 *   LinkedIn  — only individual job view pages (/jobs/view/{numericId}).
 *               List pages (/jobs/search/, /jobs/collections/) and the
 *               homepage are excluded — their content is a feed, not a
 *               single job posting.  The split-panel search view already
 *               handles itself via the content script's navigation watcher.
 *   Indeed    — only pages that carry a specific job key (jk= query param).
 *               Pure search-results pages have no jk= and are excluded.
 *   All other http/https URLs — always eligible; the generic scraper's own
 *               quality threshold (title + 200-char description) acts as the
 *               real filter so non-job pages are silently dropped.
 *
 * @param {string} url
 * @returns {boolean}
 */
function shouldScrapeOnLoad(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    const host = parsed.hostname;

    // LinkedIn: standalone job view pages and split-panel search results
    if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
      return /^\/jobs\/view\/\d+/.test(parsed.pathname) ||
        (parsed.pathname.startsWith('/jobs/') && parsed.searchParams.has('currentJobId'));
    }

    // Indeed: job-detail pages carry a jk= (job key) query param
    if (host === 'indeed.com' || host.endsWith('.indeed.com')) {
      return Boolean(parsed.searchParams.get('jk'));
    }

    // Everything else — generic scraper; quality filtering happens inside the script
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Trigger scraping whenever a tab finishes loading on a URL that identifies
 * a specific job posting.
 *
 * This catches navigation paths that the action-click handler cannot:
 *   - Opening a job link from an email client
 *   - Typing or pasting a URL directly into the address bar
 *   - Following a bookmark or external link to a job page
 *
 * shouldScrapeOnLoad() filters out LinkedIn feed/list pages and Indeed
 * search pages so the scraper is only invoked for individual job postings.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!shouldScrapeOnLoad(tab.url || '')) return;

  triggerScrapeForTab(tab).catch((err) => {
    console.warn('[JobLink] tabs.onUpdated scrape trigger failed:', err.message);
  });
});

/**
 * Return the content script file that matches the current tab URL.
 *
 * @param {string} url
 * @returns {string|null}
 */
function getContentScriptForUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const isLinkedInHost =
      parsed.hostname === 'linkedin.com' || parsed.hostname.endsWith('.linkedin.com');
    if (isLinkedInHost && parsed.pathname.startsWith('/jobs/')) {
      return 'content-scripts/linkedin.js';
    }
    if (parsed.hostname.endsWith('.indeed.com') || parsed.hostname === 'indeed.com') {
      return 'content-scripts/indeed.js';
    }
    // Any other http/https page — use the generic scraper
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return 'content-scripts/generic.js';
    }
  } catch (_) {
    return null;
  }

  return null;
}

/**
 * Compute a simple quality score for a scraped payload.
 * Higher score means more complete and less likely to be a partial scrape.
 *
 * @param {Object|null|undefined} job
 * @returns {number}
 */
function scoreJobPayload(job) {
  if (!job) return 0;
  const title = (job.jobTitle || '').trim();
  const company = (job.company || '').trim();
  const location = (job.location || '').trim();
  const description = (job.description || '').trim();

  let score = 0;
  if (title) score += Math.min(title.length, 120);
  if (company) score += Math.min(company.length, 80);
  if (location) score += Math.min(location.length, 60);
  if (description) score += Math.min(description.length, 1000);
  if (job.applicationUrl) score += 40;
  return score;
}

/**
 * Reject clear regressions so stale/partial late results don't overwrite
 * already-captured job data in session storage.
 *
 * @param {Object|null|undefined} currentJob
 * @param {Object|null|undefined} nextJob
 * @returns {boolean}
 */
function shouldReplaceCurrentJob(currentJob, nextJob) {
  if (!nextJob) return false;
  if (!currentJob) return true;

  const samePosting =
    currentJob.applicationUrl &&
    nextJob.applicationUrl &&
    currentJob.applicationUrl === nextJob.applicationUrl;

  if (!samePosting) return true;

  const currentScore = scoreJobPayload(currentJob);
  const nextScore = scoreJobPayload(nextJob);
  return nextScore >= currentScore;
}

/**
 * Extract LinkedIn job id from either currentJobId query param or /jobs/view/{id}.
 *
 * @param {string} url
 * @returns {string}
 */
function extractLinkedInJobId(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const fromQuery = parsed.searchParams.get('currentJobId');
    if (fromQuery) return fromQuery;
    const m = parsed.pathname.match(/\/jobs\/view\/(\d+)/);
    if (m && m[1]) return m[1];
  } catch (_) {
    return '';
  }
  return '';
}

/**
 * For LinkedIn SPA pages, reject payloads that do not match the tab's current
 * job id. Prevents stale async scrapes from older postings overwriting fields.
 *
 * @param {Object} jobData
 * @param {chrome.tabs.Tab|undefined} senderTab
 * @returns {boolean}
 */
function isFreshLinkedInPayload(jobData, senderTab) {
  if (!jobData || jobData.source !== 'linkedin') return true;
  const tabJobId = extractLinkedInJobId(senderTab?.url || '');
  const payloadJobId =
    (jobData.sourceJobId || '').toString() ||
    extractLinkedInJobId(jobData.applicationUrl || '');

  if (!tabJobId || !payloadJobId) return true;
  return tabJobId === payloadJobId;
}

/**
 * If the active tab is a supported job page and no listener exists yet,
 * inject the matching scraper script so REQUEST_SCRAPE can run immediately.
 *
 * @param {{id?: number, url?: string}} tab
 * @returns {Promise<boolean>} true if a script was injected, else false
 */
async function ensureContentScriptForTab(tab) {
  if (!tab?.id) return false;

  const scriptFile = getContentScriptForUrl(tab.url || '');
  if (!scriptFile) return false;

  // Always inject a fresh scraper on trigger. This avoids stale listener issues
  // after browser restart where an invalidated old script can still receive
  // messages but cannot send data back to the extension runtime.
  console.log('[JobLink] Injecting scraper into active tab:', scriptFile);
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: [scriptFile],
  });
  return true;
}

/**
 * Ensure scraper availability on the given tab and request a scrape.
 * Safe to call repeatedly.
 *
 * @param {{id?: number, url?: string}} tab
 */
async function triggerScrapeForTab(tab) {
  if (!tab?.id) return;
  const ATTEMPTS = 3;
  const RETRY_DELAY_MS = 250;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    await ensureContentScriptForTab(tab);
    const delivered = await requestScrape(tab.id);
    if (delivered) return;
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
  }

  console.warn('[JobLink] REQUEST_SCRAPE failed after retries for tab:', tab.id);
}

/**
 * Ask content script to scrape now. Returns true when message was delivered.
 *
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
async function requestScrape(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'REQUEST_SCRAPE' }, (response) => {
      const msg = chrome.runtime.lastError?.message || '';
      if (msg.includes('Receiving end does not exist') || msg.includes('Extension context invalidated')) {
        resolve(false);
        return;
      }
      resolve(Boolean(response && response.ok));
    });
  });
}

/**
 * Listen for messages from content scripts and extension pages.
 *
 * JOB_DATA_EXTRACTED — sent by content scripts after scraping a job.
 *   LinkedIn sends the job object as `message.payload`.
 *   Indeed sends it as `message.data`.
 *   Both are normalised here to `payload` before storage and forwarding.
 *
 * SAVE_TO_DRIVE — sent by the side panel when the user clicks Save.
 *   Gets an OAuth token, creates a subfolder in the user's Drive root, and
 *   uploads job_info.json and job_summary.html. Responds async via sendResponse.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'JOB_DATA_EXTRACTED') {
    // Normalise: LinkedIn uses `payload`, Indeed uses `data`
    const jobData = message.payload || message.data;

    console.log('[JobLink] Job data received from content script:', jobData);
    console.log('[JobLink] Source tab:', sender.tab ? sender.tab.url : 'unknown');

    if (jobData) {
      if (!isFreshLinkedInPayload(jobData, sender.tab)) {
        console.log('[JobLink] Ignoring stale LinkedIn payload:', {
          tabUrl: sender.tab?.url,
          sourceJobId: jobData.sourceJobId,
          applicationUrl: jobData.applicationUrl,
        });
        sendResponse({ status: 'ignored_stale' });
        return false;
      }

      chrome.storage.session.get(SESSION_KEYS.CURRENT_JOB)
        .then((result) => {
          const currentJob = result[SESSION_KEYS.CURRENT_JOB] || null;
          if (!shouldReplaceCurrentJob(currentJob, jobData)) {
            console.log('[JobLink] Ignoring lower-quality duplicate payload for same posting.');
            return;
          }

          // Persist for side panel re-opens within the same browser session
          return chrome.storage.session
            .set({ [SESSION_KEYS.CURRENT_JOB]: jobData })
            .then(() => {
              // Forward to side panel (best-effort — panel may not be open yet)
              return chrome.runtime.sendMessage({ type: 'JOB_DATA_EXTRACTED', payload: jobData })
                .catch(() => { /* Side panel not open — not an error */ });
            });
        })
        .catch(err => console.error('[JobLink] Failed to process incoming job payload:', err));
    }

    sendResponse({ status: 'received' });
    return false;
  }

  if (message.type === 'SAVE_TO_DRIVE') {
    const pdfBase64 = message.pdfBase64 || '';
    console.log('[JobLink] SAVE_TO_DRIVE received:', message.payload, pdfBase64 ? '(PDF included)' : '(no PDF)');
    handleSaveToDrive(message.payload, pdfBase64)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep the message channel open while the async work completes
  }

  if (message.type === 'TRIGGER_SCRAPE_FOR_TAB') {
    (async () => {
      try {
        if (!message.tabId) {
          sendResponse({ ok: false, error: 'Missing tabId' });
          return;
        }
        const tab = await chrome.tabs.get(message.tabId);
        await triggerScrapeForTab(tab);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // SIDEPANEL_OPENED — sent by the side panel on DOMContentLoaded.
  // Ensures the matching content script is injected into the active tab and
  // immediately requests a scrape. Handles cold-start tabs where a direct
  // chrome.tabs.sendMessage from the panel finds no listener yet.
  if (message.type === 'SIDEPANEL_OPENED') {
    (async () => {
      try {
        if (!message.tabId) {
          sendResponse({ ok: false, error: 'Missing tabId' });
          return;
        }
        const tab = await chrome.tabs.get(message.tabId);
        await triggerScrapeForTab(tab);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  return false;
});

/**
 * Ensure the Preparation, Submitted, and Rejected subfolders exist under
 * the user's root folder.  On first save, creates any missing folders and
 * caches all three IDs in chrome.storage.sync.  On subsequent saves,
 * returns the cached IDs immediately without making any Drive API calls.
 *
 * @param {string} token        - OAuth access token
 * @param {string} rootFolderId - The user's configured root jobs folder
 * @returns {Promise<{preparationId: string, submittedId: string, rejectedId: string}>}
 */
async function ensureStatusFolders(token, rootFolderId) {
  const [preparationId, submittedId, rejectedId] = await Promise.all([
    getStorageValue(STORAGE_KEYS.PREPARATION_FOLDER_ID),
    getStorageValue(STORAGE_KEYS.SUBMITTED_FOLDER_ID),
    getStorageValue(STORAGE_KEYS.REJECTED_FOLDER_ID),
  ]);

  if (preparationId && submittedId && rejectedId) {
    return { preparationId, submittedId, rejectedId };
  }

  // One or more IDs are missing — get or create all three in parallel
  const [prep, sub, rej] = await Promise.all([
    getOrCreateNamedFolder(token, 'Preparation', rootFolderId),
    getOrCreateNamedFolder(token, 'Submitted', rootFolderId),
    getOrCreateNamedFolder(token, 'Rejected', rootFolderId),
  ]);

  // Cache all three IDs so future saves skip this step entirely
  await chrome.storage.sync.set({
    [STORAGE_KEYS.PREPARATION_FOLDER_ID]: prep.id,
    [STORAGE_KEYS.SUBMITTED_FOLDER_ID]:   sub.id,
    [STORAGE_KEYS.REJECTED_FOLDER_ID]:    rej.id,
  });

  console.log('[JobLink] Status folders ready:', prep.name, sub.name, rej.name);
  return { preparationId: prep.id, submittedId: sub.id, rejectedId: rej.id };
}

/**
 * Orchestrate saving a scraped job to Google Drive.
 * Ensures the Preparation/Submitted/Rejected subfolder structure exists under
 * the root folder, then creates a job folder inside Preparation and uploads
 * all three files (JSON, HTML, PDF).
 * @param {Object} job       - The job object in the standard scraper output format
 * @param {string} pdfBase64 - Base64-encoded PDF bytes, or '' to skip PDF upload
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function handleSaveToDrive(job, pdfBase64) {
  // 1. Get a fresh OAuth token (non-interactive — user must already be signed in)
  const token = await new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: false }, (accessToken) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(accessToken);
      }
    });
  });

  // 2. Get the user's configured root Drive folder from storage
  const rootFolderId = await getStorageValue(STORAGE_KEYS.DRIVE_ROOT_FOLDER_ID);
  if (!rootFolderId) {
    throw new Error('No Drive folder configured. Please complete setup first.');
  }

  // 3. Ensure Preparation / Submitted / Rejected subfolders exist under root.
  //    Creates them on first save and caches IDs — subsequent saves are instant.
  const { preparationId } = await ensureStatusFolders(token, rootFolderId);

  // 4. Sanitise the job fields into a valid Drive folder name
  const folderName = sanitiseFolderName(job.company, job.jobTitle);

  // 5. Create the job subfolder inside Preparation
  const folder = await createDriveFolder(token, folderName, preparationId);

  // 6. Upload job_info.json — the raw structured job data
  await uploadFileToDrive(
    token,
    'job_info.json',
    JSON.stringify(job, null, 2),
    'application/json',
    folder.id
  );

  // 7. Upload job_summary.html — the human-readable summary
  const htmlContent = generateJobSummaryHtml(job);
  await uploadFileToDrive(
    token,
    'job_summary.html',
    htmlContent,
    'text/html',
    folder.id
  );

  // 8. Upload job_summary.pdf — skip gracefully if the side panel did not supply bytes.
  //    PDF failure must not block the save; JSON and HTML are already written at this point.
  if (pdfBase64) {
    try {
      await uploadBase64FileToDrive(
        token,
        'job_summary.pdf',
        pdfBase64,
        'application/pdf',
        folder.id
      );
    } catch (pdfErr) {
      console.warn('[JobLink] PDF upload failed:', pdfErr.message, pdfErr.stack);
    }
  } else {
    console.log('[JobLink] No PDF data provided — skipping PDF upload.');
  }

  // 9. Save a Google Doc version of the job listing — skip gracefully on failure.
  try {
    await saveJobAsGoogleDoc(job, folder.id, token);
  } catch (docErr) {
    console.warn('[JobLink] Google Doc save failed:', docErr.message);
  }

  console.log(`[JobLink] Saved to Drive: Preparation/${folderName} (folder ID: ${folder.id})`);
  return { success: true };
}
