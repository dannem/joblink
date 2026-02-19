/**
 * Service worker for JobLink extension.
 * Handles extension install events, OAuth token management, and message routing.
 */

// Import helpers for storage key constants
importScripts('../utils/helpers.js');

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
 *   TODO: implement Drive file creation (Session 7).
 *   Stubbed with success:true so the side panel UI flow can be tested now.
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
    // TODO (Session 7): create Drive folder and upload job_info.json + job_summary.html
    // Stubbed so the side panel success state can be tested end-to-end.
    console.log('[JobLink] SAVE_TO_DRIVE received (stub — not yet saved):', message.payload);
    sendResponse({ success: true });
    return false;
  }

  return false;
});
