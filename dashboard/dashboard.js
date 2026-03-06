/**
 * Dashboard logic for JobLink.
 *
 * Loads jobs from the three Drive status folders (Preparation / Submitted /
 * Rejected), renders them in expandable tables, and allows moving jobs
 * between folders.
 *
 * Depends on: utils/helpers.js (STORAGE_KEYS, getStorageValue)
 */

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

// ── State ──────────────────────────────────────────────────────

let authToken = null;

/** Map of status key → Drive folder ID, populated on load. */
const folderIds = {
  preparation: null,
  submitted:   null,
  rejected:    null,
};

/** Map of status key → Array of job objects loaded from Drive. */
const jobsByStatus = {
  preparation: [],
  submitted:   [],
  rejected:    [],
};

/** Current filter state — persists across loadDashboard() calls (e.g. after a move). */
const filters = {
  keyword:  '',
  status:   'all',
  type:     'all',
  location: 'all',
  company:  'all',
};

// ── Entry point ───────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Wire collapsible section toggles
  document.querySelectorAll('.section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const body = document.getElementById(targetId);
      const collapsed = body.classList.toggle('hidden');
      btn.classList.toggle('collapsed', collapsed);
    });
  });

  // Wire filter controls
  document.getElementById('filter-keyword').addEventListener('input', e => {
    filters.keyword = e.target.value;
    applyFilters();
  });
  document.getElementById('filter-status').addEventListener('change', e => {
    filters.status = e.target.value;
    applyFilters();
  });
  document.getElementById('filter-type').addEventListener('change', e => {
    filters.type = e.target.value;
    applyFilters();
  });
  document.getElementById('filter-location').addEventListener('change', e => {
    filters.location = e.target.value;
    applyFilters();
  });
  document.getElementById('filter-company').addEventListener('change', e => {
    filters.company = e.target.value;
    applyFilters();
  });
  document.getElementById('filter-clear').addEventListener('click', () => {
    filters.keyword  = '';
    filters.status   = 'all';
    filters.type     = 'all';
    filters.location = 'all';
    filters.company  = 'all';
    document.getElementById('filter-keyword').value  = '';
    document.getElementById('filter-status').value   = 'all';
    document.getElementById('filter-type').value     = 'all';
    document.getElementById('filter-location').value = 'all';
    document.getElementById('filter-company').value  = 'all';
    applyFilters();
  });

  await loadDashboard();
});

async function loadDashboard() {
  showLoading(true);
  showError('');

  try {
    authToken = await getAuthToken();

    // Read folder IDs from storage
    const [rootId, prepId, subId, rejId] = await Promise.all([
      getStorageValue(STORAGE_KEYS.DRIVE_ROOT_FOLDER_ID),
      getStorageValue(STORAGE_KEYS.PREPARATION_FOLDER_ID),
      getStorageValue(STORAGE_KEYS.SUBMITTED_FOLDER_ID),
      getStorageValue(STORAGE_KEYS.REJECTED_FOLDER_ID),
    ]);

    if (!rootId) {
      showError('No Drive root folder configured. Open Settings to set one up.');
      showLoading(false);
      return;
    }

    folderIds.preparation = prepId || null;
    folderIds.submitted   = subId  || null;
    folderIds.rejected    = rejId  || null;

    // Load jobs from all three folders in parallel
    const [prepJobs, subJobs, rejJobs] = await Promise.all([
      loadJobsFromFolder(prepId),
      loadJobsFromFolder(subId),
      loadJobsFromFolder(rejId),
    ]);

    jobsByStatus.preparation = prepJobs;
    jobsByStatus.submitted   = subJobs;
    jobsByStatus.rejected    = rejJobs;

    // Update statistics
    document.getElementById('count-preparation').textContent = prepJobs.length;
    document.getElementById('count-submitted').textContent   = subJobs.length;
    document.getElementById('count-rejected').textContent    = rejJobs.length;

    // Render tables
    renderSection('preparation', prepJobs);
    renderSection('submitted',   subJobs);
    renderSection('rejected',    rejJobs);

    // Populate dynamic filter dropdowns and re-apply any active filters
    populateFilterDropdowns();
    applyFilters();

    // Classify job types asynchronously (non-blocking)
    classifyAllJobs();

  } catch (err) {
    showError('Failed to load dashboard: ' + err.message);
    console.error('[JobLink Dashboard]', err);
  } finally {
    showLoading(false);
  }
}

// ── Drive data loading ─────────────────────────────────────────

/**
 * List job subfolders in a status folder and read job_info.json from each.
 * Returns empty array if folderId is falsy.
 *
 * @param {string|null} folderId
 * @returns {Promise<Array>}
 */
