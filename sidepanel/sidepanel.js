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
const btnPreparePackage  = document.getElementById('btn-prepare-package');
const btnEvaluateFit     = document.getElementById('evaluate-fit-btn');
const packageModel       = document.getElementById('package-model');
const packageStatus      = document.getElementById('package-status');

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

  // Load saved default AI model and pre-set the Prepare Package dropdown.
  try {
    const savedModel = await getStorageValue(STORAGE_KEYS.DEFAULT_AI_MODEL);
    if (savedModel) packageModel.value = savedModel;
  } catch (_) { /* non-fatal — dropdown stays at HTML default */ }

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
btnPreparePackage.addEventListener('click', handlePreparePackage);
btnEvaluateFit.addEventListener('click', handleEvaluate);

btnDashboard.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

// Gear icon opens the settings / setup page in a new tab.
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

  // Fire background tasks — non-blocking
  checkDuplicate(job);
  enrichCompanyMetadata(job);
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
    } else if (match.status === 'rejected') {
      setStatusBar('rejected');
    } else {
      setStatusBar('prep');
    }
  } catch (err) {
    console.warn('[JobLink] Duplicate check failed:', err.message);
    setStatusBar('new');
  }
}

/**
 * If the scraped company is missing or looks like a LinkedIn DOM artefact,
 * ask the AI to extract the real company name and location from the description.
 * Runs non-blocking after showJob() — updates currentJob and the visible fields
 * in place when the result arrives.
 *
 * The currentJob === job guard prevents a stale response from overwriting a
 * newer job if the user navigated to a different posting before the call returned.
 *
 * @param {Object} job - The job object as returned by the scraper
 */
async function enrichCompanyMetadata(job) {
  const co = job.company || '';
  const needsEnrichment = !co || co.length > 50 ||
    co.includes('employees') || co.includes('Metropolitan');

  if (!needsEnrichment || !job.description) return;

  try {
    const modelMap = {
      sonnet:           AI_MODELS.claude,
      haiku:            AI_MODELS.claudeHaiku,
      geminiFlash:      AI_MODELS.geminiFlash,
      geminiFlash25:    AI_MODELS.geminiFlash25,
      'gemini-2.5-pro': AI_MODELS.geminiPro,
    };
    const selectedModel = modelMap[packageModel.value] || AI_MODELS.claude;
    const extracted = await extractJobMetadata(job.description, null, selectedModel);

    if (currentJob !== job) return; // User has moved to a different job — discard

    if (extracted.company) {
      currentJob.company = extracted.company;
      fieldCompany.value = extracted.company;
    }
    if (extracted.location) {
      currentJob.location = extracted.location;
      fieldLocation.value = extracted.location;
    }
    console.log('[JobLink] Enriched company/location on load:', extracted);
  } catch (err) {
    console.warn('[JobLink] enrichCompanyMetadata failed:', err.message);
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

  // If the scraped company looks wrong (empty, too long, or contains known
  // junk strings from LinkedIn's DOM), ask the AI to extract it from the
  // description before saving.
  const co = jobToSave.company;
  const companyLooksWrong = !co || co.length > 50 ||
    co.includes('employees') || co.includes('Metropolitan');

  if (companyLooksWrong && jobToSave.description) {
    try {
      const modelMap = {
        sonnet:           AI_MODELS.claude,
        haiku:            AI_MODELS.claudeHaiku,
        geminiFlash:      AI_MODELS.geminiFlash,
        geminiFlash25:    AI_MODELS.geminiFlash25,
        'gemini-2.5-pro': AI_MODELS.geminiPro,
      };
      const selectedModel = modelMap[packageModel.value] || AI_MODELS.claude;
      const extracted = await extractJobMetadata(jobToSave.description, null, selectedModel);
      if (extracted.company) {
        jobToSave.company  = extracted.company;
        fieldCompany.value = extracted.company;
      }
      if (extracted.location) {
        jobToSave.location  = extracted.location;
        fieldLocation.value = extracted.location;
      }
      console.log('[JobLink] AI-corrected metadata:', extracted);
    } catch (metaErr) {
      console.warn('[JobLink] extractJobMetadata failed — saving with original values:', metaErr.message);
    }
  }

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

  try {
    const modelMap = {
      sonnet:           AI_MODELS.claude,
      haiku:            AI_MODELS.claudeHaiku,
      geminiFlash:      AI_MODELS.geminiFlash,
      geminiFlash25:    AI_MODELS.geminiFlash25,
      'gemini-2.5-pro': AI_MODELS.geminiPro,
    };
    const selectedModel = modelMap[packageModel.value] || AI_MODELS.claude;

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

    const rawText = await callAI('claude', prompt, selectedModel);
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

    // 4. Resolve selected model from the dropdown
    const modelMap = {
      sonnet:        AI_MODELS.claude,
      haiku:         AI_MODELS.claudeHaiku,
      geminiFlash:   AI_MODELS.geminiFlash,
      geminiFlash25: AI_MODELS.geminiFlash25,
      'gemini-2.5-pro': AI_MODELS.geminiPro,
    };
    const selectedModel = modelMap[packageModel.value] || AI_MODELS.claude;

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

    // 8. Get CL template doc ID
    packageStatus.textContent = '📄 Reading cover letter template...';
    let clTemplateDocId = null;
    const clFolderId = await getStorageValue(STORAGE_KEYS.CL_TEMPLATES_FOLDER_ID);
    if (clFolderId) {
      try {
        const clDocs = await readDocsFromFolder(token, clFolderId, 3);
        if (clDocs.length > 0) clTemplateDocId = clDocs[0].id;
      } catch (err) {
        console.warn('[JobLink] Could not read CL template folder:', err.message);
      }
    }

    // 9. Ask Claude for CL company block + body paragraphs
    packageStatus.textContent = '✍️ Writing cover letter...';
    let clBodyParagraphs = null;
    let clCompanyBlock = { name: jobToSave.company || '', department: '', location: jobToSave.location || '' };
    if (clTemplateDocId) {
      try {
        const clPrompt = buildCLBodyPrompt(jobToSave, newSummary);
        const rawClJson = await callAI('claude', clPrompt, selectedModel);
        const parsed = parseAIResponse(rawClJson);
        if (parsed && Array.isArray(parsed.bodyParagraphs) && parsed.bodyParagraphs.length > 0) {
          clBodyParagraphs = parsed.bodyParagraphs;
        }
        if (parsed && parsed.companyBlock && typeof parsed.companyBlock === 'object') {
          clCompanyBlock = parsed.companyBlock;
        }
        console.log('[JobLink] CL body paragraphs:', clBodyParagraphs ? clBodyParagraphs.length + ' paras' : 'NULL');
      } catch (err) {
        console.warn('[JobLink] CL generation failed:', err.message);
      }
    }

    packageStatus.textContent = '⏳ Saving package to Drive...';

    // 10. Generate job files in sidepanel context (jsPDF is available here)
    let pdfBase64 = '';
    try { pdfBase64 = generateJobPdfBase64(jobToSave); } catch (_) {}
    const htmlContent = generateJobSummaryHtml(jobToSave);
    const jsonContent = JSON.stringify(jobToSave, null, 2);

    // 11. Save to Drive
    const clData = {
      templateDocId: clTemplateDocId,
      companyBlock: clCompanyBlock,
      bodyParagraphs: clBodyParagraphs,
    };
    await savePreparedPackage(
      token, jobToSave,
      { templateDocId: selectedTemplate.id, newSummary, newBullets },
      clData,
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
