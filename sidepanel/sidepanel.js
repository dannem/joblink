/**
 * Side panel UI logic for JobLink.
 *
 * Manages two UI states:
 *   empty  — no job captured yet; shows instructional message
 *   loaded — job data ready for review/edit before saving to Drive
 *
 * Data flow in:
 *   Content script → service worker (normalises & stores) →
 *   chrome.runtime.sendMessage → onMessage listener here
 *   OR: chrome.storage.session (restores data when the panel is re-opened)
 *
 * Data flow out:
 *   Save button → SAVE_TO_DRIVE message → service worker (stubbed in Session 6,
 *   real Drive upload wired in Session 7)
 */

// ── DOM references ────────────────────────────────────────────

const stateEmpty     = document.getElementById('state-empty');
const stateJob       = document.getElementById('state-job');
const sourceBadge    = document.getElementById('source-badge');
const scrapedTime    = document.getElementById('scraped-time');
const fieldTitle     = document.getElementById('field-title');
const fieldCompany   = document.getElementById('field-company');
const fieldLocation  = document.getElementById('field-location');
const fieldUrl       = document.getElementById('field-url');
const fieldDesc      = document.getElementById('field-description');
const btnSave        = document.getElementById('btn-save');
const btnClear       = document.getElementById('btn-clear');
const msgSuccess     = document.getElementById('msg-success');
const msgError       = document.getElementById('msg-error');
const settingsBtn    = document.getElementById('settings-btn');

// AI evaluation elements
const btnDashboard      = document.getElementById('btn-dashboard');
const aiProvider        = document.getElementById('ai-provider');
const btnEvaluate       = document.getElementById('btn-evaluate');
const aiSpinner         = document.getElementById('ai-spinner');
const aiError           = document.getElementById('ai-error');
const aiResults         = document.getElementById('ai-results');
const fitScoreNumber    = document.getElementById('fit-score-number');
const aiCorrespondence  = document.getElementById('ai-correspondence');
const aiDiscrepancies   = document.getElementById('ai-discrepancies');
const aiRecommendation  = document.getElementById('ai-recommendation');
const jobStatusBar      = document.getElementById('job-status-bar');
const jobStatusText     = document.getElementById('job-status-text');
const jobStatusIcon     = document.getElementById('job-status-icon');
const btnPreparePackage = document.getElementById('btn-prepare-package');
const packageModel      = document.getElementById('package-model');
const packageStatus     = document.getElementById('package-status');

// ── Module state ──────────────────────────────────────────────

/** The raw job object currently displayed (before user edits). */
let currentJob = null;

// ── Initialisation ────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Restore any job captured earlier in this browser session
  // (handles the panel being closed and re-opened mid-session)
  try {
    const result = await chrome.storage.session.get(SESSION_KEYS.CURRENT_JOB);
    if (result[SESSION_KEYS.CURRENT_JOB]) {
      showJob(result[SESSION_KEYS.CURRENT_JOB]);
    }
  } catch (err) {
    console.warn('[JobLink] Could not restore job from session storage:', err);
  }

  // Send REQUEST_SCRAPE to the active tab.
  // If session storage was empty (job not yet scraped), wait 1.5s then check again.
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_SCRAPE' })
        .catch(() => {});

      // If panel is still empty after 2.5s, check session storage again
      // (handles slow content script initialisation)
      if (!currentJob) {
        setTimeout(async () => {
          if (currentJob) return; // Already populated by message
          try {
            const result = await chrome.storage.session.get(SESSION_KEYS.CURRENT_JOB);
            if (result[SESSION_KEYS.CURRENT_JOB]) {
              showJob(result[SESSION_KEYS.CURRENT_JOB]);
            }
          } catch (_) {}
        }, 2500);
      }
    }
  } catch (err) {
    console.warn('[JobLink] Could not send REQUEST_SCRAPE:', err.message);
  }
});

// Re-send REQUEST_SCRAPE every time the panel becomes visible.
// DOMContentLoaded fires only once; this covers panel close/reopen and
// tab switches that bring the panel back into view on a different job.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_SCRAPE' })
        .catch(() => {});
    }
  } catch (err) {
    console.warn('[JobLink] visibilitychange REQUEST_SCRAPE failed:', err.message);
  }
});

// ── Incoming messages ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'JOB_DATA_EXTRACTED' && message.payload) {
    showJob(message.payload);
  }
});

// ── Button handlers ───────────────────────────────────────────