async function loadJobsFromFolder(folderId) {
  if (!folderId) return [];

  const subfolders = await listSubfolders(folderId);
  const jobs = await Promise.all(subfolders.map(folder => readJobFromFolder(folder)));
  return jobs.filter(Boolean);
}

/**
 * List immediate subfolders of a Drive folder.
 *
 * @param {string} folderId
 * @returns {Promise<Array<{id, name}>>}
 */
async function listSubfolders(folderId) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id,name)',
    pageSize: '200',
    orderBy: 'createdTime desc',
  });
  const res = await driveGet(`${DRIVE_API}/files?${params}`);
  return res.files || [];
}

/**
 * List all files inside a job subfolder.
 *
 * @param {string} folderId
 * @returns {Promise<Array<{id, name}>>}
 */
async function listFilesInFolder(folderId) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name)',
    pageSize: '20',
  });
  const res = await driveGet(`${DRIVE_API}/files?${params}`);
  return res.files || [];
}

/**
 * Read job_info.json from a job subfolder and return an enriched job object.
 * Returns null if job_info.json is not found.
 *
 * @param {{id, name}} folder
 * @returns {Promise<Object|null>}
 */
async function readJobFromFolder(folder) {
  try {
    const files = await listFilesInFolder(folder.id);
    const jsonFile = files.find(f => f.name === 'job_info.json');
    if (!jsonFile) return null;

    const res = await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(jsonFile.id)}?alt=media`,
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    if (!res.ok) return null;

    const job = await res.json();
    return {
      ...job,
      salary:   extractSalary(job.description || ''),
      folderId: folder.id,
      fileId:   jsonFile.id,
    };
  } catch (err) {
    console.warn('[JobLink Dashboard] Could not read job from folder', folder.id, err.message);
    return null;
  }
}

// ── Salary extraction ──────────────────────────────────────────

/**
 * Extract the first salary-like string from a job description.
 * Looks for patterns like $169,400-$222,400 or $100K or salary mentions.
 *
 * @param {string} description
 * @returns {string}
 */
function extractSalary(description) {
  if (!description) return '';

  // Range: $169,400-$222,400 or $100K - $150K
  const rangeMatch = description.match(/\$[\d,]+(?:K)?[\s\u2013\u2014\-]+\$[\d,]+(?:K)?/i);
  if (rangeMatch) return rangeMatch[0].replace(/\s+/g, ' ').trim();

  // Single value near "salary" keyword
  const salaryMatch = description.match(/(?:salary|compensation)[^\n$]{0,40}(\$[\d,]+(?:K)?)/i);
  if (salaryMatch) return salaryMatch[1];

  // Annual base salary pattern (common in job postings)
  const annualMatch = description.match(/annual base salary[^\n$]{0,20}(\$[\d,]+)/i);
  if (annualMatch) return annualMatch[1];

  return '';
}

// ── Table rendering ────────────────────────────────────────────

const STATUS_LABELS = {
  preparation: 'Preparation',
  submitted:   'Submitted',
  rejected:    'Rejected',
};

/**
 * Render all jobs for a status section into its tbody.
 *
 * @param {'preparation'|'submitted'|'rejected'} status
 * @param {Array} jobs
 */
function renderSection(status, jobs) {
  const tbody = document.getElementById(`tbody-${status}`);
  if (!tbody) return;
  tbody.innerHTML = '';

  if (jobs.length === 0) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    tr.innerHTML = `<td colspan="8">No jobs in this folder.</td>`;
    tbody.appendChild(tr);
    return;
  }

  const otherStatuses = Object.keys(STATUS_LABELS).filter(s => s !== status);

  jobs.forEach(job => {
    const tr = buildJobRow(job, status, otherStatuses);
    tbody.appendChild(tr);
  });
}

/**
 * Build a <tr> element for one job.
 *
 * @param {Object} job
 * @param {string} currentStatus
 * @param {string[]} otherStatuses
 * @returns {HTMLTableRowElement}
 */
function buildJobRow(job, currentStatus, otherStatuses) {
  const tr = document.createElement('tr');
  tr.dataset.folderId = job.folderId;

  const dateStr = job.scrapedAt
    ? new Date(job.scrapedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  const salary    = job.salary || '';
  const typeValue = job.jobType || '';
  const driveUrl  = `https://drive.google.com/drive/folders/${job.folderId}`;

  // Build Move To options
  const moveOptions = otherStatuses.map(s =>
    `<option value="${s}">${STATUS_LABELS[s]}</option>`
  ).join('');

  tr.innerHTML = `
    <td class="cell-position" title="${escHtml(job.jobTitle || '')}">${escHtml(truncate(job.jobTitle || '—', 50))}</td>
    <td>${escHtml(job.company || '—')}</td>
    <td>${escHtml(job.location || '—')}</td>
    <td>${dateStr}</td>
    <td class="cell-salary${salary ? '' : ' empty'}">${escHtml(salary) || '—'}</td>
    <td class="cell-type" data-folder-id="${job.folderId}" data-file-id="${job.fileId}">
      ${typeValue ? typeBadgeHtml(typeValue) : '<span class="type-badge type-badge--loading">…</span>'}
    </td>
    <td><a class="drive-link" href="${driveUrl}" target="_blank" rel="noopener">📁 Open</a></td>
    <td>
      <div class="move-cell">
        <select class="move-select" data-folder-id="${job.folderId}" data-current-status="${currentStatus}">
          ${moveOptions}
        </select>
        <button class="move-btn" data-folder-id="${job.folderId}" data-current-status="${currentStatus}">Move</button>
      </div>
    </td>
  `;

  // Wire Move button
  tr.querySelector('.move-btn').addEventListener('click', handleMove);

  return tr;
}

