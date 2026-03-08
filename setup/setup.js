/**
 * Setup page logic for JobLink extension.
 * Handles OAuth flow, folder selection, and per-section settings saves.
 */

// ── Module state ──────────────────────────────────────────────────────────────

let accessToken = null;

// Main save-location folder
let selectedFolderId = null;
let selectedFolderName = null;

// Application materials folders (in-memory until "Save Templates" is clicked)
let selectedCvFolderId = null;
let selectedClFolderId = null;
let selectedProfileFolderId = null;

// Folder picker shared state
// When set, the next selectFolderAndClose call targets this secondary picker
// { inputId, statusId, varSetter: (folderId) => void }
let pendingPickContext = null;

// Folder navigation state — each item: { id: string, name: string }
let folderPath = [];
let currentFolderId = 'root';
let currentFolderName = 'My Drive';

// ── Entry point ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', initSetupPage);

/**
 * Initialize the settings page.
 * Shows the first-run banner when SETUP_COMPLETE is not yet set,
 * then populates all fields from storage.
 */
async function initSetupPage() {
  try {
    const isComplete = await getStorageValue(STORAGE_KEYS.SETUP_COMPLETE);
    if (!isComplete) {
      document.getElementById('first-run-banner').style.display = 'block';
    }
  } catch (_) { /* non-fatal */ }

  wireEventListeners();
  await prefillAllFields();
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireEventListeners() {
  document.getElementById('connect-drive-btn').addEventListener('click', handleConnectDrive);
  document.getElementById('select-folder-btn').addEventListener('click', handleOpenFolderPicker);
  document.getElementById('save-folder-btn').addEventListener('click', handleSaveFolder);
  document.getElementById('save-model-btn').addEventListener('click', handleSaveModel);
  document.getElementById('save-package-btn').addEventListener('click', handleSavePackage);
  document.getElementById('save-templates-btn').addEventListener('click', handleSaveTemplates);
  document.getElementById('save-keys-btn').addEventListener('click', handleSaveKeys);
  document.getElementById('close-tab-btn').addEventListener('click', () => window.close());
  document.getElementById('error-dismiss').addEventListener('click', hideError);
  document.getElementById('folder-picker-close').addEventListener('click', hideFolderPicker);
  document.getElementById('folder-nav-up').addEventListener('click', handleNavigateUp);
  document.getElementById('select-current-btn').addEventListener('click', handleSelectCurrentFolder);

  document.getElementById('btn-pick-cv-templates').addEventListener('click', () => {
    console.log('[JobLink] btn-pick-cv-templates clicked');
    pickFolder('cv-templates-folder-name', 'cv-templates-status', (id) => {
      console.log('[JobLink] CV templates folder selected:', id);
      selectedCvFolderId = id;
    });
  });
  document.getElementById('btn-pick-cl-templates').addEventListener('click', () => {
    console.log('[JobLink] btn-pick-cl-templates clicked');
    pickFolder('cl-templates-folder-name', 'cl-templates-status', (id) => {
      console.log('[JobLink] CL templates folder selected:', id);
      selectedClFolderId = id;
    });
  });
  document.getElementById('btn-pick-profile').addEventListener('click', () => {
    console.log('[JobLink] btn-pick-profile clicked');
    pickFolder('profile-folder-name', 'profile-status', (id) => {
      console.log('[JobLink] Profile folder selected:', id);
      selectedProfileFolderId = id;
    });
  });
}

// ── Pre-fill all fields from storage ─────────────────────────────────────────

/**
 * Load all saved values from chrome.storage.sync and populate the form.
 * Also attempts a non-interactive auth token fetch to show the Drive
 * connected state without requiring a button click.
 */
async function prefillAllFields() {
  try {
    const [
      rootFolderName,
      rootFolderId,
      anthropic,
      openai,
      gemini,
      defaultModel,
      defaultPackage,
      cvFolderId,
      clFolderId,
      profileFolderId,
    ] = await Promise.all([
      getStorageValue(STORAGE_KEYS.DRIVE_ROOT_FOLDER_NAME),
      getStorageValue(STORAGE_KEYS.DRIVE_ROOT_FOLDER_ID),
      getStorageValue(STORAGE_KEYS.ANTHROPIC_API_KEY),
      getStorageValue(STORAGE_KEYS.OPENAI_API_KEY),
      getStorageValue(STORAGE_KEYS.GEMINI_API_KEY),
      getStorageValue(STORAGE_KEYS.DEFAULT_AI_MODEL),
      getStorageValue(STORAGE_KEYS.DEFAULT_PACKAGE),
      getStorageValue(STORAGE_KEYS.CV_TEMPLATES_FOLDER_ID),
      getStorageValue(STORAGE_KEYS.CL_TEMPLATES_FOLDER_ID),
      getStorageValue(STORAGE_KEYS.PROFILE_FOLDER_ID),
    ]);

    // Dropdowns and text inputs
    if (anthropic)      document.getElementById('anthropic-key').value       = anthropic;
    if (openai)         document.getElementById('openai-key').value          = openai;
    if (gemini)         document.getElementById('gemini-key').value          = gemini;
    if (defaultModel)   document.getElementById('default-ai-model').value    = defaultModel;
    if (defaultPackage) document.getElementById('default-package').value     = defaultPackage;

    // Root Drive folder
    if (rootFolderId) {
      selectedFolderId   = rootFolderId;
      selectedFolderName = rootFolderName || rootFolderId;
      const folderEl = document.getElementById('selected-folder');
      folderEl.textContent = selectedFolderName;
      folderEl.classList.add('selected');
      document.querySelector('.folder-selector').classList.add('selected');
      document.getElementById('save-folder-btn').disabled = false;
    }

    // Template and profile folder in-memory state — names resolved via Drive API below
    if (cvFolderId)      selectedCvFolderId      = cvFolderId;
    if (clFolderId)      selectedClFolderId      = clFolderId;
    if (profileFolderId) selectedProfileFolderId = profileFolderId;

    // Try a silent auth token to show connected state and resolve folder names
    const token = await getSilentAuthToken();
    if (token) {
      accessToken = token;
      showDriveConnected(token);

      // Enable folder selection now that we have a token
      document.getElementById('select-folder-btn').disabled = false;

      // Resolve stored folder names via Drive API
      const names = await Promise.all([
        cvFolderId      ? getFolderName(token, cvFolderId)      : Promise.resolve(null),
        clFolderId      ? getFolderName(token, clFolderId)      : Promise.resolve(null),
        profileFolderId ? getFolderName(token, profileFolderId) : Promise.resolve(null),
      ]);
      if (names[0]) document.getElementById('cv-templates-folder-name').value  = names[0];
      if (names[1]) document.getElementById('cl-templates-folder-name').value  = names[1];
      if (names[2]) document.getElementById('profile-folder-name').value       = names[2];
    }
  } catch (_) { /* non-fatal — user sees empty fields */ }
}

// ── Drive connection ──────────────────────────────────────────────────────────

/**
 * Request a non-interactive OAuth token (returns null if not yet authorised).
 * @returns {Promise<string|null>}
 */
function getSilentAuthToken() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token) resolve(null);
      else resolve(token);
    });
  });
}