btnSave.addEventListener('click', handleSave);
btnClear.addEventListener('click', handleClear);
btnEvaluate.addEventListener('click', handleEvaluate);
btnPreparePackage.addEventListener('click', handlePreparePackage);

btnDashboard.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

// chrome.runtime.openOptionsPage() requires options_page/options_ui in manifest.json,
// which is not declared. Use chrome.tabs.create directly instead.
settingsBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('setup/setup.html') });
});

document.querySelectorAll('.collapsible-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const body  = btn.nextElementSibling;
    const arrow = btn.querySelector('.collapsible-arrow');
    const isOpen = body.style.display !== 'none';
    body.style.display  = isOpen ? 'none' : 'block';
    arrow.textContent   = isOpen ? '▼' : '▲';
  });
});

// ── UI functions ──────────────────────────────────────────────

/**
 * Populate the form fields and switch to the loaded state.
 *
 * @param {Object} job - Normalised job data from the scraper
 */
function showJob(job) {
  currentJob = job;

  // Source badge
  const source = (job.source || '').toLowerCase();
  sourceBadge.textContent = source === 'linkedin' ? 'LinkedIn' : 'Indeed';
  sourceBadge.className   = 'source-badge source-badge--' + source;

  // Capture time
  if (job.scrapedAt) {
    const d = new Date(job.scrapedAt);
    scrapedTime.textContent = d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Editable fields
  fieldTitle.value    = job.jobTitle    || '';
  fieldCompany.value  = job.company     || '';
  fieldLocation.value = job.location    || '';
  fieldDesc.value     = job.description || '';

  // Read-only URL link
  const url = job.applicationUrl || '';
  fieldUrl.href        = url;
  fieldUrl.textContent = url || '—';

  hideMessages();
  setStatusBar('checking');
  stateEmpty.style.display = 'none';
  stateJob.style.display   = 'flex';

  // Fire the duplicate check in the background — non-blocking
  checkDuplicate(job);
}

/**
 * Update the always-visible status bar to reflect the application state.
 *
 * @param {'checking'|'new'|'prep'|'submitted'|'rejected'} status
 */
function setStatusBar(status) {
  const states = {
    checking:  { cls: 'status-unknown',   icon: '⏳', text: 'Checking Drive...' },
    new:       { cls: 'status-new',       icon: '🆕', text: 'Not yet saved' },
    prep:      { cls: 'status-prep',      icon: '📝', text: 'In Preparation' },
    submitted: { cls: 'status-submitted', icon: '📤', text: 'Submitted' },
    rejected:  { cls: 'status-rejected',  icon: '❌', text: 'Previously rejected' },
  };
  const s = states[status] || states.checking;
  jobStatusBar.className    = 'job-status-bar ' + s.cls;
  jobStatusIcon.textContent = s.icon;
  jobStatusText.textContent = s.text;
}

/**
 * Check whether a folder matching this job exists in any status subfolder and
 * update the status bar accordingly.
 *
 * Non-fatal — errors fall back to 'new' so the panel stays functional even
 * when Drive is unreachable or no status folders are configured.
 *
 * @param {Object} job - { company, jobTitle } from the current job
 */
async function checkDuplicate(job) {
  setStatusBar('checking');
  btnEvaluate.disabled = false;

  try {
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: false }, (t) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(t);
      });
    });

    if (!token) { setStatusBar('new'); return; }

    console.log('[JobLink] Checking duplicate for:', job.company, '/', job.jobTitle);
    const match = await checkExistingApplication(token, job);
    console.log('[JobLink] Duplicate check result:', match);

    if (!match) {
      setStatusBar('new');
    } else if (match.status === 'submitted') {
      setStatusBar('submitted');
      btnEvaluate.disabled = true;
    } else if (match.status === 'rejected') {
      setStatusBar('rejected');
      btnEvaluate.disabled = true;
    } else {
      setStatusBar('prep');
    }
  } catch (err) {
    console.warn('[JobLink] Duplicate check failed:', err.message);
    setStatusBar('new');
  }
}

/**
 * Collect the current (possibly edited) field values and request a Drive save.
 * Generates the PDF here (jsPDF cannot run in a service worker), then sends
 * the job data and the base64 PDF together in one message.
 * The service worker handles the actual upload; this function manages UI state.
 */