function typeBadgeHtml(type) {
  const safe = escHtml(type.toLowerCase());
  return `<span class="type-badge type-badge--${safe}">${safe}</span>`;
}

// ── AI classification ──────────────────────────────────────────

/**
 * Classify all unclassified jobs asynchronously, updating the UI and
 * persisting the result back to job_info.json in Drive.
 */
async function classifyAllJobs() {
  const allJobs = [
    ...jobsByStatus.preparation,
    ...jobsByStatus.submitted,
    ...jobsByStatus.rejected,
  ];

  for (const job of allJobs) {
    if (job.jobType) continue; // Already classified — skip

    try {
      const result = await classifyJobType(job);
      job.jobType = result;

      // Update the type badge in the table
      const cell = document.querySelector(`.cell-type[data-folder-id="${job.folderId}"]`);
      if (cell) cell.innerHTML = typeBadgeHtml(result);
      // Re-apply filters now that this job's type is known
      applyFilters();

      // Persist the classification back to Drive (non-blocking on failure)
      await updateJobTypeInDrive(job).catch(err =>
        console.warn('[JobLink Dashboard] Could not persist jobType:', err.message)
      );
    } catch (err) {
      console.warn('[JobLink Dashboard] Classification failed for', job.jobTitle, err.message);
    }
  }
}

/**
 * Ask the service worker to classify this job via callAI.
 *
 * @param {Object} job
 * @returns {Promise<string>} category string
 */
function classifyJobType(job) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'CLASSIFY_JOB', jobTitle: job.jobTitle || '', description: job.description || '' },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve('other');
          return;
        }
        resolve(response?.result || 'other');
      }
    );
  });
}

/**
 * Re-upload job_info.json with the jobType field added.
 *
 * @param {Object} job - Must have fileId and jobType
 */
async function updateJobTypeInDrive(job) {
  const updated = { ...job, salary: undefined, folderId: undefined, fileId: undefined };
  // Clean up dashboard-only fields before saving
  delete updated.salary;
  delete updated.folderId;
  delete updated.fileId;
  updated.jobType = job.jobType;

  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(job.fileId)}?uploadType=media`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updated, null, 2),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Upload failed: ${res.status}`);
  }
}

// ── Move job ───────────────────────────────────────────────────

/**
 * Handle a Move button click — move the job folder to the selected target
 * status folder and refresh the dashboard.
 *
 * @param {Event} e
 */
async function handleMove(e) {
  const btn = e.currentTarget;
  const { folderId, currentStatus } = btn.dataset;
  const select = btn.closest('.move-cell').querySelector('.move-select');
  const targetStatus = select.value;

  if (!targetStatus || targetStatus === currentStatus) return;

  const fromParentId = folderIds[currentStatus];
  const toParentId   = folderIds[targetStatus];

  if (!fromParentId || !toParentId) {
    showError(`Cannot move: ${targetStatus} folder ID not found in storage.`);
    return;
  }

  btn.disabled = true;
  btn.textContent = '…';

  try {
    await moveDriveFolder(folderId, fromParentId, toParentId);
    // Refresh to reflect the move
    await loadDashboard();
  } catch (err) {
    showError('Move failed: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Move';
  }
}

/**
 * Move a Drive folder from one parent to another using the Files PATCH API.
 *
 * @param {string} folderId
 * @param {string} removeParentId
 * @param {string} addParentId
 */
async function moveDriveFolder(folderId, removeParentId, addParentId) {
  const params = new URLSearchParams({
    addParents:    addParentId,
    removeParents: removeParentId,
    fields:        'id,parents',
  });
  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(folderId)}?${params}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}` },
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Move failed: ${res.status}`);
  }
}

// ── Filtering ─────────────────────────────────────────────────

