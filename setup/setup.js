/**
 * Setup page logic for JobLink extension.
 * Handles initial configuration and checks if setup is already complete.
 */

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

  // Set up event listeners for buttons
  const connectDriveBtn = document.getElementById('connect-drive-btn');
  const selectFolderBtn = document.getElementById('select-folder-btn');
  const saveSetupBtn = document.getElementById('save-setup-btn');

  connectDriveBtn.addEventListener('click', handleConnectDrive);
  selectFolderBtn.addEventListener('click', handleSelectFolder);
  saveSetupBtn.addEventListener('click', handleSaveSetup);
}

/**
 * Show the "setup already complete" message.
 */
function showSetupComplete() {
  document.getElementById('setup-form').style.display = 'none';
  document.getElementById('setup-complete').style.display = 'block';
}

/**
 * Handle the "Connect Google Drive" button click.
 * TODO: Implement OAuth flow in a future session.
 */
function handleConnectDrive() {
  console.log('Connect Google Drive clicked — OAuth not yet implemented');
  // Placeholder: In a future session, this will trigger the OAuth flow
  // via chrome.identity.getAuthToken()
}

/**
 * Handle the "Select Folder" button click.
 * TODO: Implement folder picker in a future session.
 */
function handleSelectFolder() {
  console.log('Select Folder clicked — folder picker not yet implemented');
  // Placeholder: In a future session, this will open a Drive folder picker
}

/**
 * Handle the "Complete Setup" button click.
 * TODO: Validate and save settings in a future session.
 */
async function handleSaveSetup() {
  console.log('Save Setup clicked — saving not yet implemented');
  // Placeholder: In a future session, this will:
  // 1. Validate that Drive is connected
  // 2. Validate that a folder is selected
  // 3. Save settings to chrome.storage.sync
  // 4. Set SETUP_COMPLETE to true
  // 5. Close the setup tab or show success message
}
