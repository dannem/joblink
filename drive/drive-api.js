/**
 * Google Drive API wrapper for JobLink extension.
 * All Drive REST API calls live here exclusively.
 */

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const OAUTH_API_BASE = 'https://www.googleapis.com/oauth2/v2';

/**
 * Get the current user's Google account info (email, name).
 * @param {string} accessToken - OAuth access token
 * @returns {Promise<{email: string, name: string}>} User info
 * @throws {Error} If the API call fails
 */
async function getUserInfo(accessToken) {
  const response = await fetch(`${OAUTH_API_BASE}/userinfo`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Failed to get user info: ${response.status}`);
  }

  const data = await response.json();
  return {
    email: data.email || '',
    name: data.name || ''
  };
}

/**
 * List folders in the user's Google Drive.
 * Only returns folders, not files.
 * @param {string} accessToken - OAuth access token
 * @param {string} [parentId='root'] - Parent folder ID to list from
 * @returns {Promise<Array<{id: string, name: string}>>} Array of folder objects
 * @throws {Error} If the API call fails
 */
async function listDriveFolders(accessToken, parentId = 'root') {
  const query = encodeURIComponent(
    `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );

  const url = `${DRIVE_API_BASE}/files?q=${query}&fields=files(id,name)&orderBy=name&pageSize=100`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Failed to list folders: ${response.status}`);
  }

  const data = await response.json();
  return data.files || [];
}

/**
 * Create a new folder in Google Drive.
 * @param {string} accessToken - OAuth access token
 * @param {string} folderName - Name of the folder to create
 * @param {string} [parentId] - Parent folder ID (optional)
 * @returns {Promise<{id: string, name: string}>} Created folder info
 * @throws {Error} If the API call fails
 */
async function createDriveFolder(accessToken, folderName, parentId) {
  const metadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder'
  };

  if (parentId) {
    metadata.parents = [parentId];
  }

  const response = await fetch(`${DRIVE_API_BASE}/files`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(metadata)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Failed to create folder: ${response.status}`);
  }

  const data = await response.json();
  return {
    id: data.id,
    name: data.name
  };
}

/**
 * Upload a binary file to Google Drive using base64-encoded content.
 * Uses Content-Transfer-Encoding: base64 in the multipart body so that
 * binary data is not corrupted by string concatenation.
 * @param {string} accessToken  - OAuth access token
 * @param {string} fileName     - Name of the file
 * @param {string} base64Content - File content encoded as base64 (no data-URI prefix)
 * @param {string} mimeType     - MIME type of the file
 * @param {string} parentId     - Parent folder ID
 * @returns {Promise<{id: string, name: string}>} Uploaded file info
 * @throws {Error} If the API call fails
 */
async function uploadBase64FileToDrive(accessToken, fileName, base64Content, mimeType, parentId) {
  const metadata = {
    name: fileName,
    parents: [parentId]
  };

  const boundary = '-------JobLinkBoundaryPdf';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const body =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType}\r\n` +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    base64Content +
    closeDelimiter;

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: body
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Failed to upload file: ${response.status}`);
  }

  const data = await response.json();
  return {
    id: data.id,
    name: data.name
  };
}

/**
 * Find a folder by exact name under parentId, or create it if none exists.
 *
 * Searches Drive before creating to make the operation idempotent — calling
 * this twice with the same arguments will not produce duplicate folders.
 *
 * @param {string} accessToken - OAuth access token
 * @param {string} name        - Exact folder name to find or create
 * @param {string} parentId    - Parent folder ID to search within
 * @returns {Promise<{id: string, name: string}>} Existing or newly created folder
 * @throws {Error} If any Drive API call fails
 */