async function handleSave() {
  if (!currentJob) return;

  // Merge user edits back into the job object
  const jobToSave = {
    ...currentJob,
    jobTitle:     fieldTitle.value.trim(),
    company:      fieldCompany.value.trim(),
    location:     fieldLocation.value.trim(),
    description:  fieldDesc.value.trim(),
  };

  setSaving(true);
  hideMessages();

  // Generate the PDF in the side panel — jsPDF is not available in the service worker.
  // If generation fails, log the error and continue without PDF so JSON/HTML are not blocked.
  let pdfBase64 = '';
  try {
    pdfBase64 = generateJobPdfBase64(jobToSave);
  } catch (pdfErr) {
    console.warn('[JobLink] PDF generation failed — save will continue without PDF:', pdfErr);
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type:     'SAVE_TO_DRIVE',
      payload:  jobToSave,
      pdfBase64,
    });

    if (response && response.success) {
      showSuccess();
    } else {
      showError(response?.error || 'Save failed — please try again.');
    }
  } catch (err) {
    showError('Could not reach the service worker. Try reloading the extension.');
    console.error('[JobLink] Save error:', err);
  } finally {
    setSaving(false);
  }
}

/**
 * Reset to the empty state and remove the stored job from session storage.
 */
function handleClear() {
  currentJob = null;
  chrome.storage.session.remove(SESSION_KEYS.CURRENT_JOB).catch(() => {});
  hideMessages();
  btnEvaluate.disabled     = false;
  stateJob.style.display   = 'none';
  stateEmpty.style.display = 'flex';
}

/**
 * Run an AI fit evaluation for the currently displayed job.
 * Reads the API key from storage, calls the selected provider via ai-helpers.js,
 * and renders the score and collapsible result sections.
 */
async function handleEvaluate() {
  if (!currentJob) return;

  aiSpinner.style.display = 'block';
  aiError.style.display   = 'none';
  aiResults.style.display = 'none';
  btnEvaluate.disabled    = true;

  try {
    const provider = aiProvider.value;

    // Attempt to load the candidate profile from Drive before building the prompt.
    // Failure is non-fatal — evaluation proceeds with a no-profile notice in the prompt.
    let profileText = '';
    try {
      const token = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: false }, (t) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(t);
        });
      });
      const rootFolderId = await getStorageValue(STORAGE_KEYS.DRIVE_ROOT_FOLDER_ID);
      if (token && rootFolderId) {
        const profileFolderId = await findFolderByName(token, rootFolderId, 'My_Profile');
        if (profileFolderId) {
          const profileDocs = await readDocsFromFolder(token, profileFolderId);
          profileText = profileDocs.map(d => `=== ${d.name} ===\n${d.text}`).join('\n\n');
        }
      }
    } catch (profileErr) {
      console.warn('[JobLink] Could not load profile — evaluating without it:', profileErr.message);
    }

    const prompt = buildEvaluatePrompt({
      jobTitle:    fieldTitle.value.trim(),
      company:     fieldCompany.value.trim(),
      description: fieldDesc.value.trim(),
    }, profileText);

    const rawText = await callAI(provider, prompt);
    const result  = parseAIResponse(rawText);

    if (!result || typeof result.score !== 'number') {
      throw new Error('AI returned an unexpected response format.');
    }

    fitScoreNumber.textContent = result.score;
    fitScoreNumber.className   = 'fit-score-number ' + (
      result.score >= 70 ? 'score-green' :
      result.score >= 40 ? 'score-amber' : 'score-red'
    );

    aiCorrespondence.textContent = result.correspondence  || '';
    aiDiscrepancies.textContent  = result.discrepancies   || '';
    aiRecommendation.textContent = result.recommendation  || '';

    aiResults.style.display = 'block';
  } catch (err) {
    aiError.textContent   = err.message || 'Evaluation failed.';
    aiError.style.display = 'block';
  } finally {
    aiSpinner.style.display = 'none';
    btnEvaluate.disabled    = false;
  }
}

/**
 * Prepare a tailored CV and cover letter for the current job using Claude AI.
 *
 * Flow:
 *   1. Read candidate profile from My_Profile folder in Drive
 *   2. Read CV templates from the configured CV Templates folder
 *   3. Ask Claude to pick the best template (if more than one)
 *   4. Ask Claude to tailor the CV for this specific role
 *   5. Ask Claude to write a cover letter
 *   6. Save the package to Drive via savePreparedPackage()
 */
