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
