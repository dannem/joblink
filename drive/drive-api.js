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
 * List folders in the user's Google Drive under a given parent.
 * Falls back to a name-based search if the parent has a legacy folder ID
 * (0B... format) that cannot be listed directly via the Files API.
 *
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
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  // If the parent folder has a legacy ID (0B... format), the API returns 404.
  // Fall back to searching Drive-wide for folders with this parent.
  if (response.status === 404) {
    const fallbackQuery = encodeURIComponent(
      `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    );
    const fallbackUrl = `${DRIVE_API_BASE}/files?q=${fallbackQuery}&fields=files(id,name)&orderBy=name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`;

    const fallbackResponse = await fetch(fallbackUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!fallbackResponse.ok) {
      // Both attempts failed — return empty list so picker shows graceful message
      console.warn('[JobLink] Could not list folders for parent:', parentId);
      return [];
    }

    const fallbackData = await fallbackResponse.json();
    return fallbackData.files || [];
  }

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
 * Recursively list all files matching the given mimeTypes within a Drive folder
 * and all of its subfolders.
 *
 * The function makes one API call per folder level.  Each call fetches up to
 * 100 items (files + subfolders).  Subfolders are detected by their mimeType
 * and recursed into; only files whose mimeType is in the mimeTypes array are
 * collected and returned.
 *
 * @param {string}   accessToken - OAuth access token
 * @param {string}   folderId    - Drive folder ID to start from
 * @param {string[]} mimeTypes   - Array of mimeType strings to collect
 * @returns {Promise<Array<{id: string, name: string, mimeType: string}>>}
 */
async function listFilesRecursively(accessToken, folderId, mimeTypes) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await fetch(
    `${DRIVE_API_BASE}/files?q=${q}&fields=files(id,name,mimeType)&pageSize=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const items = data.files || [];

  const collected = [];
  for (const item of items) {
    if (item.mimeType === 'application/vnd.google-apps.folder') {
      const nested = await listFilesRecursively(accessToken, item.id, mimeTypes);
      collected.push(...nested);
    } else if (mimeTypes.includes(item.mimeType)) {
      collected.push(item);
    }
  }
  return collected;
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

  // 2. List files in My_Profile (recursively, including subfolders)
  const files = await listFilesRecursively(
    accessToken,
    profileFolderId,
    ['application/vnd.google-apps.document', 'text/plain']
  );

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

/**
 * Search the three job-status subfolders (Preparation, Submitted, Rejected)
 * for a folder whose name matches the given job.
 *
 * Returns the first match found, prioritising Submitted and Rejected over
 * Preparation so that the most significant duplicate status is surfaced.
 *
 * @param {string} accessToken - OAuth access token
 * @param {Object} job         - { company, jobTitle } from the scraped job
 * @returns {Promise<{status: string, folder: {id: string, name: string}}|null>}
 *   Match object, or null when no duplicate is found
 */
async function checkExistingApplication(accessToken, job) {
  const folderName = sanitiseFolderName(job.company, job.jobTitle);

  // Read all three status folder IDs from storage in parallel
  const [prepId, subId, rejId] = await Promise.all([
    getStorageValue(STORAGE_KEYS.PREPARATION_FOLDER_ID),
    getStorageValue(STORAGE_KEYS.SUBMITTED_FOLDER_ID),
    getStorageValue(STORAGE_KEYS.REJECTED_FOLDER_ID),
  ]);

  /**
   * Search a single parent folder for a child folder matching folderName.
   * Returns the matching folder object, or null if not found or parentId is empty.
   */
  async function searchInFolder(parentId) {
    if (!parentId) return null;
    const hash = jobHashId(job);
    const safeHash = `[${hash}]`.replace(/'/g, "\\'");
    const query = encodeURIComponent(
      `'${parentId}' in parents and name contains '${safeHash}' ` +
      `and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    );
    const res = await fetch(
      `${DRIVE_API_BASE}/files?q=${query}&fields=files(id,name)&pageSize=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.files?.[0] || null;
  }

  // Search all three folders concurrently
  const [subMatch, rejMatch, prepMatch] = await Promise.all([
    searchInFolder(subId),
    searchInFolder(rejId),
    searchInFolder(prepId),
  ]);

  if (subMatch)  return { status: 'submitted',   folder: subMatch };
  if (rejMatch)  return { status: 'rejected',    folder: rejMatch };
  if (prepMatch) return { status: 'preparation', folder: prepMatch };
  return null;
}

// ── Package save helpers ────────────────────────────────────────────────────

/**
 * Find a subfolder by exact name within a parent folder.
 * Returns the folder ID string, or null if not found.
 *
 * @param {string} accessToken
 * @param {string} parentId
 * @param {string} name
 * @returns {Promise<string|null>}
 */
async function findFolderByName(accessToken, parentId, name) {
  const escaped = name.replace(/'/g, "\\'");
  const q = encodeURIComponent(
    `'${parentId}' in parents and name = '${escaped}' ` +
    `and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const res = await fetch(
    `${DRIVE_API_BASE}/files?q=${q}&fields=files(id)&pageSize=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.files?.[0]?.id || null;
}

/**
 * List and export all Google Docs from a Drive folder (and its subfolders)
 * as plain text.  Returns up to 100 documents as { id, name, text } objects.
 * Files that fail to export are silently skipped.
 *
 * @param {string} accessToken - OAuth access token
 * @param {string} folderId    - Drive folder ID to read from
 * @returns {Promise<Array<{id: string, name: string, text: string}>>}
 */
async function readDocsFromFolder(accessToken, folderId) {
  const files = await listFilesRecursively(
    accessToken,
    folderId,
    ['application/vnd.google-apps.document']
  );

  const results = [];
  for (const file of files) {
    try {
      const exportRes = await fetch(
        `${DRIVE_API_BASE}/files/${file.id}/export?mimeType=text%2Fplain`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!exportRes.ok) continue;
      const text = await exportRes.text();
      if (text.trim()) results.push({ id: file.id, name: file.name, text: text.trim() });
    } catch (_) { /* skip unreadable files */ }
  }
  return results;
}

/**
 * Copy all non-folder files from one Drive folder to another.
 * Skips subfolders — only top-level files are copied.
 *
 * @param {string} accessToken
 * @param {string} sourceFolderId
 * @param {string} destFolderId
 * @returns {Promise<void>}
 */
async function copyFolderContents(accessToken, sourceFolderId, destFolderId) {
  const q = encodeURIComponent(
    `'${sourceFolderId}' in parents and trashed = false ` +
    `and mimeType != 'application/vnd.google-apps.folder'`
  );
  const res = await fetch(
    `${DRIVE_API_BASE}/files?q=${q}&fields=files(id,name)&pageSize=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return;
  const data = await res.json();
  const files = data.files || [];

  for (const file of files) {
    await fetch(`${DRIVE_API_BASE}/files/${file.id}/copy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: file.name,
        parents: [destFolderId],
      }),
    });
  }
}

/**
 * Delete a folder and all its contents permanently.
 *
 * @param {string} accessToken
 * @param {string} folderId
 * @returns {Promise<void>}
 */
async function deleteFolderAndContents(accessToken, folderId) {
  await fetch(`${DRIVE_API_BASE}/files/${folderId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * Wrap an HTML fragment in a minimal document for Google Drive upload.
 * Drive requires a proper HTML document to render headings and styles correctly.
 *
 * @param {string} title    - Document title (used in <title> tag)
 * @param {string} htmlBody - HTML fragment (no <html>/<body> tags)
 * @returns {string} Complete HTML document string
 */
function wrapHtmlDocument(title, htmlBody) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.4; margin: 40px; color: #222; }
  h1 { font-size: 20pt; margin-bottom: 4px; }
  h2 { font-size: 13pt; border-bottom: 1px solid #aaa; padding-bottom: 2px; margin-top: 18px; }
  h3 { font-size: 11pt; margin-bottom: 2px; }
  ul { margin: 4px 0 4px 20px; }
  li { margin-bottom: 2px; }
  p  { margin: 4px 0; }
</style>
</head>
<body>
${htmlBody}
</body>
</html>`;
}

/**
 * Create a new Google Doc inside a Drive folder.
 * Uses the Drive multipart upload API — no Docs API required.
 * Pass HTML content (default) and Drive will convert it to a formatted Doc.
 *
 * @param {string} accessToken
 * @param {string} parentFolderId
 * @param {string} title       - Document title
 * @param {string} content     - Document body (HTML by default)
 * @returns {Promise<string>}  ID of the created Google Doc
 */
async function createGoogleDoc(accessToken, parentFolderId, title, content, mimeType = 'text/html') {
  const metadata = {
    name: title,
    mimeType: 'application/vnd.google-apps.document',
    parents: [parentFolderId],
  };

  const boundary = 'joblink_boundary_' + Date.now();
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}; charset=UTF-8`,
    '',
    content,
    `--${boundary}--`,
  ].join('\r\n');

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to create Google Doc: ${res.status}`);
  }

  const data = await res.json();
  if (!data.id) throw new Error('Google Doc created but no ID returned.');
  return data.id;
}

