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

/** Current sort state for the job tables. */
const sortState = {
  column:    'date',
  direction: 'desc',
};

/** Folder ID of the job currently open in the detail panel, or null. */
let detailFolderId = null;

/** Map of status key → Set of selected job folder IDs for bulk actions. */
const selections = {
  preparation: new Set(),
  submitted:   new Set(),
  rejected:    new Set(),
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

  // Wire sortable column headers
  document.querySelectorAll('th[data-column]').forEach(th => {
    th.addEventListener('click', () => {
      const column = th.dataset.column;
      if (sortState.column === column) {
        sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.column    = column;
        sortState.direction = 'desc';
      }
      updateSortIndicators();
      ['preparation', 'submitted', 'rejected'].forEach(status => {
        clearSelection(status);
        renderSection(status, jobsByStatus[status]);
      });
      applyFilters();
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

  // Wire select-all checkboxes
  document.querySelectorAll('.select-all').forEach(cb => {
    cb.addEventListener('change', () => handleSelectAll(cb.dataset.status, cb.checked));
  });

  // Wire bulk action bar buttons
  document.querySelectorAll('.bulk-btn--move').forEach(btn => {
    btn.addEventListener('click', () => handleBulkMove(btn.dataset.status));
  });
  document.querySelectorAll('.bulk-btn--reject').forEach(btn => {
    btn.addEventListener('click', () => handleBulkReject(btn.dataset.status));
  });
  document.querySelectorAll('.bulk-btn--clear').forEach(btn => {
    btn.addEventListener('click', () => clearSelection(btn.dataset.status));
  });
  document.querySelectorAll('.bulk-btn--delete').forEach(btn => {
    btn.addEventListener('click', () => handleBulkDelete(btn.dataset.status));
  });

  // Wire detail panel
  document.getElementById('detail-close').addEventListener('click', closeDetailPanel);
  document.getElementById('job-detail-overlay').addEventListener('click', closeDetailPanel);
  document.getElementById('detail-save-notes').addEventListener('click', saveDetailNotes);
  document.getElementById('detail-move-btn').addEventListener('click', handleDetailMove);
  document.getElementById('detail-delete-btn').addEventListener('click', handleDetailDelete);

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
    updateSortIndicators();

    // Clear bulk selections — rows just re-rendered
    ['preparation', 'submitted', 'rejected'].forEach(s => {
      selections[s].clear();
      updateBulkBar(s);
    });

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
    fields: 'files(id,name,mimeType)',
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

// ── Sorting ────────────────────────────────────────────────────

/**
 * Sort a jobs array by the given column and direction.
 *
 * @param {Array}           jobs
 * @param {string}          column    - 'position'|'company'|'location'|'date'|'salary'|'type'
 * @param {'asc'|'desc'}    direction
 * @returns {Array}
 */
function sortJobs(jobs, column, direction) {
  const sorted = [...jobs];
  sorted.sort((a, b) => {
    let valA, valB;
    switch (column) {
      case 'position': valA = (a.jobTitle  || '').toLowerCase(); valB = (b.jobTitle  || '').toLowerCase(); break;
      case 'company':  valA = (a.company   || '').toLowerCase(); valB = (b.company   || '').toLowerCase(); break;
      case 'location': valA = (a.location  || '').toLowerCase(); valB = (b.location  || '').toLowerCase(); break;
      case 'date':     valA = a.scrapedAt  || '';                valB = b.scrapedAt  || '';                break;
      case 'salary':   valA = extractFirstNumber(a.salary || ''); valB = extractFirstNumber(b.salary || ''); break;
      case 'type':     valA = (a.jobType   || '').toLowerCase(); valB = (b.jobType   || '').toLowerCase(); break;
      default:         valA = ''; valB = '';
    }
    if (valA < valB) return direction === 'asc' ? -1 : 1;
    if (valA > valB) return direction === 'asc' ?  1 : -1;
    return 0;
  });
  return sorted;
}

/**
 * Extract the first numeric value from a salary string for numeric sorting.
 *
 * @param {string} salaryStr
 * @returns {number}
 */
function extractFirstNumber(salaryStr) {
  const match = salaryStr.replace(/,/g, '').match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

/**
 * Sync the ↕/↑/↓ indicators on all sortable column headers with sortState.
 */
function updateSortIndicators() {
  document.querySelectorAll('th[data-column]').forEach(th => {
    const indicator = th.querySelector('.sort-indicator');
    if (!indicator) return;
    const isActive = th.dataset.column === sortState.column;
    th.classList.toggle('sort-active', isActive);
    indicator.textContent = isActive
      ? (sortState.direction === 'asc' ? '↑' : '↓')
      : '↕';
  });
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
    tr.innerHTML = `<td colspan="9">No jobs in this folder.</td>`;
    tbody.appendChild(tr);
    return;
  }

  const sorted = sortJobs(jobs, sortState.column, sortState.direction);
  const otherStatuses = Object.keys(STATUS_LABELS).filter(s => s !== status);

  sorted.forEach(job => {
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
    <td class="col-checkbox"><input type="checkbox" class="row-checkbox"></td>
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
        <button class="delete-btn" data-folder-id="${job.folderId}" data-job-title="${escHtml(job.jobTitle || 'this job')}">Delete</button>
      </div>
    </td>
  `;

  // Wire row checkbox
  const rowCb = tr.querySelector('.row-checkbox');
  rowCb.addEventListener('change', () => handleRowCheckbox(currentStatus, job.folderId, rowCb.checked));

  // Wire Move button
  tr.querySelector('.move-btn').addEventListener('click', handleMove);
  tr.querySelector('.delete-btn').addEventListener('click', handleDelete);

  // Wire row click to open detail panel (ignore Move cell and checkbox cell)
  tr.addEventListener('click', (e) => {
    if (e.target.closest('.move-cell')) return;
    if (e.target.closest('.col-checkbox')) return;
    openDetailPanel(job.folderId);
  });

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

/**
 * Move a Drive folder to trash (recoverable from Drive trash).
 *
 * @param {string} folderId
 */
async function deleteDriveFolder(folderId) {
  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(folderId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trashed: true }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Delete failed: ${res.status}`);
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
      tr.innerHTML = '<td colspan="9">No jobs match the current filters.</td>';
      tbody.appendChild(tr);
      // Keep the section visible so the user sees the "no matches" message
      section.style.display = '';
    } else {
      // Hide section entirely if no data rows exist and nothing matches
      section.style.display = (dataRows.length === 0 || visibleCount > 0) ? '' : 'none';
    }
  });

  // Sync select-all state with newly visible/hidden rows
  ['preparation', 'submitted', 'rejected'].forEach(s => updateSelectAllState(s));
}

// ── Detail panel ───────────────────────────────────────────────

/**
 * Return the status key ('preparation'|'submitted'|'rejected') for a job folder.
 *
 * @param {string} folderId
 * @returns {string|null}
 */
function findJobStatus(folderId) {
  for (const status of ['preparation', 'submitted', 'rejected']) {
    if (jobsByStatus[status].some(j => j.folderId === folderId)) return status;
  }
  return null;
}

/**
 * Return the Drive file view URL for a file object.
 * Google Docs get an /edit URL; all other files get a /view URL.
 *
 * @param {{id: string, mimeType: string}} file
 * @returns {string}
 */
function fileViewUrl(file) {
  if (file.mimeType === 'application/vnd.google-apps.document') {
    return `https://docs.google.com/document/d/${file.id}/edit`;
  }
  return `https://drive.google.com/file/d/${file.id}/view`;
}

/**
 * Open the detail panel for the given job folder.
 *
 * @param {string} folderId
 */
async function openDetailPanel(folderId) {
  const job = findJobByFolderId(folderId);
  if (!job) return;

  const status = findJobStatus(folderId);
  detailFolderId = folderId;

  // Title
  document.getElementById('detail-title').textContent = job.jobTitle || '—';

  // Meta row
  const dateStr = job.scrapedAt
    ? new Date(job.scrapedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  document.getElementById('detail-meta').innerHTML = `
    <div class="detail-meta-item">
      <span class="detail-meta-label">Company</span>
      <span class="detail-meta-value">${escHtml(job.company || '—')}</span>
    </div>
    <div class="detail-meta-item">
      <span class="detail-meta-label">Location</span>
      <span class="detail-meta-value">${escHtml(job.location || '—')}</span>
    </div>
    <div class="detail-meta-item">
      <span class="detail-meta-label">Date Saved</span>
      <span class="detail-meta-value">${dateStr}</span>
    </div>
    ${job.salary ? `
    <div class="detail-meta-item">
      <span class="detail-meta-label">Salary</span>
      <span class="detail-meta-value salary">${escHtml(job.salary)}</span>
    </div>` : ''}
    ${job.jobType ? `
    <div class="detail-meta-item">
      <span class="detail-meta-label">Type</span>
      <span class="detail-meta-value">${typeBadgeHtml(job.jobType)}</span>
    </div>` : ''}
    ${status ? `
    <div class="detail-meta-item">
      <span class="detail-meta-label">Status</span>
      <span class="detail-meta-value">
        <span class="status-badge status-badge--${status}">${STATUS_LABELS[status]}</span>
      </span>
    </div>` : ''}
  `;

  // Move To dropdown — show all statuses except current
  const otherStatuses = Object.keys(STATUS_LABELS).filter(s => s !== status);
  document.getElementById('detail-move-select').innerHTML = otherStatuses
    .map(s => `<option value="${s}">${STATUS_LABELS[s]}</option>`)
    .join('');

  // Notes
  document.getElementById('detail-notes').value = job.notes || '';

  // Description
  document.getElementById('detail-description').textContent = job.description || '';

  // Files list — show loading placeholder, fetch async
  const filesList = document.getElementById('detail-files-list');
  filesList.innerHTML = '<span style="color:#9ca3af;font-size:0.83rem;">Loading…</span>';
  loadDetailFiles(folderId, filesList);

  // Show overlay and slide panel in
  const panel   = document.getElementById('job-detail-panel');
  const overlay = document.getElementById('job-detail-overlay');
  panel.classList.remove('hidden');
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.add('open'));
}

/**
 * Close the detail panel with a slide-out transition.
 */
function closeDetailPanel() {
  const panel   = document.getElementById('job-detail-panel');
  const overlay = document.getElementById('job-detail-overlay');
  panel.classList.remove('open');
  panel.addEventListener('transitionend', () => {
    panel.classList.add('hidden');
    overlay.classList.add('hidden');
  }, { once: true });
  detailFolderId = null;
}

/**
 * Fetch and render the list of documents in a job folder.
 * Excludes job_info.json (internal file).
 *
 * @param {string}      folderId
 * @param {HTMLElement} container
 */
async function loadDetailFiles(folderId, container) {
  try {
    const files = await listFilesInFolder(folderId);
    const docs  = files.filter(f => f.name !== 'job_info.json');
    if (docs.length === 0) {
      container.innerHTML = '<span style="color:#9ca3af;font-size:0.83rem;">No documents saved.</span>';
      return;
    }
    container.innerHTML = docs.map(f =>
      `<a class="detail-file-link" href="${fileViewUrl(f)}" target="_blank" rel="noopener">${escHtml(f.name)}</a>`
    ).join('');
  } catch (err) {
    container.innerHTML = '<span style="color:#b91c1c;font-size:0.83rem;">Could not load files.</span>';
    console.warn('[JobLink Dashboard] Could not load detail files:', err.message);
  }
}

/**
 * Save the notes textarea content back to job_info.json in Drive.
 */
async function saveDetailNotes() {
  const job = findJobByFolderId(detailFolderId);
  if (!job) return;

  const notes = document.getElementById('detail-notes').value;
  const btn   = document.getElementById('detail-save-notes');
  btn.disabled    = true;
  btn.textContent = 'Saving…';

  try {
    const updated = { ...job, notes };
    delete updated.salary;   // dashboard-only
    delete updated.folderId; // dashboard-only
    delete updated.fileId;   // dashboard-only

    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(job.fileId)}?uploadType=media`,
      {
        method: 'PATCH',
        headers: {
          Authorization:  `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updated, null, 2),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Upload failed: ${res.status}`);
    }

    // Persist in memory so re-opening the panel shows the saved value
    job.notes = notes;
    btn.textContent = 'Saved!';
    setTimeout(() => { btn.disabled = false; btn.textContent = 'Save Notes'; }, 1500);
  } catch (err) {
    btn.disabled    = false;
    btn.textContent = 'Save Notes';
    showError('Could not save notes: ' + err.message);
  }
}

/**
 * Move the currently open job to the selected status folder, then close and refresh.
 */
async function handleDetailMove() {
  const job = findJobByFolderId(detailFolderId);
  if (!job) return;

  const currentStatus = findJobStatus(detailFolderId);
  const targetStatus  = document.getElementById('detail-move-select').value;

  if (!targetStatus || targetStatus === currentStatus) return;

  const fromParentId = folderIds[currentStatus];
  const toParentId   = folderIds[targetStatus];

  if (!fromParentId || !toParentId) {
    showError(`Cannot move: ${targetStatus} folder ID not found in storage.`);
    return;
  }

  const btn = document.getElementById('detail-move-btn');
  btn.disabled    = true;
  btn.textContent = '…';

  try {
    await moveDriveFolder(detailFolderId, fromParentId, toParentId);
    closeDetailPanel();
    await loadDashboard();
  } catch (err) {
    showError('Move failed: ' + err.message);
    btn.disabled    = false;
    btn.textContent = 'Move';
  }
}

/**
 * Delete the currently open job (moves to Drive trash) and close the panel.
 */
async function handleDetailDelete() {
  const job = findJobByFolderId(detailFolderId);
  if (!job) return;

  const title = job.jobTitle || 'this job';
  if (!confirm(`Delete "${title}"?\n\nThe folder will be moved to your Google Drive trash and can be recovered from there.`)) return;

  const btn = document.getElementById('detail-delete-btn');
  btn.disabled    = true;
  btn.textContent = '…';

  try {
    await deleteDriveFolder(detailFolderId);
    closeDetailPanel();
    await loadDashboard();
  } catch (err) {
    showError('Delete failed: ' + err.message);
    btn.disabled    = false;
    btn.textContent = 'Delete';
  }
}

// ── Bulk actions ───────────────────────────────────────────────

/**
 * Select or deselect all visible rows in a section.
 *
 * @param {string}  status
 * @param {boolean} checked
 */
function handleSelectAll(status, checked) {
  const tbody = document.getElementById(`tbody-${status}`);
  tbody.querySelectorAll('tr[data-folder-id]').forEach(row => {
    if (row.style.display === 'none') return; // skip filtered-out rows
    const cb = row.querySelector('.row-checkbox');
    if (cb) cb.checked = checked;
    if (checked) {
      selections[status].add(row.dataset.folderId);
    } else {
      selections[status].delete(row.dataset.folderId);
    }
  });
  updateBulkBar(status);
}

/**
 * Handle a single row checkbox change.
 *
 * @param {string}  status
 * @param {string}  folderId
 * @param {boolean} checked
 */
function handleRowCheckbox(status, folderId, checked) {
  if (checked) {
    selections[status].add(folderId);
  } else {
    selections[status].delete(folderId);
  }
  updateSelectAllState(status);
  updateBulkBar(status);
}

/**
 * Sync the select-all checkbox to reflect whether all visible rows are checked.
 *
 * @param {string} status
 */
function updateSelectAllState(status) {
  const tbody = document.getElementById(`tbody-${status}`);
  if (!tbody) return;
  const visibleRows = [...tbody.querySelectorAll('tr[data-folder-id]')]
    .filter(r => r.style.display !== 'none');
  const allChecked = visibleRows.length > 0 &&
    visibleRows.every(r => { const cb = r.querySelector('.row-checkbox'); return cb && cb.checked; });
  const selectAll = document.querySelector(`.select-all[data-status="${status}"]`);
  if (selectAll) selectAll.checked = allChecked;
}

/**
 * Show or hide the bulk action bar based on how many items are selected.
 *
 * @param {string} status
 */
function updateBulkBar(status) {
  const count   = selections[status].size;
  const bar      = document.getElementById(`bulk-bar-${status}`);
  const countEl  = document.getElementById(`bulk-count-${status}`);
  if (countEl) countEl.textContent = `${count} selected`;
  if (bar) bar.classList.toggle('hidden', count === 0);
}

/**
 * Deselect all rows in a section and hide the bulk bar.
 *
 * @param {string} status
 */
function clearSelection(status) {
  selections[status].clear();
  const tbody = document.getElementById(`tbody-${status}`);
  if (tbody) tbody.querySelectorAll('.row-checkbox').forEach(cb => { cb.checked = false; });
  const selectAll = document.querySelector(`.select-all[data-status="${status}"]`);
  if (selectAll) selectAll.checked = false;
  updateBulkBar(status);
}

/**
 * Move all selected jobs in a section to the chosen target status folder.
 *
 * @param {string} status
 */
async function handleBulkMove(status) {
  const targetStatus = document.getElementById(`bulk-move-select-${status}`).value;
  if (!targetStatus || targetStatus === status) return;

  const fromParentId = folderIds[status];
  const toParentId   = folderIds[targetStatus];
  if (!fromParentId || !toParentId) {
    showError(`Cannot move: ${targetStatus} folder ID not found in storage.`);
    return;
  }

  const ids = [...selections[status]];
  if (ids.length === 0) return;

  const moveBtns = document.querySelectorAll(`.bulk-btn--move[data-status="${status}"]`);
  moveBtns.forEach(b => { b.disabled = true; b.textContent = '…'; });

  try {
    for (const folderId of ids) {
      await moveDriveFolder(folderId, fromParentId, toParentId);
    }
    clearSelection(status);
    await loadDashboard();
  } catch (err) {
    showError('Bulk move failed: ' + err.message);
    moveBtns.forEach(b => { b.disabled = false; b.textContent = 'Move'; });
  }
}

/**
 * Move all selected jobs in a section directly to the Rejected folder.
 *
 * @param {string} status
 */
async function handleBulkReject(status) {
  if (status === 'rejected') return;

  const fromParentId = folderIds[status];
  const toParentId   = folderIds.rejected;
  if (!fromParentId || !toParentId) {
    showError('Cannot reject: rejected folder ID not found in storage.');
    return;
  }

  const ids = [...selections[status]];
  if (ids.length === 0) return;

  const rejectBtns = document.querySelectorAll(`.bulk-btn--reject[data-status="${status}"]`);
  rejectBtns.forEach(b => { b.disabled = true; b.textContent = '…'; });

  try {
    for (const folderId of ids) {
      await moveDriveFolder(folderId, fromParentId, toParentId);
    }
    clearSelection(status);
    await loadDashboard();
  } catch (err) {
    showError('Bulk reject failed: ' + err.message);
    rejectBtns.forEach(b => { b.disabled = false; b.textContent = 'Reject'; });
  }
}

/**
 * Handle a Delete button click on an individual row.
 * Moves the job folder to Drive trash after user confirmation.
 *
 * @param {Event} e
 */
async function handleDelete(e) {
  const btn       = e.currentTarget;
  const folderId  = btn.dataset.folderId;
  const jobTitle  = btn.dataset.jobTitle || 'this job';

  if (!confirm(`Delete "${jobTitle}"?\n\nThe folder will be moved to your Google Drive trash and can be recovered from there.`)) return;

  btn.disabled    = true;
  btn.textContent = '…';

  try {
    await deleteDriveFolder(folderId);
    await loadDashboard();
  } catch (err) {
    showError('Delete failed: ' + err.message);
    btn.disabled    = false;
    btn.textContent = 'Delete';
  }
}

/**
 * Delete all selected jobs in a section (moves to Drive trash).
 *
 * @param {string} status
 */
async function handleBulkDelete(status) {
  const ids = [...selections[status]];
  if (ids.length === 0) return;

  if (!confirm(`Delete ${ids.length} job${ids.length > 1 ? 's' : ''}?\n\nThe folders will be moved to your Google Drive trash and can be recovered from there.`)) return;

  const deleteBtns = document.querySelectorAll(`.bulk-btn--delete[data-status="${status}"]`);
  deleteBtns.forEach(b => { b.disabled = true; b.textContent = '…'; });

  try {
    for (const folderId of ids) {
      await deleteDriveFolder(folderId);
    }
    clearSelection(status);
    await loadDashboard();
  } catch (err) {
    showError('Bulk delete failed: ' + err.message);
    deleteBtns.forEach(b => { b.disabled = false; b.textContent = 'Delete'; });
  }
}

// ── Auth ───────────────────────────────────────────────────────

/**
 * Get a valid OAuth access token.
 * Chrome: uses chrome.identity.getAuthToken() — reliable, manifest-scoped.
 * Edge: uses getOAuthToken() from helpers.js via launchWebAuthFlow.
 * @returns {Promise<string>}
 */
function getAuthToken() {
  const isEdge = navigator.userAgent.includes('Edg/');
  if (isEdge) {
    return getOAuthToken(true);
  }
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