/**
 * Update the UI to show the Drive connected state and fetch the user email.
 * @param {string} token - OAuth access token
 */
async function showDriveConnected(token) {
  try {
    const userInfo = await getUserInfo(token);
    document.getElementById('drive-not-connected').style.display = 'none';
    document.getElementById('drive-connected').style.display = 'flex';
    document.getElementById('connected-email').textContent = userInfo.email;
  } catch (_) { /* silently ignore — email display is cosmetic */ }
}

/**
 * Handle the "Connect Google Drive" button click.
 */
async function handleConnectDrive() {
  const connectBtn = document.getElementById('connect-drive-btn');
  setButtonLoading(connectBtn, true);
  hideError();

  try {
    // Clear cached token to ensure fresh scopes
    await new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (oldToken) => {
        if (oldToken) chrome.identity.removeCachedAuthToken({ token: oldToken }, resolve);
        else resolve();
      });
    });

    // Interactive OAuth
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(token);
      });
    });

    accessToken = token;
    await showDriveConnected(token);
    document.getElementById('select-folder-btn').disabled = false;
  } catch (error) {
    console.error('OAuth failed:', error);
    showError(`Failed to connect to Google Drive: ${error.message}`);
    setButtonLoading(connectBtn, false);
  }
}

// ── Per-section save handlers ─────────────────────────────────────────────────