async function getOrCreateNamedFolder(accessToken, name, parentId) {
  // Escape single quotes for the Drive query string
  const safeName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const query = encodeURIComponent(
    `'${parentId}' in parents and name = '${safeName}' ` +
    `and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );

  const response = await fetch(
    `${DRIVE_API_BASE}/files?q=${query}&fields=files(id,name)&pageSize=1`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Failed to search for folder "${name}": ${response.status}`);
  }

  const data = await response.json();
  if (data.files && data.files.length > 0) {
    return { id: data.files[0].id, name: data.files[0].name };
  }

  // Folder not found — create it
  return createDriveFolder(accessToken, name, parentId);
}

/**
 * Upload a file to Google Drive.
 * @param {string} accessToken - OAuth access token
 * @param {string} fileName - Name of the file
 * @param {string} content - File content
 * @param {string} mimeType - MIME type of the file
 * @param {string} parentId - Parent folder ID
 * @returns {Promise<{id: string, name: string}>} Uploaded file info
 * @throws {Error} If the API call fails
 */
async function uploadFileToDrive(accessToken, fileName, content, mimeType, parentId) {
  const metadata = {
    name: fileName,
    parents: [parentId]
  };

  const boundary = '-------JobLinkBoundary';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const body =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType}\r\n\r\n` +
    content +
    closeDelimiter;

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: body
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Failed to upload file: ${response.status}`);
  }

  const data = await response.json();
  return {
    id: data.id,
    name: data.name
  };
}

/**
 * Read all readable profile files from the My_Profile subfolder in the user's
 * root Drive folder.  Supports Google Docs (exported as plain text) and .txt
 * files.  PDF and DOCX are skipped — binary formats require additional parsing.
 *
 * @param {string} accessToken   - OAuth access token
 * @param {string} rootFolderId  - The user's configured root Drive folder ID
 * @returns {Promise<string>} Concatenated text of all readable profile files,
 *   each prefixed with its filename as a header
 * @throws {Error} If My_Profile folder is not found, or no readable files exist
 */
async function readProfileFromDrive(accessToken, rootFolderId) {
  // 1. Find the My_Profile subfolder inside rootFolderId
  const folderQuery = encodeURIComponent(
    `'${rootFolderId}' in parents and name = 'My_Profile' ` +
    `and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const folderRes = await fetch(
    `${DRIVE_API_BASE}/files?q=${folderQuery}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!folderRes.ok) throw new Error('Could not find My_Profile folder');
  const folderData = await folderRes.json();
  const profileFolderId = folderData.files?.[0]?.id;
  if (!profileFolderId) throw new Error('My_Profile folder not found in Drive');

  // 2. List files in My_Profile
  const filesQuery = encodeURIComponent(
    `'${profileFolderId}' in parents and trashed = false`
  );
  const filesRes = await fetch(
    `${DRIVE_API_BASE}/files?q=${filesQuery}&fields=files(id,name,mimeType)&pageSize=20`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!filesRes.ok) throw new Error('Could not list My_Profile files');
  const filesData = await filesRes.json();
  const files = filesData.files || [];

  // 3. Read each file — Google Docs export as plain text, .txt download directly
  const texts = [];
  for (const file of files) {
    try {
      let text = '';
      if (file.mimeType === 'application/vnd.google-apps.document') {
        // Export Google Doc as plain text
        const exportRes = await fetch(
          `${DRIVE_API_BASE}/files/${file.id}/export?mimeType=text/plain`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (exportRes.ok) text = await exportRes.text();
      } else if (file.mimeType === 'text/plain') {
        const dlRes = await fetch(
          `${DRIVE_API_BASE}/files/${file.id}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (dlRes.ok) text = await dlRes.text();
      }
      // Skip PDF and DOCX — binary formats need additional parsing (future work)
      if (text.trim()) {
        texts.push(`--- ${file.name} ---\n${text.trim()}`);
      }
    } catch (e) {
      console.warn(`[JobLink] Could not read profile file ${file.name}:`, e);
    }
  }

  if (texts.length === 0) throw new Error('No readable profile files found in My_Profile');
  return texts.join('\n\n');
}
