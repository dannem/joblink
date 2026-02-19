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
 * Listen for messages from content scripts and other extension pages.
 *
 * JOB_DATA_EXTRACTED — sent by linkedin.js (and eventually indeed.js) after
 * scraping a job posting. Logs the data for testing; will be forwarded to the
 * side panel in a future session.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'JOB_DATA_EXTRACTED') {
    console.log('[JobLink] Job data received from content script:', message.payload);
    console.log('[JobLink] Source tab:', sender.tab ? sender.tab.url : 'unknown');

    // Acknowledge receipt so the content script callback does not error
    sendResponse({ status: 'received' });
  }

  // Return false — we are not sending an async response
  return false;
});