/**
 * Save the selected Drive root folder and mark setup as complete.
 */
async function handleSaveFolder() {
  if (!selectedFolderId) return;
  const btn = document.getElementById('save-folder-btn');
  setButtonLoading(btn, true);
  hideError();
  try {
    await setStorageValue(STORAGE_KEYS.DRIVE_ROOT_FOLDER_ID,   selectedFolderId);
    await setStorageValue(STORAGE_KEYS.DRIVE_ROOT_FOLDER_NAME, selectedFolderName);
    await setStorageValue(STORAGE_KEYS.SETUP_COMPLETE, true);
    // Clear cached subfolder IDs so they are recreated inside the new root on next save.
    await chrome.storage.sync.remove([
      STORAGE_KEYS.PREPARATION_FOLDER_ID,
      STORAGE_KEYS.SUBMITTED_FOLDER_ID,
      STORAGE_KEYS.REJECTED_FOLDER_ID,
    ]);
    // First-run banner no longer needed once the user has saved a folder
    document.getElementById('first-run-banner').style.display = 'none';
    showSaveConfirm('save-folder-confirm');
  } catch (error) {
    showError('Failed to save folder: ' + error.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

/**
 * Save the default AI model selection.
 */
async function handleSaveModel() {
  const btn = document.getElementById('save-model-btn');
  setButtonLoading(btn, true);
  try {
    await setStorageValue(STORAGE_KEYS.DEFAULT_AI_MODEL, document.getElementById('default-ai-model').value);
    showSaveConfirm('save-model-confirm');
  } catch (error) {
    showError('Failed to save model: ' + error.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

/**
 * Save the default package selection.
 */
async function handleSavePackage() {
  const btn = document.getElementById('save-package-btn');
  setButtonLoading(btn, true);
  try {
    await setStorageValue(STORAGE_KEYS.DEFAULT_PACKAGE, document.getElementById('default-package').value);
    showSaveConfirm('save-package-confirm');
  } catch (error) {
    showError('Failed to save package: ' + error.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

/**
 * Save the CV, cover letter, and profile folder IDs.
 * Only writes non-null in-memory values so existing IDs are not overwritten
 * if the user hasn't changed a particular folder in this session.
 */
async function handleSaveTemplates() {
  const btn = document.getElementById('save-templates-btn');
  setButtonLoading(btn, true);
  try {
    if (selectedCvFolderId)      await setStorageValue(STORAGE_KEYS.CV_TEMPLATES_FOLDER_ID, selectedCvFolderId);
    if (selectedClFolderId)      await setStorageValue(STORAGE_KEYS.CL_TEMPLATES_FOLDER_ID, selectedClFolderId);
    if (selectedProfileFolderId) await setStorageValue(STORAGE_KEYS.PROFILE_FOLDER_ID,      selectedProfileFolderId);
    showSaveConfirm('save-templates-confirm');
  } catch (error) {
    showError('Failed to save templates: ' + error.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

/**
 * Save API keys. Always writes all three values, allowing the user to clear
 * a key by leaving its field blank.
 */
async function handleSaveKeys() {
  const btn = document.getElementById('save-keys-btn');
  setButtonLoading(btn, true);
  try {
    const anthropic = document.getElementById('anthropic-key').value.trim();
    const openai    = document.getElementById('openai-key').value.trim();
    const gemini    = document.getElementById('gemini-key').value.trim();
    await setStorageValue(STORAGE_KEYS.ANTHROPIC_API_KEY, anthropic);
    await setStorageValue(STORAGE_KEYS.OPENAI_API_KEY,    openai);
    await setStorageValue(STORAGE_KEYS.GEMINI_API_KEY,    gemini);
    showSaveConfirm('save-keys-confirm');
  } catch (error) {
    showError('Failed to save keys: ' + error.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

// ── Inline save confirmation ──────────────────────────────────────────────────

/**
 * Show a "Saved ✓" message next to a save button, then fade it out after 2 s.
 * @param {string} spanId - ID of the confirmation <span>
 */
function showSaveConfirm(spanId) {
  const span = document.getElementById(spanId);
  if (!span) return;
  span.textContent = 'Saved \u2713';
  span.classList.add('save-confirm--visible');
  setTimeout(() => {
    span.classList.remove('save-confirm--visible');
    span.textContent = '';
  }, 2000);
}

// ── Folder picker ─────────────────────────────────────────────────────────────

/**
 * Open the shared folder picker for a secondary materials folder.
 * Sets pendingPickContext so selectFolderAndClose updates the right field.
 *
 * @param {string}   inputId   - ID of the <input> element to update on selection
 * @param {string}   statusId  - ID of the status <p> element for feedback
 * @param {Function} varSetter - Callback receiving the selected folderId
 */
function pickFolder(inputId, statusId, varSetter) {
  console.log('[JobLink] pickFolder — accessToken:', accessToken ? 'present' : 'null', '| inputId:', inputId);
  if (!accessToken) {
    console.warn('[JobLink] pickFolder: no accessToken — Drive not connected');
    const statusEl = document.getElementById(statusId);
    if (statusEl) statusEl.textContent = 'Please connect Google Drive first.';
    return;
  }
  pendingPickContext = { inputId, statusId, varSetter };
  console.log('[JobLink] pickFolder — about to open picker (pendingPickContext set)');
  handleOpenFolderPicker();
}

/**
 * Handle opening the folder picker.
 * Resets navigation to root and loads top-level folders.
 */
async function handleOpenFolderPicker() {
  console.log('[JobLink] handleOpenFolderPicker — resetting state and showing picker');
  hideError();
  folderPath = [];
  currentFolderId = 'root';
  currentFolderName = 'My Drive';
  const pickerEl = document.getElementById('folder-picker');
  console.log('[JobLink] handleOpenFolderPicker — #folder-picker element:', pickerEl ? 'found' : 'NOT FOUND');
  pickerEl.style.display = 'block';
  console.log('[JobLink] handleOpenFolderPicker — picker display set to block, calling loadFolders');
  updateBreadcrumbs();
  updateNavButtons();
  await loadFolders(currentFolderId);
  console.log('[JobLink] handleOpenFolderPicker — loadFolders complete');
}

/**
 * Load and display folders for a given parent folder.
 * @param {string} parentId - Parent folder ID
 */
async function loadFolders(parentId) {
  console.log('[JobLink] loadFolders — parentId:', parentId);
  const folderList = document.getElementById('folder-list');
  folderList.innerHTML = '<div class="folder-list-loading">Loading folders...</div>';

  try {
    const folders = await listDriveFolders(accessToken, parentId);
    console.log('[JobLink] loadFolders — listDriveFolders returned', folders.length, 'folders');

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

      folderList.querySelectorAll('.folder-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (!e.target.classList.contains('folder-select-btn')) {
            navigateIntoFolder(item.dataset.folderId, item.dataset.folderName);
          }
        });
      });

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
 */
async function navigateIntoFolder(folderId, folderName) {
  folderPath.push({ id: currentFolderId, name: currentFolderName });
  currentFolderId = folderId;
  currentFolderName = folderName;
  updateBreadcrumbs();
  updateNavButtons();
  await loadFolders(folderId);
}

/**
 * Handle navigating up to parent folder.
 */
async function handleNavigateUp() {
  if (folderPath.length === 0) return;
  const parent = folderPath.pop();
  currentFolderId = parent.id;
  currentFolderName = parent.name;
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
    folderPath = [];
    currentFolderId = 'root';
    currentFolderName = 'My Drive';
  } else {
    const targetFolder = folderPath[index];
    currentFolderId = targetFolder.id;
    currentFolderName = targetFolder.name;
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
 * If pendingPickContext is set, updates that secondary field's display and
 * stores the ID in the corresponding module-level variable via varSetter.
 * Otherwise, updates the main save-location folder display.
 *
 * @param {string} folderId   - Selected folder ID
 * @param {string} folderName - Selected folder name
 */
function selectFolderAndClose(folderId, folderName) {
  // Build display path
  let fullPathName = folderName;
  if (folderPath.length > 0 || folderId !== 'root') {
    const pathNames = folderPath.map(f => f.name);
    if (folderId !== currentFolderId) pathNames.push(currentFolderName);
    if (folderId === 'root') {
      fullPathName = 'My Drive';
    } else {
      pathNames.push(folderName);
      if (pathNames[0] === 'My Drive') pathNames.shift();
      fullPathName = pathNames.length > 0 ? pathNames.join(' > ') : folderName;
    }
  }

  if (pendingPickContext) {
    const { inputId, statusId, varSetter } = pendingPickContext;
    pendingPickContext = null;
    document.getElementById(inputId).value = fullPathName;
    const statusEl = document.getElementById(statusId);
    if (statusEl) statusEl.textContent = '';
    console.log('[JobLink] selectFolderAndClose: calling varSetter for', inputId, 'with folderId:', folderId);
    varSetter(folderId);
  } else {
    // Main folder picker
    selectedFolderId   = folderId;
    selectedFolderName = fullPathName;

    const folderEl = document.getElementById('selected-folder');
    folderEl.textContent = fullPathName;
    folderEl.classList.add('selected');
    document.querySelector('.folder-selector').classList.add('selected');
    document.getElementById('save-folder-btn').disabled = false;
  }

  hideFolderPicker();
}

/**
 * Look up a folder's name by its Drive ID.
 * Returns null if the ID is invalid or the request fails.
 */
async function getFolderName(token, folderId) {
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}?fields=name`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.name || null;
  } catch (_) {
    return null;
  }
}

/**
 * Update the breadcrumb trail display.
 */
function updateBreadcrumbs() {
  const breadcrumbs = document.getElementById('folder-breadcrumbs');
  const isAtRoot = folderPath.length === 0 && currentFolderId === 'root';
  let html = `<span class="breadcrumb-item ${isAtRoot ? 'active' : 'clickable'}" data-index="-1">My Drive</span>`;

  folderPath.forEach((folder, index) => {
    html += `<span class="breadcrumb-separator">&#8250;</span>`;
    html += `<span class="breadcrumb-item clickable" data-index="${index}">${escapeHtml(folder.name)}</span>`;
  });

  if (currentFolderId !== 'root') {
    html += `<span class="breadcrumb-separator">&#8250;</span>`;
    html += `<span class="breadcrumb-item active">${escapeHtml(currentFolderName)}</span>`;
  }

  breadcrumbs.innerHTML = html;
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
  document.getElementById('folder-nav-up').style.display = folderPath.length > 0 ? 'flex' : 'none';
}

/**
 * Hide the folder picker and clear any pending pick context.
 */
function hideFolderPicker() {
  document.getElementById('folder-picker').style.display = 'none';
  pendingPickContext = null;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

/**
 * Display an error message to the user.
 * @param {string} message
 */
function showError(message) {
  document.getElementById('error-text').textContent = message;
  document.getElementById('error-message').style.display = 'flex';
}

/**
 * Hide the error message.
 */
function hideError() {
  document.getElementById('error-message').style.display = 'none';
}

/**
 * Set a button's loading state.
 * @param {HTMLElement} button
 * @param {boolean}     loading
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
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Escape attribute values to prevent XSS in data attributes.
 */
function escapeAttr(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
