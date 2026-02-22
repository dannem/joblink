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
 * Opens the side panel.
 */
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (error) {
    console.error('Failed to open side panel:', error);
  }
});

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
      // Persist for side panel re-opens within the same browser session
      chrome.storage.session
        .set({ [SESSION_KEYS.CURRENT_JOB]: jobData })
        .catch(err => console.error('[JobLink] Failed to store job in session:', err));

      // Forward to side panel (best-effort — panel may not be open yet)
      chrome.runtime.sendMessage({ type: 'JOB_DATA_EXTRACTED', payload: jobData })
        .catch(() => { /* Side panel not open — not an error */ });
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

  return false;
});

/**
 * Orchestrate saving a scraped job to Google Drive.
 * Creates a subfolder under the user's configured root, then uploads
 * job_info.json, job_summary.html, and (if provided) job_summary.pdf.
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

  // 3. Sanitise the job fields into a valid Drive folder name
  const folderName = sanitiseFolderName(job.company, job.jobTitle);

  // 4. Create the job subfolder inside the root folder
  const folder = await createDriveFolder(token, folderName, rootFolderId);

  // 5. Upload job_info.json — the raw structured job data
  await uploadFileToDrive(
    token,
    'job_info.json',
    JSON.stringify(job, null, 2),
    'application/json',
    folder.id
  );

  // 6. Upload job_summary.html — the human-readable summary
  const htmlContent = generateJobSummaryHtml(job);
  await uploadFileToDrive(
    token,
    'job_summary.html',
    htmlContent,
    'text/html',
    folder.id
  );

  // 7. Upload job_summary.pdf — skip gracefully if the side panel did not supply bytes.
  //    PDF failure must not block the save; JSON and HTML are already written at this point.
  if (pdfBase64) {
    console.log('[JobLink] Attempting PDF upload, base64 length:', pdfBase64 ? pdfBase64.length : 'missing');
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

  console.log(`[JobLink] Saved to Drive: ${folderName} (folder ID: ${folder.id})`);
  return { success: true };
}
