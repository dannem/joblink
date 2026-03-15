/**
 * Setup page logic for JobLink extension.
 * Handles OAuth flow, folder selection, and per-section settings saves.
 */

// ── Module state ──────────────────────────────────────────────────────────────

let accessToken = null;

// Lemon Squeezy checkout URL — update when store is live
const LEMON_SQUEEZY_CHECKOUT_URL = 'https://joblink.lemonsqueezy.com/checkout/buy/86e5c3a4-5697-46f8-a0a0-94ca692f1608';

// Main save-location folder
let selectedFolderId = null;
let selectedFolderName = null;

// Application materials folders (in-memory until "Save Templates" is clicked)
let selectedCvFolderId = null;
let selectedCvFolderName = null;
let selectedClFolderId = null;
let selectedClFolderName = null;
let selectedProfileFolderId = null;
let selectedProfileFolderName = null;

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
  await tryRestoreDriveConnection();
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
  document.getElementById('save-all-btn').addEventListener('click', handleSaveAll);
  document.getElementById('close-tab-btn').addEventListener('click', () => window.close());
  document.getElementById('reconnect-drive-btn').addEventListener('click', handleReconnectDrive);
  document.getElementById('error-dismiss').addEventListener('click', hideError);
  document.getElementById('folder-picker-close').addEventListener('click', hideFolderPicker);
  document.getElementById('folder-refresh-btn').addEventListener('click', handleRefreshFolders);
  document.getElementById('folder-nav-up').addEventListener('click', handleNavigateUp);
  document.getElementById('select-current-btn').addEventListener('click', handleSelectCurrentFolder);
  document.getElementById('new-folder-btn').addEventListener('click', handleNewFolder);

  document.getElementById('btn-pick-cv-templates').addEventListener('click', () => {
    pickFolder('cv-templates-folder-name', 'cv-templates-status', (id) => {
      selectedCvFolderId   = id;
      selectedCvFolderName = document.getElementById('cv-templates-folder-name').value;
    });
  });
  document.getElementById('btn-pick-cl-templates').addEventListener('click', () => {
    pickFolder('cl-templates-folder-name', 'cl-templates-status', (id) => {
      selectedClFolderId   = id;
      selectedClFolderName = document.getElementById('cl-templates-folder-name').value;
    });
  });
  document.getElementById('activate-licence-btn').addEventListener('click', handleActivateLicence);
  document.getElementById('revoke-licence-btn').addEventListener('click', handleRevokeLicence);

  document.getElementById('btn-pick-profile').addEventListener('click', () => {
    pickFolder('profile-folder-name', 'profile-status', (id) => {
      selectedProfileFolderId   = id;
      selectedProfileFolderName = document.getElementById('profile-folder-name').value;
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
      cvFolderName,
      clFolderId,
      clFolderName,
      profileFolderId,
      profileFolderName,
      // eslint-disable-next-line no-unused-vars
      _licenceKey,
      // eslint-disable-next-line no-unused-vars
      _licenceValid,
    ] = await Promise.all([
      getStorageValue(STORAGE_KEYS.DRIVE_ROOT_FOLDER_NAME),
      getStorageValue(STORAGE_KEYS.DRIVE_ROOT_FOLDER_ID),
      getStorageValue(STORAGE_KEYS.ANTHROPIC_API_KEY),
      getStorageValue(STORAGE_KEYS.OPENAI_API_KEY),
      getStorageValue(STORAGE_KEYS.GEMINI_API_KEY),
      getStorageValue(STORAGE_KEYS.DEFAULT_AI_MODEL),
      getStorageValue(STORAGE_KEYS.DEFAULT_PACKAGE),
      getStorageValue(STORAGE_KEYS.CV_TEMPLATES_FOLDER_ID),
      getStorageValue(STORAGE_KEYS.CV_TEMPLATES_FOLDER_NAME),
      getStorageValue(STORAGE_KEYS.CL_TEMPLATES_FOLDER_ID),
      getStorageValue(STORAGE_KEYS.CL_TEMPLATES_FOLDER_NAME),
      getStorageValue(STORAGE_KEYS.PROFILE_FOLDER_ID),
      getStorageValue(STORAGE_KEYS.PROFILE_FOLDER_NAME),
      getStorageValue(STORAGE_KEYS.LICENCE_KEY),
      getStorageValue(STORAGE_KEYS.LICENCE_VALID),
    ]);

    // Dropdowns and text inputs
    if (anthropic) document.getElementById('anthropic-key').value = anthropic;
    if (openai)    document.getElementById('openai-key').value    = openai;
    if (gemini)    document.getElementById('gemini-key').value    = gemini;

    // Default AI model
    const modelSelect = document.getElementById('default-ai-model');
    await refreshModelDropdownSetup(anthropic, openai, gemini);
    
    // Apply saved model, or fall back to best available if it's disabled / not set
    const PROVIDER_PRIORITY = ['sonnet', 'geminiFlash25', 'gpt-4o', 'haiku'];
    if (defaultModel) modelSelect.value = defaultModel;
    const chosen = modelSelect.options[modelSelect.selectedIndex];
    if (!defaultModel || chosen?.disabled || chosen?.value === 'no-keys') {
      const fallback = PROVIDER_PRIORITY.find(v => {
        const opt = [...modelSelect.options].find(o => o.value === v);
        return opt && !opt.disabled;
      });
      if (fallback) modelSelect.value = fallback;
    }

    if (defaultPackage) document.getElementById('default-package').value = defaultPackage;

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
    // Pre-tick step 2 if folder already saved
    if (rootFolderId) {
      const step2 = document.getElementById('setup-step-2');
      if (step2) step2.classList.add('done');
    }

    // Template and profile folder in-memory state — restored from storage
    if (cvFolderId)      selectedCvFolderId        = cvFolderId;
    if (cvFolderName)    selectedCvFolderName       = cvFolderName;
    if (clFolderId)      selectedClFolderId         = clFolderId;
    if (clFolderName)    selectedClFolderName       = clFolderName;
    if (profileFolderId) selectedProfileFolderId    = profileFolderId;
    if (profileFolderName) selectedProfileFolderName = profileFolderName;

    // Populate folder name inputs from storage
    if (cvFolderName)      document.getElementById('cv-templates-folder-name').value = cvFolderName;
    if (clFolderName)      document.getElementById('cl-templates-folder-name').value = clFolderName;
    if (profileFolderName) document.getElementById('profile-folder-name').value      = profileFolderName;

    // Try a silent auth token to show connected state
    const token = await getSilentAuthToken();
    if (token) {
      accessToken = token;
      showDriveConnected(token);
      // Pre-tick step 1 if already connected
      const step1 = document.getElementById('setup-step-1');
      if (step1) step1.classList.add('done');

      // Enable folder selection now that we have a token
      document.getElementById('select-folder-btn').disabled = false;
    }

    // Pro section
    await refreshProSection();
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
  // Tick off step 1 in the first-run checklist
  const step1 = document.getElementById('setup-step-1');
  if (step1) step1.classList.add('done');
}

/**
 * Attempt to silently restore the Drive connection on page load.
 * Uses the stored email to show "Connected as" state without re-prompting.
 * Then attempts a silent non-interactive OAuth token refresh in the background.
 * Never shows an error to the user — if it fails, the Connect button remains.
 */
async function tryRestoreDriveConnection() {
  try {
    const storedEmail = await getStorageValue(STORAGE_KEYS.CONNECTED_EMAIL);
    if (!storedEmail) return;

    // Show connected state immediately using stored email
    document.getElementById('drive-not-connected').style.display = 'none';
    document.getElementById('drive-connected').style.display = 'flex';
    document.getElementById('connected-email').textContent = storedEmail;
    document.getElementById('select-folder-btn').disabled = false;

    // Attempt silent token refresh in background — don't block UI or show errors
    try {
      const token = await getOAuthToken(false);
      accessToken = token;
    } catch (_) {
      // Silent failure — token will be requested interactively if user
      // tries to open folder picker or save
    }
  } catch (_) {
    // Silent failure — don't show anything to the user
  }
}

/**
 * Force a fresh OAuth token and update the connected email display.
 * Used when the user wants to re-authenticate or switch accounts.
 */
async function handleReconnectDrive() {
  const btn = document.getElementById('reconnect-drive-btn');
  setButtonLoading(btn, true);
  hideError();

  try {
    // Clear all cached tokens first
    await clearCachedOAuthToken();

    // Force interactive re-auth
    const token = await getOAuthToken(true);
    accessToken = token;

    // Update stored email
    const userInfo = await getUserInfo(token);
    await setStorageValue(STORAGE_KEYS.CONNECTED_EMAIL, userInfo.email);

    // Update UI
    document.getElementById('connected-email').textContent = userInfo.email;

  } catch (error) {
    console.error('[JobLink] Reconnect failed:', error);
    showError(`Failed to reconnect: ${error.message}`);
  } finally {
    setButtonLoading(btn, false);
  }
}

/**
 * Handle the "Connect Google Drive" button click.
 */
async function handleConnectDrive() {
  const connectBtn = document.getElementById('connect-drive-btn');
  setButtonLoading(connectBtn, true);
  hideError();

  try {
    // Clear any cached token so we always get a fresh one on Connect
    await clearCachedOAuthToken();

    const token = await getOAuthToken(true);
    accessToken = token;

    // Get user info to display email
    const userInfo = await getUserInfo(token);

    // Update UI to show connected state
    document.getElementById('drive-not-connected').style.display = 'none';
    document.getElementById('drive-connected').style.display = 'flex';
    document.getElementById('connected-email').textContent = userInfo.email;

    // Persist email so connection state survives browser restart
    await setStorageValue(STORAGE_KEYS.CONNECTED_EMAIL, userInfo.email);

    // Enable folder selection
    document.getElementById('select-folder-btn').disabled = false;
  } catch (error) {
    console.error('[JobLink] OAuth failed:', error);
    showError(`Failed to connect to Google Drive: ${error.message}`);
    setButtonLoading(connectBtn, false);
  }
}

// ── Pro section ───────────────────────────────────────────────────────────────

/**
 * Refresh the Pro status section in Settings to match current storage state.
 */
async function refreshProSection() {
  const [anthropic, openai, gemini, licenceKey, licenceValid] = await Promise.all([
    getStorageValue(STORAGE_KEYS.ANTHROPIC_API_KEY),
    getStorageValue(STORAGE_KEYS.OPENAI_API_KEY),
    getStorageValue(STORAGE_KEYS.GEMINI_API_KEY),
    getStorageValue(STORAGE_KEYS.LICENCE_KEY),
    getStorageValue(STORAGE_KEYS.LICENCE_VALID),
  ]);

  const hasApiKey = !!(anthropic || openai || gemini);
  const isPro = !!(hasApiKey || licenceValid);

  const badge        = document.getElementById('pro-settings-badge');
  const description  = document.getElementById('pro-status-description');
  const upgradeCta   = document.getElementById('pro-upgrade-cta');
  const revokeRow    = document.getElementById('revoke-licence-row');
  const licenceInput = document.getElementById('licence-key-input');

  if (isPro) {
    badge.textContent = 'Pro';
    badge.className   = 'pro-badge pro-badge--pro';
    upgradeCta.style.display = 'none';
    if (licenceValid) {
      description.textContent = 'Active — licence key verified.';
    } else {
      description.textContent = 'Active — using your own API key.';
    }
  } else {
    badge.textContent = 'Free';
    badge.className   = 'pro-badge pro-badge--free';
    upgradeCta.style.display = 'block';
    description.textContent = 'Upgrade to unlock AI-powered Evaluate Fit and Prepare Package.';
  }

  if (licenceKey) {
    licenceInput.value = licenceKey;
    revokeRow.style.display = 'block';
  } else {
    revokeRow.style.display = 'none';
  }
}

/**
 * Handle the Activate licence key button.
 * V1: accepts any non-empty string and marks it as valid (real validation in V2).
 */
async function handleActivateLicence() {
  const btn       = document.getElementById('activate-licence-btn');
  const input     = document.getElementById('licence-key-input');
  const statusMsg = document.getElementById('licence-status-msg');
  const key       = input.value.trim();

  if (!key) {
    statusMsg.textContent = 'Please enter a licence key.';
    statusMsg.className   = 'field-status error';
    return;
  }

  setButtonLoading(btn, true);
  statusMsg.textContent = '';
  statusMsg.className   = 'field-status';

  try {
    // V1: accept the key as valid without a server call.
    // V2: replace this block with a real Lemon Squeezy API validation call.
    await setStorageValue(STORAGE_KEYS.LICENCE_KEY,   key);
    await setStorageValue(STORAGE_KEYS.LICENCE_VALID, true);

    statusMsg.textContent = 'Licence activated \u2713';
    statusMsg.className   = 'field-status success';
    await refreshProSection();
  } catch (err) {
    statusMsg.textContent = 'Failed to activate: ' + err.message;
    statusMsg.className   = 'field-status error';
  } finally {
    setButtonLoading(btn, false);
  }
}

/**
 * Remove the stored licence key and revoke Pro status (if it was from the key).
 */
async function handleRevokeLicence() {
  const statusMsg = document.getElementById('licence-status-msg');
  try {
    await setStorageValue(STORAGE_KEYS.LICENCE_KEY,   '');
    await setStorageValue(STORAGE_KEYS.LICENCE_VALID, false);
    document.getElementById('licence-key-input').value = '';
    statusMsg.textContent = 'Licence key removed.';
    statusMsg.className   = 'field-status';
    await refreshProSection();
  } catch (err) {
    statusMsg.textContent = 'Failed to remove key: ' + err.message;
    statusMsg.className   = 'field-status error';
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
    // Tick off step 2 in the first-run checklist
    const step2 = document.getElementById('setup-step-2');
    if (step2) step2.classList.add('done');
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
    await setStorageValue(STORAGE_KEYS.CV_TEMPLATES_FOLDER_NAME,  selectedCvFolderName      || '');
    await setStorageValue(STORAGE_KEYS.CL_TEMPLATES_FOLDER_NAME,  selectedClFolderName      || '');
    await setStorageValue(STORAGE_KEYS.PROFILE_FOLDER_NAME,       selectedProfileFolderName || '');
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
 * Also re-applies the model dropdown filter after keys change.
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
    // Tick off step 3 if any key was entered
    if (anthropic || openai || gemini) {
      const step3 = document.getElementById('setup-step-3');
      if (step3) step3.classList.add('done');
    }
    // Re-filter model dropdown now that keys have changed
    await refreshModelDropdownSetup(anthropic, openai, gemini);
    await refreshProSection();
  } catch (error) {
    showError('Failed to save keys: ' + error.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

/**
 * Save all settings sections in one operation.
 * Calls the individual save handlers and shows a single success message.
 */
async function handleSaveAll() {
  const btn = document.getElementById('save-all-btn');
  setButtonLoading(btn, true);

  try {
    // Save Drive root folder if one is selected
    if (selectedFolderId) {
      try {
        await setStorageValue(STORAGE_KEYS.DRIVE_ROOT_FOLDER_ID,   selectedFolderId);
        await setStorageValue(STORAGE_KEYS.DRIVE_ROOT_FOLDER_NAME, selectedFolderName || '');
      } catch (_) {}
    }

    // Save templates folders
    try {
      await handleSaveTemplates();
    } catch (_) {}

    // Save AI model preference
    try {
      await handleSaveModel();
    } catch (_) {}

    // Save default package type
    try {
      await handleSavePackage();
    } catch (_) {}

    // Show success
    const successEl = document.getElementById('save-all-success');
    successEl.style.display = 'block';
    setTimeout(() => { successEl.style.display = 'none'; }, 3000);

  } finally {
    setButtonLoading(btn, false);
  }
}

/**
 * Re-apply the disabled/enabled state on the Settings Default AI Model dropdown
 * after API keys are saved.
 *
 * @param {string} anthropic
 * @param {string} openai
 * @param {string} gemini
 */
async function refreshModelDropdownSetup(anthropic, openai, gemini) {
  const modelSelect = document.getElementById('default-ai-model');
  const currentValue = modelSelect.value;
  
  // Define all possible models and their providers
  const allModels = [
    { value: 'sonnet', text: 'Claude 3.5 Sonnet (Best)', provider: 'anthropic' },
    { value: 'haiku', text: 'Claude 3 Haiku (Fastest)', provider: 'anthropic' },
    { value: 'o1', text: 'OpenAI GPT-4o', provider: 'openai' },
    { value: 'o1-mini', text: 'OpenAI GPT-4o mini', provider: 'openai' },
    { value: 'gpt-4-turbo', text: 'OpenAI GPT-4 Turbo', provider: 'openai' },
    { value: 'geminiFlash25', text: 'Google Gemini 1.5 Flash (Recommended)', provider: 'gemini' },
    { value: 'geminiPro15', text: 'Google Gemini 1.5 Pro', provider: 'gemini' }
  ];

  // Clear existing options
  modelSelect.innerHTML = '';

  // Filter models based on available keys
  const availableModels = allModels.filter(model => {
    if (model.provider === 'anthropic') return !!anthropic;
    if (model.provider === 'openai') return !!openai;
    if (model.provider === 'gemini') return !!gemini;
    return false;
  });

  // Populate dropdown with available models
  if (availableModels.length > 0) {
    availableModels.forEach(model => {
      const option = document.createElement('option');
      option.value = model.value;
      option.textContent = model.text;
      modelSelect.appendChild(option);
    });
  } else {
    // Show a warning if no keys are set
    const option = document.createElement('option');
    option.value = 'no-keys';
    option.textContent = 'No API keys set - add a key below';
    option.disabled = true;
    modelSelect.appendChild(option);
  }

  // Keep current selection if still valid, else fall back to best available
  const currentSelectionStillAvailable = availableModels.some(model => model.value === currentValue);
  if (currentSelectionStillAvailable) {
    modelSelect.value = currentValue;
  } else if (availableModels.length > 0) {
    const PROVIDER_PRIORITY = ['sonnet', 'geminiFlash25', 'o1', 'haiku'];
    const fallback = PROVIDER_PRIORITY.find(v => availableModels.some(m => m.value === v));
    if (fallback) modelSelect.value = fallback;
    else modelSelect.value = availableModels[0].value; // fallback to the first available
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
  if (!accessToken) {
    console.warn('[JobLink] pickFolder: no accessToken — Drive not connected');
    const statusEl = document.getElementById(statusId);
    if (statusEl) statusEl.textContent = 'Please connect Google Drive first.';
    return;
  }
  pendingPickContext = { inputId, statusId, varSetter };
  handleOpenFolderPicker();
}

/**
 * Handle opening the folder picker.
 * Resets navigation to root and loads top-level folders.
 */
async function handleOpenFolderPicker() {
  if (!accessToken) {
    try {
      accessToken = await getOAuthToken(true);
    } catch (err) {
      showError('Please reconnect Google Drive to select a folder.');
      return;
    }
  }

  hideError();
  folderPath = [];
  currentFolderId = 'root';
  currentFolderName = 'My Drive';
  const pickerEl = document.getElementById('folder-picker');
  pickerEl.style.display = 'block';
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
 * Refresh the folder list for the current folder in the picker.
 * Useful when the user has just created a new folder in Drive.
 */
async function handleRefreshFolders() {
  const refreshBtn = document.getElementById('folder-refresh-btn');
  refreshBtn.style.opacity = '0.4';
  refreshBtn.disabled = true;

  try {
    await loadFolders(currentFolderId);
  } finally {
    refreshBtn.style.opacity = '1';
    refreshBtn.disabled = false;
  }
}

/**
 * Hide the folder picker and clear any pending pick context.
 */
function hideFolderPicker() {
  document.getElementById('folder-picker').style.display = 'none';
  pendingPickContext = null;
}

/**
 * Handle creating a new subfolder inside the currently browsed folder.
 */
async function handleNewFolder() {
  const name = prompt('Enter new folder name:');
  if (!name || !name.trim()) return;

  const folderList = document.getElementById('folder-list');
  const btn = document.getElementById('new-folder-btn');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: name.trim(),
        mimeType: 'application/vnd.google-apps.folder',
        parents: [currentFolderId],
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || 'Failed to create folder');
    }

    // Reload the current folder to show the new subfolder
    await loadFolders(currentFolderId);
  } catch (error) {
    showError('Could not create folder: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '+ New Folder';
  }
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
