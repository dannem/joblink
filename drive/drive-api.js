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

/**
 * Read CV template Google Docs from the My_Profile folder.
 * Returns an array of { name, text, id } objects for files whose names
 * contain "CV", "cv", or "template" (case-insensitive).
 * Falls back to returning ALL Google Docs if no CV-specific files are found.
 *
 * @param {string} accessToken  - OAuth access token
 * @param {string} rootFolderId - The JobLink root folder ID
 * @returns {Promise<Array<{name: string, text: string, id: string}>>}
 * @throws {Error} If My_Profile folder is not found
 */
async function readCVTemplatesFromDrive(accessToken, rootFolderId) {
  // Find My_Profile folder
  const folderQuery = encodeURIComponent(
    `'${rootFolderId}' in parents and name = 'My_Profile' ` +
    `and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const folderRes = await fetch(
    `${DRIVE_API_BASE}/files?q=${folderQuery}&fields=files(id)&pageSize=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!folderRes.ok) throw new Error('Could not find My_Profile folder');
  const folderData = await folderRes.json();
  const profileFolderId = folderData.files?.[0]?.id;
  if (!profileFolderId) throw new Error('My_Profile folder not found');

  // List Google Docs in My_Profile
  const filesQuery = encodeURIComponent(
    `'${profileFolderId}' in parents and trashed = false ` +
    `and mimeType = 'application/vnd.google-apps.document'`
  );
  const filesRes = await fetch(
    `${DRIVE_API_BASE}/files?q=${filesQuery}&fields=files(id,name)&pageSize=20`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!filesRes.ok) throw new Error('Could not list My_Profile files');
  const filesData = await filesRes.json();
  const allDocs = filesData.files || [];

  // Filter to CV/template files; fall back to all docs if none match
  const cvDocs    = allDocs.filter(f => /cv|template/i.test(f.name));
  const docsToRead = cvDocs.length > 0 ? cvDocs : allDocs;

  // Export each as plain text — cap at 3 to avoid excessive API calls
  const results = [];
  for (const doc of docsToRead.slice(0, 3)) {
    const exportRes = await fetch(
      `${DRIVE_API_BASE}/files/${doc.id}/export?mimeType=text%2Fplain`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (exportRes.ok) {
      const text = await exportRes.text();
      if (text.trim()) results.push({ id: doc.id, name: doc.name, text: text.trim() });
    }
  }
  return results;
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

  console.log('[JobLink] Searching for duplicate folder:', folderName, 'in prepId:', prepId, 'subId:', subId, 'rejId:', rejId);

  /**
   * Search a single parent folder for a child folder matching folderName.
   * Returns the matching folder object, or null if not found or parentId is empty.
   */
  async function searchInFolder(parentId) {
    if (!parentId) return null;
    const safeName = folderName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const query = encodeURIComponent(
      `'${parentId}' in parents and name = '${safeName}' ` +
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
 * Create a new Google Doc with plain-text content inside a Drive folder.
 * Uses the Drive multipart upload API — no Docs API required.
 *
 * @param {string} accessToken
 * @param {string} parentFolderId
 * @param {string} title       - Document title
 * @param {string} plainText   - Document body content
 * @returns {Promise<string>}  ID of the created Google Doc
 */
async function createGoogleDoc(accessToken, parentFolderId, title, plainText) {
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
    'Content-Type: text/plain; charset=UTF-8',
    '',
    plainText,
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
 * Save a prepared application package to the Submitted folder.
 *
 * Steps:
 *  1. Resolve status folder IDs from storage
 *  2. Find the existing Preparation job subfolder
 *  3. Create the job subfolder in Submitted
 *  4. Copy all files from Preparation → Submitted, then delete the Preparation subfolder
 *  5. Create the tailored CV as a Google Doc in Submitted
 *  6. Export the CV Doc as PDF and upload to Submitted
 *  7. Create the cover letter as a Google Doc in Submitted
 *  8. Export the cover letter Doc as PDF and upload to Submitted
 *
 * @param {string} accessToken
 * @param {Object} job               - { jobTitle, company, ... }
 * @param {string} tailoredCVText    - Plain text of the tailored CV
 * @param {string} coverLetterText   - Plain text of the cover letter
 * @param {string} selectedTemplateName - Name of the CV template used (for logging)
 * @returns {Promise<{ submittedFolderId: string }>}
 */
async function savePreparedPackage(accessToken, job, tailoredCVText, coverLetterText, selectedTemplateName) {
  // ── 1. Resolve status folder IDs ─────────────────────────────────────────
  const prepFolderId = await getStorageValue(STORAGE_KEYS.PREPARATION_FOLDER_ID);
  const subFolderId  = await getStorageValue(STORAGE_KEYS.SUBMITTED_FOLDER_ID);
  if (!prepFolderId) throw new Error('Preparation folder ID not found in storage.');
  if (!subFolderId)  throw new Error('Submitted folder ID not found in storage.');

  const jobFolderName = sanitiseFolderName(job.company || '', job.jobTitle || 'Job');

  // ── 2. Find the existing Preparation job subfolder ───────────────────────
  const prepJobFolderId = await findFolderByName(accessToken, prepFolderId, jobFolderName);

  // ── 3. Create job subfolder in Submitted ─────────────────────────────────
  const { id: submittedJobFolderId } = await getOrCreateNamedFolder(accessToken, jobFolderName, subFolderId);

  // ── 4. Copy files from Preparation → Submitted, then remove Prep folder ──
  if (prepJobFolderId) {
    await copyFolderContents(accessToken, prepJobFolderId, submittedJobFolderId);
    await deleteFolderAndContents(accessToken, prepJobFolderId);
  }

  // ── 5. Save tailored CV as Google Doc ────────────────────────────────────
  const cvTitle = `CV - ${job.jobTitle || 'Application'} (${job.company || 'Company'})`;
  const cvDocId = await createGoogleDoc(accessToken, submittedJobFolderId, cvTitle, tailoredCVText);

  // ── 6. Export CV as PDF and upload ───────────────────────────────────────
  await exportDocAsPDF(accessToken, cvDocId, submittedJobFolderId, cvTitle);

  // ── 7. Save cover letter as Google Doc ───────────────────────────────────
  const clTitle = `Cover Letter - ${job.jobTitle || 'Application'} (${job.company || 'Company'})`;
  const clDocId = await createGoogleDoc(accessToken, submittedJobFolderId, clTitle, coverLetterText);

  // ── 8. Export cover letter as PDF and upload ─────────────────────────────
  await exportDocAsPDF(accessToken, clDocId, submittedJobFolderId, clTitle);

  return { submittedFolderId: submittedJobFolderId };
}
