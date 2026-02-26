/**
 * Setup page logic for JobLink extension.
 * Handles OAuth flow, folder selection, and initial configuration.
 */

// State
let accessToken = null;
let selectedFolderId = null;
let selectedFolderName = null;

// Folder navigation state
// Each item: { id: string, name: string }
let folderPath = [];
let currentFolderId = 'root';
let currentFolderName = 'My Drive';

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
  document.getElementById('select-folder-btn').addEventListener('click', handleOpenFolderPicker);
  document.getElementById('save-setup-btn').addEventListener('click', handleSaveSetup);
  document.getElementById('error-dismiss').addEventListener('click', hideError);
  document.getElementById('folder-picker-close').addEventListener('click', hideFolderPicker);
  document.getElementById('folder-nav-up').addEventListener('click', handleNavigateUp);
  document.getElementById('select-current-btn').addEventListener('click', handleSelectCurrentFolder);

  // Pre-fill any previously stored API keys (inputs are type=password so values are masked)
  (async () => {
    try {
      const [anthropic, openai, gemini] = await Promise.all([
        getStorageValue(STORAGE_KEYS.ANTHROPIC_API_KEY),
        getStorageValue(STORAGE_KEYS.OPENAI_API_KEY),
        getStorageValue(STORAGE_KEYS.GEMINI_API_KEY),
      ]);
      if (anthropic) document.getElementById('anthropic-key').value = anthropic;
      if (openai)    document.getElementById('openai-key').value    = openai;
      if (gemini)    document.getElementById('gemini-key').value    = gemini;
    } catch (_) { /* non-fatal */ }
  })();
}

/**
 * Show the "setup already complete" message.
 * Wires up the "Change save folder" button so the user can re-open the
 * setup form to pick a different Drive folder without reinstalling.
 */
function showSetupComplete() {
  document.getElementById('setup-form').style.display = 'none';
  document.getElementById('setup-complete').style.display = 'block';
  document.getElementById('setup-success').style.display = 'none';

  document.getElementById('change-folder-btn').addEventListener('click', () => {
    showSetupForm();
  });
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
    // Clear any cached token first to ensure we get fresh scopes
    await new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (oldToken) => {
        if (oldToken) {
          chrome.identity.removeCachedAuthToken({ token: oldToken }, resolve);
        } else {
          resolve();
        }
      });
    });

    // Request OAuth token with updated scopes
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
 * Handle opening the folder picker.
 * Resets navigation to root and loads top-level folders.
 */
async function handleOpenFolderPicker() {
  hideError();

  // Reset navigation state
  folderPath = [];
  currentFolderId = 'root';
  currentFolderName = 'My Drive';

  // Show folder picker
  document.getElementById('folder-picker').style.display = 'block';

  // Update UI and load folders
  updateBreadcrumbs();
  updateNavButtons();
  await loadFolders(currentFolderId);
}

/**
 * Load and display folders for a given parent folder.
 * @param {string} parentId - Parent folder ID
 */