/**
 * Create a new Google Doc in a Drive folder and populate it with job data.
 *
 * Step 1: Creates an empty Google Doc via the Drive files API.
 * Step 2: Inserts formatted job data as plain text via the Docs batchUpdate API.
 *
 * @param {Object} jobData   - Standard scraper output object (jobTitle, company, etc.)
 * @param {string} folderId  - Drive folder ID to create the doc in
 * @param {string} token     - OAuth access token
 * @returns {Promise<string>} ID of the created Google Doc
 * @throws {Error} If the Drive or Docs API call fails
 */
async function saveJobAsGoogleDoc(jobData, folderId, token) {
  // ── 1. Create an empty Google Doc ─────────────────────────────────────────
  const createRes = await fetch(`${DRIVE_API_BASE}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: jobPostingFileName(jobData),
      mimeType: 'application/vnd.google-apps.document',
      parents: [folderId],
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to create Google Doc: ${createRes.status}`);
  }

  const { id: docId } = await createRes.json();

  // ── 2. Build the formatted plain-text body ────────────────────────────────
  const separator = '─'.repeat(60);
  const text = [
    jobData.jobTitle || '',
    '',
    `Company:   ${jobData.company || ''}`,
    `Location:  ${jobData.location || ''}`,
    `Source:    ${jobData.source || ''}`,
    `Scraped:   ${jobData.scrapedAt || ''}`,
    `URL:       ${jobData.applicationUrl || ''}`,
    '',
    separator,
    '',
    'JOB DESCRIPTION',
    '',
    jobData.description || '',
  ].join('\n');

  // ── 3. Populate the doc with a single insertText batchUpdate ──────────────
  const batchRes = await fetch(
    `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text,
            },
          },
        ],
      }),
    }
  );

  if (!batchRes.ok) {
    const err = await batchRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to populate Google Doc: ${batchRes.status}`);
  }

  console.log(`[JobLink] Job saved as Google Doc: ${docId}`);
  return docId;
}

