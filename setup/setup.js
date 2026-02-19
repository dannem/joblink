/**
 * Setup page logic for JobLink extension.
 * Handles OAuth flow, folder selection, and initial configuration.
 */

// State
let accessToken = null;
let selectedFolderId = null;
let selectedFolderName = null;

document.addEventListener('DOMContentLoaded', initSetupPage);

/**
 * Initialize the setup page by checking if setup is already complete.
 */
async function initSetupPage() {
  try {
    const isComplete = await getStorageValue(STORAGE_KEYS.SETUP_COMPLETE);

    if (isComplete) {
      showSetupComplete();
    } else {
      showSetupForm();
    }
  } catch (error) {
    console.error('Failed to check setup status:', error);
    showSetupForm();
  }
}

/**
 * Show the setup form for first-time configuration.
 */
function showSetupForm() {
  document.getElementById('setup-form').style.display = 'block';
  document.getElementById('setup-complete').style.display = 'none';
  document.getElementById('setup-success').style.display = 'none';

  // Set up event listeners
  document.getElementById('connect-drive-btn').addEventListener('click', handleConnectDrive);
  document.getElementById('select-folder-btn').addEventListener('click', handleSelectFolder);
  document.getElementById('save-setup-btn').addEventListener('click', handleSaveSetup);
  document.getElementById('error-dismiss').addEventListener('click', hideError);
  document.getElementById('folder-picker-close').addEventListener('click', hideFolderPicker);
  document.getElementById('use-root-btn').addEventListener('click', handleUseRootFolder);
}

/**
 * Show the "setup already complete" message.
 */
function showSetupComplete() {
  document.getElementById('setup-form').style.display = 'none';
  document.getElementById('setup-complete').style.display = 'block';
  document.getElementById('setup-success').style.display = 'none';
}

/**
 * Show the setup success message after completing setup.
 */
function showSetupSuccess() {
  document.getElementById('setup-form').style.display = 'none';
  document.getElementById('setup-complete').style.display = 'none';
  document.getElementById('setup-success').style.display = 'block';

  document.getElementById('close-tab-btn').addEventListener('click', () => {
    window.close();
  });
}

/**
 * Display an error message to the user.
 * @param {string} message - Error message to display
 */
function showError(message) {
  const errorEl = document.getElementById('error-message');
  const errorText = document.getElementById('error-text');
  errorText.textContent = message;
  errorEl.style.display = 'flex';
}

/**
 * Hide the error message.
 */
function hideError() {
  document.getElementById('error-message').style.display = 'none';
}

/**
 * Set button loading state.
 * @param {HTMLElement} button - Button element
 * @param {boolean} loading - Whether to show loading state
 */
function setButtonLoading(button, loading) {
  if (loading) {
    button.classList.add('loading');
    button.disabled = true;
  } else {
    button.classList.remove('loading');
    button.disabled = false;
  }
}

/**
 * Update the Complete Setup button state based on requirements.
 */
function updateCompleteButtonState() {
  const saveBtn = document.getElementById('save-setup-btn');
  const canComplete = accessToken && selectedFolderId;
  saveBtn.disabled = !canComplete;
}

/**
 * Handle the "Connect Google Drive" button click.
 * Initiates OAuth flow using chrome.identity.getAuthToken().
 */
async function handleConnectDrive() {
  const connectBtn = document.getElementById('connect-drive-btn');
  setButtonLoading(connectBtn, true);
  hideError();

  try {
    // Request OAuth token
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(token);
        }
      });
    });

    accessToken = token;

    // Get user info to display email
    const userInfo = await getUserInfo(token);

    // Update UI to show connected state
    document.getElementById('drive-not-connected').style.display = 'none';
    document.getElementById('drive-connected').style.display = 'flex';
    document.getElementById('connected-email').textContent = userInfo.email;

    // Enable folder selection
    document.getElementById('select-folder-btn').disabled = false;

    updateCompleteButtonState();
  } catch (error) {
    console.error('OAuth failed:', error);
    showError(`Failed to connect to Google Drive: ${error.message}`);
    setButtonLoading(connectBtn, false);
  }
}

/**
 * Handle the "Select Folder" button click.
 * Opens the folder picker with list of Drive folders.
 */
async function handleSelectFolder() {
  const selectBtn = document.getElementById('select-folder-btn');
  const folderPicker = document.getElementById('folder-picker');
  const folderList = document.getElementById('folder-list');

  hideError();

  // Show folder picker
  folderPicker.style.display = 'block';
  folderList.innerHTML = '<div class="folder-list-loading">Loading folders...</div>';

  try {
    // Fetch folders from Drive
    const folders = await listDriveFolders(accessToken);

    if (folders.length === 0) {
      folderList.innerHTML = '<div class="folder-list-empty">No folders found. You can use the root folder or create folders in Drive first.</div>';
    } else {
      folderList.innerHTML = folders.map(folder => `
        <div class="folder-item" data-folder-id="${folder.id}" data-folder-name="${escapeHtml(folder.name)}">
          <span class="folder-item-icon">&#128193;</span>
          <span class="folder-item-name">${escapeHtml(folder.name)}</span>
        </div>
      `).join('');

      // Add click handlers
      folderList.querySelectorAll('.folder-item').forEach(item => {
        item.addEventListener('click', () => {
          selectFolder(item.dataset.folderId, item.dataset.folderName);
        });
      });
    }
  } catch (error) {
    console.error('Failed to list folders:', error);
    folderList.innerHTML = '<div class="folder-list-empty">Failed to load folders. Please try again.</div>';
    showError(`Failed to load folders: ${error.message}`);
  }
}

/**
 * Handle selecting "My Drive" root folder.
 */
function handleUseRootFolder() {
  selectFolder('root', 'My Drive');
}

/**
 * Select a folder and update the UI.
 * @param {string} folderId - Selected folder ID
 * @param {string} folderName - Selected folder name
 */
function selectFolder(folderId, folderName) {
  selectedFolderId = folderId;
  selectedFolderName = folderName;

  // Update UI
  const folderSelector = document.querySelector('.setup-section:nth-of-type(3) .folder-selector');
  const selectedFolderEl = document.getElementById('selected-folder');

  folderSelector.classList.add('selected');
  selectedFolderEl.textContent = folderName;
  selectedFolderEl.classList.add('selected');

  // Hide picker
  hideFolderPicker();

  updateCompleteButtonState();
}

/**
 * Hide the folder picker.
 */
function hideFolderPicker() {
  document.getElementById('folder-picker').style.display = 'none';
}

/**
 * Handle the "Complete Setup" button click.
 * Saves settings and marks setup as complete.
 */
async function handleSaveSetup() {
  const saveBtn = document.getElementById('save-setup-btn');
  setButtonLoading(saveBtn, true);
  hideError();

  try {
    // Save folder selection
    await setStorageValue(STORAGE_KEYS.DRIVE_ROOT_FOLDER_ID, selectedFolderId);
    await setStorageValue(STORAGE_KEYS.DRIVE_ROOT_FOLDER_NAME, selectedFolderName);

    // Mark setup as complete
    await setStorageValue(STORAGE_KEYS.SETUP_COMPLETE, true);

    // Show success message
    showSetupSuccess();
  } catch (error) {
    console.error('Failed to save setup:', error);
    showError(`Failed to save settings: ${error.message}`);
    setButtonLoading(saveBtn, false);
  }
}

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