async function handlePreparePackage() {
  if (!currentJob) return;

  // Merge any field edits into a jobToSave object used for both AI prompts and saving
  const jobToSave = {
    ...currentJob,
    jobTitle:    fieldTitle.value.trim(),
    company:     fieldCompany.value.trim(),
    location:    fieldLocation.value.trim(),
    description: fieldDesc.value.trim(),
  };

  btnPreparePackage.disabled  = true;
  packageStatus.className     = 'package-status';
  packageStatus.textContent   = '⏳ Reading your profile and CV templates...';
  packageStatus.style.display = 'block';

  try {
    // 1. Get OAuth token
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: false }, (t) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(t);
      });
    });

    const rootFolderId = await getStorageValue(STORAGE_KEYS.DRIVE_ROOT_FOLDER_ID);
    if (!rootFolderId) throw new Error('No Drive folder configured.');

    // 2. Read candidate profile from My_Profile (non-fatal)
    let profileText = '';
    try {
      const profileFolderId = await findFolderByName(token, rootFolderId, 'My_Profile');
      if (profileFolderId) {
        const profileDocs = await readDocsFromFolder(token, profileFolderId);
        profileText = profileDocs.map(d => `=== ${d.name} ===\n${d.text}`).join('\n\n');
      }
    } catch (_) { /* non-fatal — proceed without profile */ }

    // 3. Read CV templates from the configured folder
    const cvFolderId = await getStorageValue(STORAGE_KEYS.CV_TEMPLATES_FOLDER_ID);
    if (!cvFolderId) throw new Error('No CV Templates folder configured. Open Settings to add it.');
    const cvTemplates = await readDocsFromFolder(token, cvFolderId);
    if (cvTemplates.length < 1) throw new Error('No CV template documents found in the CV Templates folder.');

    // 4. Resolve selected Claude model from the dropdown
    const selectedModel = packageModel.value === 'haiku'
      ? AI_MODELS.claudeHaiku
      : AI_MODELS.claude;

    // 5. Select best template (if only one, use it directly)
    let selectedTemplate = cvTemplates[0];
    if (cvTemplates.length >= 2) {
      packageStatus.textContent = '⏳ Selecting best CV template for this role...';
      const selectPrompt = buildSelectTemplatePrompt(jobToSave, profileText, cvTemplates);
      const selectRaw    = await callAI('claude', selectPrompt, selectedModel);
      const selectResult = parseAIResponse(selectRaw);
      const idx = (selectResult?.selected ?? 1) - 1;
      if (idx > 0 && idx < cvTemplates.length) selectedTemplate = cvTemplates[idx];
      console.log('[JobLink] Template selected:', selectedTemplate.name, '—', selectResult?.reason);
    }

    // 6. Read current summary and bullets from selected template via Docs API
    packageStatus.textContent = '📄 Reading template structure...';
    let currentSummary = '';
    const currentBullets = [];

    try {
      const docRes = await fetch(
        `https://docs.googleapis.com/v1/documents/${selectedTemplate.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (docRes.ok) {
        const doc = await docRes.json();
        const body = doc.body.content;

        function getParagraphText(paragraph) {
          return (paragraph.elements || [])
            .map(e => e.textRun?.content || '')
            .join('')
            .replace(/\n$/, '');
        }

        let foundSummaryHeading = false;
        let foundDirectorRole = false;
        let bulletCount = 0;

        for (const block of body) {
          if (!block.paragraph) continue;
          const text = getParagraphText(block.paragraph);
          if (text.includes('PROFESSIONAL SUMMARY')) { foundSummaryHeading = true; continue; }
          if (foundSummaryHeading && !currentSummary && text.trim().length > 20) {
            currentSummary = text;
          }
          if (text.includes('Director of Bioimaging')) { foundDirectorRole = true; continue; }
          if (foundDirectorRole && block.paragraph.bullet && text.trim().length > 0 && bulletCount < 4) {
            currentBullets.push(text);
            bulletCount++;
          }
        }
      }
    } catch (err) {
      console.warn('[JobLink] Could not read template structure:', err.message);
    }

    // 7. Ask Claude for structured replacements (summary + bullets as JSON)
    packageStatus.textContent = '✍️ Tailoring CV content...';
    let newSummary = currentSummary;
    let newBullets = [...currentBullets];

    if (currentSummary) {
      try {
        const structuredPrompt = buildTailorCVStructuredPrompt(jobToSave, profileText, currentSummary, currentBullets);
        const rawJson = await callAI('claude', structuredPrompt, selectedModel);
        const parsed = parseAIResponse(rawJson);
        if (parsed && parsed.summary) newSummary = parsed.summary;
        if (parsed && Array.isArray(parsed.bullets) && parsed.bullets.length > 0) newBullets = parsed.bullets;
      } catch (err) {
        console.warn('[JobLink] Structured CV tailoring failed, using originals:', err.message);
      }
    }

    // 8. Read CL template structure via Docs API
    packageStatus.textContent = '📄 Reading cover letter template...';
    let clTemplateDocId = null;
    let currentCLOpening = '';
    let currentCLBodyParas = [];
    let currentCLClosing = '';

    const clFolderId = await getStorageValue(STORAGE_KEYS.CL_TEMPLATES_FOLDER_ID);
    if (clFolderId) {
      try {
        const clDocs = await readDocsFromFolder(token, clFolderId, 3);
        if (clDocs.length > 0) {
          clTemplateDocId = clDocs[0].id;

          const clDocRes = await fetch(
            `https://docs.googleapis.com/v1/documents/${clTemplateDocId}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (clDocRes.ok) {
            const clDoc = await clDocRes.json();
            const clParas = [];
            for (const block of clDoc.body.content) {
              if (!block.paragraph) continue;
              const text = (block.paragraph.elements || [])
                .map(e => e.textRun?.content || '')
                .join('')
                .replace(/\n$/, '');
              clParas.push(text);
            }

            let dearIdx = -1, sincerelyIdx = -1;
            for (let i = 0; i < clParas.length; i++) {
              if (clParas[i].startsWith('Dear Hiring Manager')) dearIdx = i;
              if (clParas[i].trim() === 'Sincerely,') sincerelyIdx = i;
            }

            if (dearIdx >= 0 && sincerelyIdx >= 0) {
              const bodyParas = [];
              for (let i = dearIdx + 1; i < sincerelyIdx; i++) {
                if (clParas[i].trim().length > 30) bodyParas.push(clParas[i]);
              }
              if (bodyParas.length >= 2) {
                currentCLOpening = bodyParas[0];
                currentCLClosing = bodyParas[bodyParas.length - 1];
                currentCLBodyParas = bodyParas.slice(1, -1);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[JobLink] Could not read CL template:', err.message);
      }
    }

    // 9. Ask Claude for structured CL replacements
    packageStatus.textContent = '✍️ Writing cover letter...';
    let clReplacements = null;

    if (clTemplateDocId && currentCLOpening) {
      try {
        const clPrompt = buildTailorCLStructuredPrompt(
          jobToSave, profileText, currentCLOpening, currentCLBodyParas, currentCLClosing
        );
        const rawClJson = await callAI('claude', clPrompt, selectedModel);
        clReplacements = parseAIResponse(rawClJson);
      } catch (err) {
        console.warn('[JobLink] Structured CL tailoring failed:', err.message);
      }
    }

    packageStatus.textContent = '⏳ Saving package to Drive...';

    // 10. Generate job files in sidepanel context (jsPDF is available here)
    let pdfBase64 = '';
    try { pdfBase64 = generateJobPdfBase64(jobToSave); } catch (_) {}
    const htmlContent = generateJobSummaryHtml(jobToSave);
    const jsonContent = JSON.stringify(jobToSave, null, 2);

    // 11. Save to Drive
    await savePreparedPackage(
      token, jobToSave,
      { templateDocId: selectedTemplate.id, newSummary, newBullets },
      { templateDocId: clTemplateDocId, replacements: clReplacements },
      selectedTemplate.name,
      { pdfBase64, htmlContent, jsonContent }
    );

    packageStatus.textContent = '✅ Package saved to Submitted!';
    setStatusBar('submitted');

  } catch (err) {
    packageStatus.className   = 'package-status package-error';
    packageStatus.textContent = '❌ ' + (err.message || 'Package preparation failed.');
    console.error('[JobLink] Prepare package error:', err);
    console.error('[JobLink] Error stack:', err.stack);
  } finally {
    btnPreparePackage.disabled = false;
  }
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Disable/re-enable buttons and update the Save button label during a save.
 *
 * @param {boolean} saving
 */
function setSaving(saving) {
  btnSave.disabled    = saving;
  btnClear.disabled   = saving;
  btnSave.textContent = saving ? 'Saving…' : 'Save to Drive';
}

/** Show the success banner, then auto-hide it after 3 s. */
function showSuccess() {
  msgSuccess.style.display = 'block';
  msgError.style.display   = 'none';
  setTimeout(() => {
    msgSuccess.style.display = 'none';
  }, 3000);
}

/**
 * Show the error banner with the given message.
 *
 * @param {string} text
 */
function showError(text) {
  msgError.textContent     = text;
  msgError.style.display   = 'block';
  msgSuccess.style.display = 'none';
}

/** Hide both status banners. */
function hideMessages() {
  msgSuccess.style.display = 'none';
  msgError.style.display   = 'none';
}