/**
 * Export a Google Doc as PDF and upload it to a Drive folder.
 *
 * @param {string} accessToken
 * @param {string} docId          - ID of the Google Doc to export
 * @param {string} parentFolderId - Folder to save the PDF in
 * @param {string} title          - Base title (without .pdf extension)
 * @returns {Promise<string>} ID of the uploaded PDF file
 */
async function exportDocAsPDF(accessToken, docId, parentFolderId, title) {
  // Export Google Doc as PDF bytes
  const exportRes = await fetch(
    `${DRIVE_API_BASE}/files/${docId}/export?mimeType=application%2Fpdf`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!exportRes.ok) {
    throw new Error(`Failed to export Google Doc as PDF: ${exportRes.status}`);
  }
  const pdfBlob = await exportRes.blob();

  // Build multipart body using binary-safe ArrayBuffer concatenation
  const metadata = {
    name: `${title}.pdf`,
    mimeType: 'application/pdf',
    parents: [parentFolderId],
  };

  const boundary  = 'joblink_pdf_boundary_' + Date.now();
  const metaPart  = JSON.stringify(metadata);
  const encoder   = new TextEncoder();
  const partHeader = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    metaPart +
    `\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`
  );
  const partFooter = encoder.encode(`\r\n--${boundary}--`);
  const pdfBytes   = await pdfBlob.arrayBuffer();

  const combined = new Uint8Array(partHeader.length + pdfBytes.byteLength + partFooter.length);
  combined.set(partHeader, 0);
  combined.set(new Uint8Array(pdfBytes), partHeader.length);
  combined.set(partFooter, partHeader.length + pdfBytes.byteLength);

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: combined,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to upload PDF: ${uploadRes.status}`);
  }

  const data = await uploadRes.json();
  return data.id;
}

/**
 * Upload a plain text or HTML string as a file to a Drive folder.
 *
 * @param {string} accessToken
 * @param {string} parentFolderId
 * @param {string} filename
 * @param {string} content
 * @param {string} mimeType - e.g. 'application/json', 'text/html'
 * @returns {Promise<string>} ID of uploaded file
 */
async function uploadTextFile(accessToken, parentFolderId, filename, content, mimeType) {
  const metadata = { name: filename, parents: [parentFolderId] };
  const boundary = 'joblink_text_' + Date.now();
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}; charset=UTF-8`,
    '',
    content,
    `--${boundary}--`,
  ].join('\r\n');

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to upload ${filename}: ${res.status}`);
  }
  const data = await res.json();
  return data.id;
}

/**
 * Upload a base64-encoded binary file to a Drive folder.
 * Used for PDF files generated by jsPDF in the side panel context.
 *
 * @param {string} accessToken
 * @param {string} parentFolderId
 * @param {string} filename
 * @param {string} base64Data - Raw base64 string (no data URI prefix)
 * @param {string} mimeType
 * @returns {Promise<string>} ID of uploaded file
 */
async function uploadBase64File(accessToken, parentFolderId, filename, base64Data, mimeType) {
  const metadata = { name: filename, parents: [parentFolderId] };
  const boundary = 'joblink_b64_' + Date.now();
  const encoder  = new TextEncoder();

  const headerPart = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`
  );
  const footerPart = encoder.encode(`\r\n--${boundary}--`);
  const bodyPart   = encoder.encode(base64Data);

  const combined = new Uint8Array(headerPart.length + bodyPart.length + footerPart.length);
  combined.set(headerPart, 0);
  combined.set(bodyPart, headerPart.length);
  combined.set(footerPart, headerPart.length + bodyPart.length);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: combined,
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to upload ${filename}: ${res.status}`);
  }
  const data = await res.json();
  return data.id;
}

/**
 * Save a prepared application package to the Submitted folder.
 *
 * Steps:
 *  1. Resolve Submitted folder ID from storage (Preparation is optional)
 *  2. Create the job subfolder in Submitted
 *  3. If a Preparation subfolder exists, copy its files then delete it
 *  4. Save job files (JSON, HTML, PDF) directly to Submitted
 *  5. Save tailored CV as Google Doc + PDF
 *  6. Save cover letter as Google Doc + PDF
 *
 * @param {string} accessToken
 * @param {Object} job                  - { jobTitle, company, ... }
 * @param {string} tailoredCVText       - HTML content of the tailored CV
 * @param {string} coverLetterText      - HTML content of the cover letter
 * @param {string} selectedTemplateName - Name of the CV template used (for logging)
 * @param {Object} [jobFiles]           - Pre-generated job files from sidepanel context
 * @param {string} [jobFiles.jsonContent]  - Serialised job JSON
 * @param {string} [jobFiles.htmlContent]  - Job summary HTML
 * @param {string} [jobFiles.pdfBase64]    - Job summary PDF as base64 string
 * @returns {Promise<{ submittedFolderId: string }>}
 */
async function savePreparedPackage(accessToken, job, cvData, clData, selectedTemplateName, jobFiles = {}) {
  // ── 1. Resolve status folder IDs ─────────────────────────────────────────
  const prepFolderId = await getStorageValue(STORAGE_KEYS.PREPARATION_FOLDER_ID);
  const subFolderId  = await getStorageValue(STORAGE_KEYS.SUBMITTED_FOLDER_ID);
  if (!subFolderId) throw new Error('Submitted folder ID not found in storage.');

  const jobFolderName = sanitiseFolderName(job.company || '', job.jobTitle || 'Job', job);

  // ── 2. Create job subfolder in Submitted ─────────────────────────────────
  const { id: submittedJobFolderId } = await getOrCreateNamedFolder(accessToken, jobFolderName, subFolderId);

  // ── 3. If a Preparation subfolder exists, move its files then delete it ──
  if (prepFolderId) {
    try {
      const prepJobFolderId = await findFolderByName(accessToken, prepFolderId, jobFolderName);
      if (prepJobFolderId) {
        await copyFolderContents(accessToken, prepJobFolderId, submittedJobFolderId);
        await deleteFolderAndContents(accessToken, prepJobFolderId);
      }
    } catch (err) {
      console.warn('[JobLink] Could not move Preparation folder:', err.message);
    }
  }

  // ── 4. Save job files directly to Submitted ───────────────────────────────
  try {
    if (jobFiles.jsonContent) {
      await uploadTextFile(accessToken, submittedJobFolderId, 'job_info.json', jobFiles.jsonContent, 'application/json');
    }
  } catch (err) { console.warn('[JobLink] Could not save JSON:', err.message); }

  try {
    if (jobFiles.htmlContent) {
      await uploadTextFile(accessToken, submittedJobFolderId, 'job_summary.html', jobFiles.htmlContent, 'text/html');
    }
  } catch (err) { console.warn('[JobLink] Could not save HTML:', err.message); }

  try {
    if (jobFiles.pdfBase64) {
      await uploadBase64File(accessToken, submittedJobFolderId, 'job_summary.pdf', jobFiles.pdfBase64, 'application/pdf');
    }
  } catch (err) { console.warn('[JobLink] Could not save PDF:', err.message); }

  // ── 5. Save tailored CV as Google Doc (Docs API in-place tailoring) + PDF ─
  const cvTitle = `CV - ${job.jobTitle || 'Application'} (${job.company || 'Company'})`;
  if (cvData.templateDocId || cvData.html || (cvData.newSummary || (cvData.newBullets && cvData.newBullets.length > 0))) {
    let cvDocId;
    if (cvData.templateDocId && cvData.templateDocId !== 'default-cv') {
      cvDocId = await tailorCVWithDocsAPI(
        accessToken,
        cvData.templateDocId,
        submittedJobFolderId,
        cvTitle,
        cvData.newSummary,
        cvData.newBullets
      );
    } else {
      const cvHtml = cvData.html || `<p>${cvData.newSummary}</p><ul><li>${cvData.newBullets.join('</li><li>')}</li></ul>`;
      cvDocId = await createGoogleDoc(accessToken, submittedJobFolderId, cvTitle, wrapHtmlDocument(cvTitle, cvHtml));
    }
    await exportDocAsPDF(accessToken, cvDocId, submittedJobFolderId, cvTitle);
  }

  // ── 6. Save cover letter as Google Doc (Docs API in-place tailoring) + PDF ─
  const clTitle = `Cover Letter - ${job.jobTitle || 'Application'} (${job.company || 'Company'})`;
  if (clData.templateDocId || clData.html || (clData.bodyParagraphs && clData.bodyParagraphs.length > 0)) {
    let clDocId;
    if (clData.templateDocId && clData.templateDocId !== 'default-cl') {
        clDocId = await tailorCLWithDocsAPI(
        accessToken,
        clData.templateDocId,
        submittedJobFolderId,
        clTitle,
        clData.companyBlock || {},
        clData.bodyParagraphs || []
      );
    } else if (clData.html) {
      clDocId = await createGoogleDoc(accessToken, submittedJobFolderId, clTitle, wrapHtmlDocument(clTitle, clData.html));
    } else {
      // Fallback for default CL with no HTML
      const fallbackHtml = (clData.bodyParagraphs || []).map(p => `<p>${p}</p>`).join('');
      clDocId = await createGoogleDoc(accessToken, submittedJobFolderId, clTitle, wrapHtmlDocument(clTitle, fallbackHtml));
    }
    if (clDocId) {
        await exportDocAsPDF(accessToken, clDocId, submittedJobFolderId, clTitle);
    }
  }

  return { submittedFolderId: submittedJobFolderId };
}

/**
 * Tailor a CV template in-place using the Docs API batchUpdate.
 * Copies the template Doc, then replaces only the Professional Summary
 * paragraph and the most recent role's bullet points.
 *
 * @param {string} accessToken
 * @param {string} templateDocId   - Google Doc ID of the chosen CV template
 * @param {string} parentFolderId  - Folder to save the copy in
 * @param {string} title           - Title for the copied Doc
 * @param {string} newSummary      - Replacement Professional Summary text (plain)
 * @param {string[]} newBullets    - Array of replacement bullet strings for Director role (plain)
 * @returns {Promise<string>} ID of the tailored copy
 */
async function tailorCVWithDocsAPI(accessToken, templateDocId, parentFolderId, title, newSummary, newBullets) {
  // ── 1. Copy the template into the target folder ───────────────────────────
  const copyRes = await fetch(
    `${DRIVE_API_BASE}/files/${templateDocId}/copy?fields=id`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: title, parents: [parentFolderId] }),
    }
  );
  if (!copyRes.ok) {
    const err = await copyRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to copy template: ${copyRes.status}`);
  }
  const { id: copiedDocId } = await copyRes.json();

  // ── 2. Read the copied document to find exact paragraph text ─────────────
  const docRes = await fetch(
    `https://docs.googleapis.com/v1/documents/${copiedDocId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!docRes.ok) {
    const err = await docRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to read copied doc: ${docRes.status}`);
  }
  const doc = await docRes.json();

  // ── 3. Helper: extract plain text from a paragraph element ───────────────
  function getParagraphText(paragraph) {
    return (paragraph.elements || [])
      .map(e => e.textRun?.content || '')
      .join('')
      .replace(/\n$/, '');
  }

  // ── 4. Build replaceAllText requests ─────────────────────────────────────
  const requests = [];
  const body = doc.body.content;

  // Find Professional Summary: the first non-empty paragraph after "PROFESSIONAL SUMMARY"
  let foundSummaryHeading = false;
  let summaryText = null;
  for (const block of body) {
    if (!block.paragraph) continue;
    const text = getParagraphText(block.paragraph);
    if (text.includes('PROFESSIONAL SUMMARY')) {
      foundSummaryHeading = true;
      continue;
    }
    if (foundSummaryHeading && text.trim().length > 20) {
      summaryText = text;
      break;
    }
  }
  if (summaryText) {
    requests.push({
      replaceAllText: {
        containsText: { text: summaryText, matchCase: true },
        replaceText: newSummary,
      },
    });
  }

  // Find Director role bullets: list items after "Director of Bioimaging" paragraph
  let foundDirectorRole = false;
  let bulletCount = 0;
  const originalBullets = [];
  for (const block of body) {
    if (!block.paragraph) continue;
    const text = getParagraphText(block.paragraph);
    if (text.includes('Director of Bioimaging')) {
      foundDirectorRole = true;
      continue;
    }
    if (foundDirectorRole) {
      if (block.paragraph.bullet && text.trim().length > 0) {
        originalBullets.push(text);
        bulletCount++;
        if (bulletCount >= 4) break;
      } else if (!block.paragraph.bullet && text.trim().length > 0) {
        break; // hit next section heading
      }
    }
  }

  const bulletReplaceCount = Math.min(originalBullets.length, newBullets.length);
  for (let i = 0; i < bulletReplaceCount; i++) {
    if (originalBullets[i] && newBullets[i] && originalBullets[i] !== newBullets[i]) {
      requests.push({
        replaceAllText: {
          containsText: { text: originalBullets[i], matchCase: true },
          replaceText: newBullets[i],
        },
      });
    }
  }

  // ── 5. Apply all replacements in one batchUpdate ─────────────────────────
  if (requests.length === 0) {
    console.warn('[JobLink] No replacements found — returning unmodified copy');
    return copiedDocId;
  }

  const batchRes = await fetch(
    `https://docs.googleapis.com/v1/documents/${copiedDocId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    }
  );
  if (!batchRes.ok) {
    const err = await batchRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `batchUpdate failed: ${batchRes.status}`);
  }

  console.log(`[JobLink] CV tailored: ${requests.length} replacements applied to doc ${copiedDocId}`);
  return copiedDocId;
}

/**
 * Tailor a cover letter template using a hybrid approach:
 * - replaceAllText to fill {{COMPANY_NAME}}, {{DEPARTMENT}}, {{LOCATION}} placeholders
 * - insertText in reverse order to add body paragraphs before "Sincerely,"
 *
 * @param {string} accessToken
 * @param {string} templateDocId    - Google Doc ID of the CL template
 * @param {string} parentFolderId   - Folder to save the copy in
 * @param {string} title            - Title for the copied Doc
 * @param {Object} companyBlock     - { name, department, location }
 * @param {string[]} bodyParagraphs - Paragraph strings to insert as the letter body
 * @returns {Promise<string>} ID of the tailored copy
 */
async function tailorCLWithDocsAPI(accessToken, templateDocId, parentFolderId, title, companyBlock, bodyParagraphs) {
  // ── 1. Copy the template into the target folder ───────────────────────────
  const copyRes = await fetch(
    `${DRIVE_API_BASE}/files/${templateDocId}/copy?fields=id`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: title, parents: [parentFolderId] }),
    }
  );
  if (!copyRes.ok) {
    const err = await copyRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to copy CL template: ${copyRes.status}`);
  }
  const { id: copiedDocId } = await copyRes.json();

  // ── 2. Replace {{COMPANY_NAME}}, {{DEPARTMENT}}, {{LOCATION}}, date placeholders ─
  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const replaceRequests = [
    {
      replaceAllText: {
        containsText: { text: '{{COMPANY_NAME}}', matchCase: false },
        replaceText: companyBlock.name || '',
      },
    },
    {
      replaceAllText: {
        containsText: { text: '{{DEPARTMENT}}', matchCase: false },
        replaceText: companyBlock.department || '',
      },
    },
    {
      replaceAllText: {
        containsText: { text: '{{LOCATION}}', matchCase: false },
        replaceText: companyBlock.location || '',
      },
    },
    {
      replaceAllText: {
        containsText: { text: 'January 29, 2026', matchCase: false },
        replaceText: todayStr,
      },
    },
  ];

  const replaceRes = await fetch(
    `https://docs.googleapis.com/v1/documents/${copiedDocId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests: replaceRequests }),
    }
  );
  if (!replaceRes.ok) {
    const err = await replaceRes.json().catch(() => ({}));
    console.warn('[JobLink] CL placeholder replace failed:', err.error?.message || replaceRes.status);
  }

  // ── 3. Skip body insertion if no paragraphs provided ─────────────────────
  if (!bodyParagraphs || bodyParagraphs.length === 0) {
    console.warn('[JobLink] No CL body paragraphs — returning copy with placeholders replaced');
    return copiedDocId;
  }

  // ── 4. Read the doc to find the start index of "Sincerely," ──────────────
  const docRes = await fetch(
    `https://docs.googleapis.com/v1/documents/${copiedDocId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!docRes.ok) {
    const err = await docRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to read copied CL doc: ${docRes.status}`);
  }
  const doc = await docRes.json();

  let sincerelyStartIndex = null;
  for (const el of doc.body.content) {
    if (!el.paragraph) continue;
    const text = (el.paragraph.elements || [])
      .map(e => e.textRun?.content || '')
      .join('')
      .replace(/\n$/, '');
    if (text.trim().startsWith('Sincerely')) {
      sincerelyStartIndex = el.startIndex;
      break;
    }
  }

  if (sincerelyStartIndex === null) {
    console.warn('[JobLink] Could not find "Sincerely," paragraph — returning copy with placeholders replaced');
    return copiedDocId;
  }

  // ── 5. Insert body paragraphs in reverse order before "Sincerely," ────────
  // Inserting in reverse at the same index causes each new paragraph to be
  // prepended before the previously inserted text, yielding correct final order.
  const insertRequests = [...bodyParagraphs].reverse().map(para => ({
    insertText: {
      location: { index: sincerelyStartIndex },
      text: para + '\n',
    },
  }));

  const insertRes = await fetch(
    `https://docs.googleapis.com/v1/documents/${copiedDocId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests: insertRequests }),
    }
  );
  if (!insertRes.ok) {
    const err = await insertRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `CL insertText batchUpdate failed: ${insertRes.status}`);
  }

  console.log(`[JobLink] CL tailored: ${bodyParagraphs.length} paragraphs inserted before "Sincerely," in doc ${copiedDocId}`);
  return copiedDocId;
}

/**
 * Save a plain-text academic statement as a Google Doc + PDF in the given folder.
 *
 * @param {string} accessToken
 * @param {string} folderId      - Drive folder to save into
 * @param {string} title         - Document title (used as Doc name and PDF name)
 * @param {string} text          - Plain text content (double newlines = paragraph breaks)
 * @returns {Promise<string>} Google Doc ID of the created document
 */
async function saveAcademicDocToDrive(accessToken, folderId, title, text) {
  const paragraphs = text
    .split(/\n\n+/)
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  const htmlContent = wrapHtmlDocument(title, paragraphs);
  const docId = await createGoogleDoc(accessToken, folderId, title, htmlContent);
  await exportDocAsPDF(accessToken, docId, folderId, title);
  return docId;
}