/**
 * Populate the Location and Company dropdowns from current job data.
 * Preserves the selected value if it still exists after a refresh.
 *
 * @param {string} folderId
 * @returns {Object|null}
 */
function findJobByFolderId(folderId) {
  for (const status of ['preparation', 'submitted', 'rejected']) {
    const found = jobsByStatus[status].find(j => j.folderId === folderId);
    if (found) return found;
  }
  return null;
}

/**
 * Fill a <select> with a list of string values, preserving the current selection.
 *
 * @param {string} id         - Element id of the <select>
 * @param {string[]} values   - Sorted unique values to add as options
 * @param {string} currentVal - Currently selected value (to re-select after repopulate)
 */
function populateDropdown(id, values, currentVal) {
  const select = document.getElementById(id);
  if (!select) return;
  const allLabel = id === 'filter-location' ? 'All Locations' : 'All Companies';
  select.innerHTML = `<option value="all">${allLabel}</option>`;
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    if (v === currentVal) opt.selected = true;
    select.appendChild(opt);
  });
}

/**
 * Rebuild the Location and Company filter dropdowns from loaded job data.
 */
function populateFilterDropdowns() {
  const allJobs = [
    ...jobsByStatus.preparation,
    ...jobsByStatus.submitted,
    ...jobsByStatus.rejected,
  ];
  const locations = [...new Set(allJobs.map(j => j.location || '').filter(Boolean))].sort();
  const companies = [...new Set(allJobs.map(j => j.company  || '').filter(Boolean))].sort();
  populateDropdown('filter-location', locations, filters.location);
  populateDropdown('filter-company',  companies, filters.company);
}

/**
 * Read the current filter values and show/hide table rows accordingly.
 * A row is visible only when it matches ALL active filters.
 * Hides an entire section if no rows in it pass the filter.
 */
function applyFilters() {
  const keyword  = filters.keyword.toLowerCase().trim();
  const status   = filters.status;
  const type     = filters.type;
  const location = filters.location;
  const company  = filters.company;

  ['preparation', 'submitted', 'rejected'].forEach(sectionStatus => {
    const section = document.getElementById(`section-${sectionStatus}`);
    if (!section) return;

    // Status filter — hide the whole section if it doesn't match
    if (status !== 'all' && status !== sectionStatus) {
      section.style.display = 'none';
      return;
    }

    const tbody = document.getElementById(`tbody-${sectionStatus}`);
    if (!tbody) { section.style.display = ''; return; }

    // Remove any stale "no filter results" rows from a previous applyFilters call
    tbody.querySelectorAll('.filter-empty-row').forEach(r => r.remove());

    const dataRows = tbody.querySelectorAll('tr[data-folder-id]');
    let visibleCount = 0;

    dataRows.forEach(row => {
      const job = findJobByFolderId(row.dataset.folderId);
      if (!job) { row.style.display = ''; visibleCount++; return; }

      const matchesKeyword = !keyword ||
        (job.jobTitle  || '').toLowerCase().includes(keyword) ||
        (job.company   || '').toLowerCase().includes(keyword) ||
        (job.location  || '').toLowerCase().includes(keyword);

      const matchesType     = type     === 'all' || (job.jobType  || '').toLowerCase() === type;
      const matchesLocation = location === 'all' || (job.location || '') === location;
      const matchesCompany  = company  === 'all' || (job.company  || '') === company;

      const visible = matchesKeyword && matchesType && matchesLocation && matchesCompany;
      row.style.display = visible ? '' : 'none';
      if (visible) visibleCount++;
    });

    // If there are data rows but none are visible, show a "no matches" message
    if (dataRows.length > 0 && visibleCount === 0) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row filter-empty-row';
      tr.innerHTML = '<td colspan="8">No jobs match the current filters.</td>';
      tbody.appendChild(tr);
      // Keep the section visible so the user sees the "no matches" message
      section.style.display = '';
    } else {
      // Hide section entirely if no data rows exist and nothing matches
      section.style.display = (dataRows.length === 0 || visibleCount > 0) ? '' : 'none';
    }
  });
}

// ── Auth ───────────────────────────────────────────────────────

/**
 * Get a cached OAuth token (non-interactive).
 *
 * @returns {Promise<string>}
 */
function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}

// ── Drive fetch helper ─────────────────────────────────────────

/**
 * Authenticated GET to a Drive API URL, returning parsed JSON.
 *
 * @param {string} url
 * @returns {Promise<Object>}
 */
async function driveGet(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Drive request failed: ${res.status}`);
  }
  return res.json();
}

// ── UI helpers ─────────────────────────────────────────────────

function showLoading(visible) {
  document.getElementById('loading-banner').style.display = visible ? 'block' : 'none';
}

function showError(msg) {
  const el = document.getElementById('error-banner');
  if (msg) {
    el.textContent = msg;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}