async function loadFolders(parentId) {
  const folderList = document.getElementById('folder-list');
  folderList.innerHTML = '<div class="folder-list-loading">Loading folders...</div>';

  try {
    const folders = await listDriveFolders(accessToken, parentId);

    if (folders.length === 0) {
      folderList.innerHTML = '<div class="folder-list-empty">No subfolders found. Click "Select this folder" to use the current folder.</div>';
    } else {
      folderList.innerHTML = folders.map(folder => `
        <div class="folder-item" data-folder-id="${escapeAttr(folder.id)}" data-folder-name="${escapeAttr(folder.name)}">
          <span class="folder-item-icon">&#128193;</span>
          <span class="folder-item-name">${escapeHtml(folder.name)}</span>
          <button class="btn btn-secondary btn-tiny folder-select-btn" data-folder-id="${escapeAttr(folder.id)}" data-folder-name="${escapeAttr(folder.name)}">
            Select
          </button>
        </div>
      `).join('');

      // Add click handlers for folder names (navigate into)
      folderList.querySelectorAll('.folder-item').forEach(item => {
        // Click on the row (excluding the select button) navigates into folder
        item.addEventListener('click', (e) => {
          if (!e.target.classList.contains('folder-select-btn')) {
            navigateIntoFolder(item.dataset.folderId, item.dataset.folderName);
          }
        });
      });

      // Add click handlers for select buttons
      folderList.querySelectorAll('.folder-select-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectFolderAndClose(btn.dataset.folderId, btn.dataset.folderName);
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
 * Navigate into a folder (load its subfolders).
 * @param {string} folderId - Folder ID to navigate into
 * @param {string} folderName - Folder name
 */
async function navigateIntoFolder(folderId, folderName) {
  // Add current folder to path before navigating
  folderPath.push({ id: currentFolderId, name: currentFolderName });

  // Update current folder
  currentFolderId = folderId;
  currentFolderName = folderName;

  // Update UI
  updateBreadcrumbs();
  updateNavButtons();
  await loadFolders(folderId);
}

/**
 * Handle navigating up to parent folder.
 */
async function handleNavigateUp() {
  if (folderPath.length === 0) return;

  // Pop the last folder from path
  const parent = folderPath.pop();
  currentFolderId = parent.id;
  currentFolderName = parent.name;

  // Update UI
  updateBreadcrumbs();
  updateNavButtons();
  await loadFolders(currentFolderId);
}

/**
 * Handle clicking a breadcrumb to navigate to that folder.
 * @param {number} index - Index in the folder path (-1 for root)
 */
async function handleBreadcrumbClick(index) {
  if (index === -1) {
    // Navigate to root
    folderPath = [];
    currentFolderId = 'root';
    currentFolderName = 'My Drive';
  } else {
    // Navigate to specific folder in path
    const targetFolder = folderPath[index];
    currentFolderId = targetFolder.id;
    currentFolderName = targetFolder.name;
    // Truncate path to this point
    folderPath = folderPath.slice(0, index);
  }

  updateBreadcrumbs();
  updateNavButtons();
  await loadFolders(currentFolderId);
}

/**
 * Handle selecting the current folder being browsed.
 */
function handleSelectCurrentFolder() {
  selectFolderAndClose(currentFolderId, currentFolderName);
}

/**
 * Select a folder and close the picker.
 * @param {string} folderId - Selected folder ID
 * @param {string} folderName - Selected folder name
 */
function selectFolderAndClose(folderId, folderName) {
  // Build full path name for display
  let fullPathName = folderName;
  if (folderPath.length > 0 || folderId !== 'root') {
    const pathNames = folderPath.map(f => f.name);
    if (folderId !== currentFolderId) {
      // Selecting a subfolder, not the current browsed folder
      pathNames.push(currentFolderName);
    }
    if (folderId === 'root') {
      fullPathName = 'My Drive';
    } else {
      pathNames.push(folderName);
      // Remove 'My Drive' from path display if present
      if (pathNames[0] === 'My Drive') {
        pathNames.shift();
      }
      fullPathName = pathNames.length > 0 ? pathNames.join(' > ') : folderName;
    }
  }

  selectedFolderId = folderId;
  selectedFolderName = fullPathName;

  // Update UI
  const folderSelector = document.querySelector('.setup-section:nth-of-type(3) .folder-selector');
  const selectedFolderEl = document.getElementById('selected-folder');

  folderSelector.classList.add('selected');
  selectedFolderEl.textContent = fullPathName;
  selectedFolderEl.classList.add('selected');

  // Hide picker
  hideFolderPicker();

  updateCompleteButtonState();
}

/**
 * Update the breadcrumb trail display.
 */
function updateBreadcrumbs() {
  const breadcrumbs = document.getElementById('folder-breadcrumbs');
  let html = '';

  // Root (My Drive)
  const isAtRoot = folderPath.length === 0 && currentFolderId === 'root';
  html += `<span class="breadcrumb-item ${isAtRoot ? 'active' : 'clickable'}" data-index="-1">My Drive</span>`;

  // Path folders
  folderPath.forEach((folder, index) => {
    html += `<span class="breadcrumb-separator">&#8250;</span>`;
    html += `<span class="breadcrumb-item clickable" data-index="${index}">${escapeHtml(folder.name)}</span>`;
  });

  // Current folder (if not root)
  if (currentFolderId !== 'root') {
    html += `<span class="breadcrumb-separator">&#8250;</span>`;
    html += `<span class="breadcrumb-item active">${escapeHtml(currentFolderName)}</span>`;
  }

  breadcrumbs.innerHTML = html;

  // Add click handlers for clickable breadcrumbs
  breadcrumbs.querySelectorAll('.breadcrumb-item.clickable').forEach(item => {
    item.addEventListener('click', () => {
      handleBreadcrumbClick(parseInt(item.dataset.index, 10));
    });
  });
}

/**
 * Update navigation button visibility.
 */
function updateNavButtons() {
  const upBtn = document.getElementById('folder-nav-up');
  // Show up button only if we're not at root
  upBtn.style.display = folderPath.length > 0 ? 'flex' : 'none';
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

    // Save any API keys the user entered (only write non-empty values so an
    // existing key is not accidentally overwritten with an empty string)
    const anthropicKey = document.getElementById('anthropic-key').value.trim();
    const openaiKey    = document.getElementById('openai-key').value.trim();
    const geminiKey    = document.getElementById('gemini-key').value.trim();
    if (anthropicKey) await setStorageValue(STORAGE_KEYS.ANTHROPIC_API_KEY, anthropicKey);
    if (openaiKey)    await setStorageValue(STORAGE_KEYS.OPENAI_API_KEY,    openaiKey);
    if (geminiKey)    await setStorageValue(STORAGE_KEYS.GEMINI_API_KEY,    geminiKey);

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

/**
 * Escape attribute values to prevent XSS in data attributes.
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeAttr(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
