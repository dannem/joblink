/**
 * Shared utilities for JobLink extension.
 * All chrome.storage.sync keys must be defined here as constants.
 */

// Storage key constants — use these everywhere, never raw strings
const STORAGE_KEYS = {
  DRIVE_ROOT_FOLDER_ID: 'DRIVE_ROOT_FOLDER_ID',
  DRIVE_CV_FOLDER_ID: 'DRIVE_CV_FOLDER_ID',
  DRIVE_TEMPLATES_FOLDER_ID: 'DRIVE_TEMPLATES_FOLDER_ID',
  SETUP_COMPLETE: 'SETUP_COMPLETE'
};

// Default storage values for first install
const DEFAULT_STORAGE = {
  [STORAGE_KEYS.DRIVE_ROOT_FOLDER_ID]: '',
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
