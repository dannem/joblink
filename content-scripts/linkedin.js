(() => {
/**
 * LinkedIn job scraper for JobLink extension.
 *
 * Supported layouts:
 *   Split-panel view   — linkedin.com/jobs/search/ with a job selected on the right
 *   Standalone view    — linkedin.com/jobs/view/{id}/ including email digest links
 *                        that arrive with ?trk=eml… tracking params
 *
 * Returns a plain JS object in the JobLink scraper output format and sends it
 * to the service worker via chrome.runtime.sendMessage.
 *
 * This is a content script — it runs in the page context and must remain
 * self-contained. No imports. No Drive API calls. DOM parsing only.
 */

/** Delay (ms) before the initial page-load scrape. */
const EXTRACTION_DELAY_MS = 500;

/** Delay (ms) after a URL change before the first scrape attempt. */
const NAV_EXTRACTION_DELAY_MS = 2500;

/** Delay (ms) between description-empty retry attempts. */
const RETRY_DELAY_MS = 1500;

/** Maximum number of retry attempts after an empty description. */
const MAX_RETRIES = 5;

/**
 * Try each CSS selector in order and return the trimmed text of the first
 * element that has non-empty text.
 *
 * @param {string[]} selectors - CSS selectors to try, in priority order
 * @returns {string} Trimmed text, or '' if nothing matched
 */
function extractText(selectors) {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const text = (el.innerText || el.textContent || '').trim();
    if (text) return text;
  }
  return '';
}

/**
 * Extract the job location from the page.
 *
 * LinkedIn places the location in different elements depending on the layout
 * and era of the page. This function tries specific "bullet" classes first,
 * then falls back to parsing the primary description container.
 *
 * @returns {string} Location text, or '' if not found
 */
function extractLocation() {
  const bulletSelectors = [
    // Collections/recommended layout (2024+) — no __bullet class; location
    // lives directly inside the primary-description or without-company variant
    '.job-details-jobs-unified-top-card__primary-description-without-company .tvm__text',
    '.job-details-jobs-unified-top-card__primary-description .tvm__text:first-child',
    // Unified top card used in split-panel (2024+)
    '.job-details-jobs-unified-top-card__bullet',
    // Direct tvm__text span inside the primary description container
    '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
    // Older split-panel top card
    '.jobs-unified-top-card__bullet',
    // Workplace type label (Remote / Hybrid / On-site) on split-panel
    '.jobs-unified-top-card__workplace-type',
    // Classic topcard fallbacks
    '.topcard__flavor--bullet',
    '.topcard__flavor',
    // Wildcard class fallbacks — catch LinkedIn class renames
    '[class*="job-location"]',
    '[class*="workplace-type"]',
    '[class*="location"]',
    // Collections/recommended layout — location rendered inside artdeco lockup
    // caption element (confirmed via live DOM inspection: returns e.g.
    // 'Philadelphia, PA · Hybrid')
    '.artdeco-entity-lockup__caption',
  ];

  for (const selector of bulletSelectors) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const text = (el.innerText || el.textContent || '').trim();
    if (text) return text;
  }

  // Fallback: parse the primary description container.
  // LinkedIn renders location as the first non-separator span inside this div.
  // Structure example:
  //   <span class="tvm__text tvm__text--positive">Austin, TX</span>
  //   <span class="tvm__text tvm__text--neutral"> · </span>
  //   <span class="tvm__text tvm__text--positive">Hybrid</span>
  const container = document.querySelector(
    '.job-details-jobs-unified-top-card__primary-description-container'
  );
  if (container) {
    for (const span of container.querySelectorAll('.tvm__text')) {
      const text = (span.innerText || span.textContent || '').trim();
      // Skip separator dots and very short strings
      if (text && text !== '·' && text !== '•' && text.length > 2) {
        return text;
      }
    }
  }

  // Last resort: LinkedIn's meta description often contains location info
  // (e.g. "Austin, TX · Hybrid · Full-time — Apply for ...").
  // Return the full content so the user can trim it in the side panel.
  const metaDesc =
    document.querySelector('meta[name="description"]')?.content ||
    document.querySelector('meta[property="og:description"]')?.content ||
    '';
  if (metaDesc.trim()) return metaDesc.trim();

  return '';
}

/**
 * Extract the full job description text.
 *
 * Each selector is tried in order. For every candidate element, both
 * innerText and textContent are read and the longer result is kept —
 * innerText misses text hidden by CSS overflow clamps, while textContent
 * includes hidden ARIA/heading nodes; taking the longer string balances both.
 *
 * A minimum character length guards against returning header-only elements
 * like "About the job" (~14 chars) instead of the real body text.
 *
 * @returns {string} Description text, or '' if not found
 */
function extractDescription() {
  const MIN_DESC_LENGTH = 50;

  const descSelectors = [
    // List-view layout — broad container confirmed working via debug logging
    '.jobs-description',
    // Email digest / standalone job view layout
    '.jobs-description__content',
    '.jobs-description-content__text',
    // Collections/recommended layout — stretched description variant
    '.jobs-description-content__text--stretch',
    '.jobs-box__html-content .jobs-description-content__text',
    '.job-details-about-the-job-module__description',
    // Split-panel / search layout
    '.jobs-description__content .jobs-description-content__text',
    '.jobs-box__html-content',
    '.jobs-description-content',
    '[id*="job-details"]',
  ];

  for (const selector of descSelectors) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const byInnerText   = (el.innerText   || '').trim();
    const byTextContent = (el.textContent || '').trim();
    // Prefer whichever strategy surfaced more text
    const text = byInnerText.length >= byTextContent.length
      ? byInnerText
      : byTextContent;
    if (text.length >= MIN_DESC_LENGTH) return text;
  }

  return '';
}

/**
 * Extract a clean, tracking-param-free URL for this job posting.
 *
 * All LinkedIn job URLs resolve to the same canonical form:
 *   https://www.linkedin.com/jobs/view/{numericJobId}/
 *
 * LinkedIn often appends tracking params (?trk=eml…, ?refId=…) to URLs that
 * arrive via email digests or notifications. This function extracts just the
 * numeric job ID from whichever source has it and reconstructs a clean URL,
 * ensuring saved links are stable and human-readable.
 *
 * Sources tried in priority order:
 *   1. /jobs/view/(\d+) in the canonical <link> href
 *   2. /jobs/view/(\d+) in the current page URL (email digest pages land here)
 *   3. currentJobId query param (split-panel search results)
 *   4. Fallback to window.location.href (no ID found anywhere)
 *
 * @returns {string} Clean absolute URL for this job posting
 */
function extractApplicationUrl() {
  const JOB_ID_RE = /\/jobs\/view\/(\d+)/;

  // 1. Canonical link tag — extract numeric ID from its href
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical?.href) {
    const m = canonical.href.match(JOB_ID_RE);
    if (m) return `https://www.linkedin.com/jobs/view/${m[1]}/`;
  }

  // 2. Current page URL — covers /jobs/view/{id}?trk=eml… email digest pages
  const fromPath = window.location.pathname.match(JOB_ID_RE);
  if (fromPath) return `https://www.linkedin.com/jobs/view/${fromPath[1]}/`;

  // 3. currentJobId query param (split-panel search results page)
  const jobId = new URLSearchParams(window.location.search).get('currentJobId');
  if (jobId) return `https://www.linkedin.com/jobs/view/${jobId}/`;

  // 4. Last resort — no numeric ID available
  return window.location.href;
}

/**
 * Scrape all job fields from the currently open LinkedIn job page.
 *
 * Supports two layouts:
 *   - Split-panel view  — linkedin.com/jobs/search/?currentJobId=…
 *   - Standalone view   — linkedin.com/jobs/view/{id}/ (including email digest links
 *                         with ?trk=eml… tracking params)
 *
 * Returns null when no job ID can be determined, which happens on list pages
 * (/jobs/search/, /jobs/collections/) and the LinkedIn homepage. Callers must
 * check for null before accessing the returned object.
 *
 * @returns {Object|null} Job data object, or null if not on a single-job page
 */
function scrapeLinkedInJob() {
  // Guard: a valid job ID must be present in the URL before we attempt to
  // scrape anything. On list/feed pages no job ID exists, so any DOM reads
  // would return partial or irrelevant data from the feed layout.
  if (!getCurrentJobId()) {
    console.log('[JobLink] scrapeLinkedInJob: no job ID in URL — skipping (list or feed page)');
    return null;
  }

  const jobTitle = extractText([
    // Unified top card — h1 inside the title wrapper (most reliable, 2024+)
    '.job-details-jobs-unified-top-card__job-title h1',
    // Older split-panel top card
    '.jobs-unified-top-card__job-title h1',
    '.jobs-unified-top-card__job-title',
    // Email digest / standalone page layout
    'h1.job-title',
    // Generic h1 fallbacks
    'h1.t-24',
    '.topcard__title',
    'h1',
  ]);

  // Extract raw company text then strip everything after the first newline.
  // Some layouts render the company name and follower count in the same element
  // (e.g. "Acme Corp\n10,000 followers"); keeping only the first line gives a
  // clean value without post-processing elsewhere.
  const rawCompany = extractText([
    // Unified top card — dedicated company name container (2024+)
    '.job-details-jobs-unified-top-card__company-name',
    '[class*="topcard__org-name"]',
    '.jobs-premium-applicant-insights__header a',
    '.job-details-jobs-unified-top-card__primary-description a',
    // Email digest / standalone layout — first company link on the page
    'a[href*="/company/"]',
    // Unified top card — company link (2024+)
    '.job-details-jobs-unified-top-card__company-name a',
    // Older split-panel top card
    '.jobs-unified-top-card__company-name a',
    '.jobs-unified-top-card__company-name',
    // Tracking attribute seen on split-panel public/logged-out pages
    'a[data-tracking-control-name="public_jobs_topcard-org-name"]',
    // Classic topcard company link
    '.topcard__org-name-link',
    // Any company-page link inside the top card containers
    '.job-details-jobs-unified-top-card a[href*="/company/"]',
    '.jobs-unified-top-card a[href*="/company/"]',
    // Wildcard class fallbacks — catch LinkedIn class renames
    '[class*="hiring-company"] a',
    '[class*="hiring-company"]',
    '[class*="company-name"] a',
    '[class*="company-name"]',
  ]);
  const company = rawCompany.split('\n')[0].trim();

  // document.title fallback — format: "Job Title | Company Name | LinkedIn"
  // Used only when DOM selectors above returned nothing.
  const titleParts = document.title.split(' | ');
  const finalJobTitle = jobTitle || (titleParts[0] || '').trim();
  const finalCompany  = company  || (titleParts[1] || '').trim();

  return {
    jobTitle: finalJobTitle,
    company:  finalCompany,
    location:       extractLocation(),
    description:    extractDescription(),
    applicationUrl: extractApplicationUrl(),
    sourceJobId:    getCurrentJobId(),
    source:         'linkedin',
    scrapedAt:      new Date().toISOString(),
  };
}

/**
 * Send a completed job data object to the service worker.
 *
 * @param {Object} jobData - Scraper output conforming to the JobLink format
 */
function sendJobData(jobData) {
  try {
    chrome.runtime.sendMessage(
      { type: 'JOB_DATA_EXTRACTED', payload: jobData },
      (response) => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || '';
          // Expected after extension reload on already-open tabs: old script contexts
          // are invalidated until a fresh script instance is injected.
          if (msg.includes('Extension context invalidated')) return;
          // Non-fatal: service worker may be inactive on first run.
          console.warn('[JobLink] Message warning:', msg);
        }
      }
    );
  } catch (error) {
    if ((error?.message || '').includes('Extension context invalidated')) return;
    console.error('[JobLink] Failed to send job data to service worker:', error);
  }
}

/**
 * Build a stable identifier for the currently open LinkedIn job.
 * Uses currentJobId (collections/search layout) or /jobs/view/{id} when present.
 *
 * @returns {string}
 */
function getCurrentJobIdentity() {
  try {
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get('currentJobId');
    if (fromQuery) return `job:${fromQuery}`;

    const m = url.pathname.match(/\/jobs\/view\/(\d+)/);
    if (m && m[1]) return `job:${m[1]}`;

    return `url:${url.pathname}`;
  } catch (_) {
    return `href:${window.location.href}`;
  }
}

/**
 * Return the current LinkedIn job id if present in URL state.
 *
 * @returns {string}
 */
function getCurrentJobId() {
  try {
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get('currentJobId');
    if (fromQuery) return fromQuery;

    const m = url.pathname.match(/\/jobs\/view\/(\d+)/);
    if (m && m[1]) return m[1];
  } catch (_) {
    return '';
  }
  return '';
}

/**
 * Click the "see more" expand button on a truncated job description, if present,
 * then wait 500 ms for the DOM to update before returning.
 *
 * LinkedIn sometimes renders descriptions with a "… see more" toggle that hides
 * the full text. Clicking it programmatically before scraping ensures the
 * complete description is available to innerText/textContent reads.
 *
 * Safe to call even when the button is absent — querySelector returns null and
 * the function returns immediately.
 */
async function expandDescriptionIfTruncated() {
  const btn = document.querySelector(
    '.jobs-description__content .feed-shared-inline-show-more-text__see-more-less-toggle'
  );
  if (btn) {
    btn.click();
    console.log('[JobLink] Clicked "see more" button — waiting 500 ms for description to expand');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

/**
 * Scrape the currently visible job and send it to the service worker.
 *
 * If the description is empty on the first attempt (LinkedIn's async content
 * may not have rendered yet), retries up to MAX_RETRIES more times with
 * RETRY_DELAY_MS between each attempt. Sends whatever data is available once
 * either a description is found or all retries are exhausted.
 *
 * Shared between the initial page-load path and the navigation watcher so
 * that both code paths stay in sync.
 */
async function runScrape() {
  const runId = ++scrapeRunCounter;
  const runJobIdentity = getCurrentJobIdentity();
  const isStaleRun = () =>
    runId !== scrapeRunCounter || getCurrentJobIdentity() !== runJobIdentity;

  // Expand truncated descriptions before the first scrape attempt.
  await expandDescriptionIfTruncated();

  const jobData = scrapeLinkedInJob();
  console.log('[JobLink] LinkedIn scraper result (attempt 1):', jobData);

  // null means we're on a list/feed page — nothing to scrape
  if (!jobData) return;

  if (isStaleRun()) {
    console.log('[JobLink] runScrape aborted (stale attempt 1):', runId);
    return;
  }

  // isDomStale: URL has changed to a new job but the DOM still shows the
  // previous job's data — detected by a mismatched job ID with an unchanged
  // title+company signature (LinkedIn's SPA race condition).
  const isDomStale = (data) => {
    if (!data || !lastScrapedJobId) return false;
    const currentId = getCurrentJobId();
    const currentSignature = data.jobTitle + '|' + data.company;
    return currentId !== lastScrapedJobId && currentSignature === lastScrapedSignature;
  };

  if (isDomStale(jobData)) {
    console.log('[JobLink] DOM is stale — clearing description to force retry');
    jobData.description = '';
  }

  if (jobData.description) {
    lastScrapedJobId = getCurrentJobId();
    lastScrapedSignature = jobData.jobTitle + '|' + jobData.company;
    sendJobData(jobData);
    return;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (isStaleRun()) {
      console.log('[JobLink] runScrape aborted (stale during retry loop):', runId);
      return;
    }
    console.log(`[JobLink] Description empty — retry ${attempt}/${MAX_RETRIES} in ${RETRY_DELAY_MS} ms`);
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    if (isStaleRun()) {
      console.log('[JobLink] runScrape aborted (stale after retry wait):', runId);
      return;
    }

    const retryData = scrapeLinkedInJob();
    if (retryData) Object.assign(jobData, retryData);
    if (isDomStale(jobData)) {
      console.log('[JobLink] DOM still stale after retry — clearing description');
      jobData.description = '';
    }
    console.log(`[JobLink] runScrape attempt ${attempt + 1} description length:`, jobData.description.length);
    console.log(`[JobLink] Retry ${attempt} result:`, jobData.description ? 'got description' : 'still empty');
    if (jobData.description) {
      lastScrapedJobId = getCurrentJobId();
      lastScrapedSignature = jobData.jobTitle + '|' + jobData.company;
      sendJobData(jobData);
      return;
    }
  }

  // All timed retries exhausted — fall back to a one-time MutationObserver
  // that fires runScrape() the moment .jobs-description appears in the DOM.
  // Disconnects itself after the first match or after 30 s to avoid leaking.
  console.log('[JobLink] All retries exhausted — watching DOM for .jobs-description');
  lastScrapedJobId = getCurrentJobId();
  lastScrapedSignature = jobData.jobTitle + '|' + jobData.company;
  sendJobData(jobData); // keep panel responsive even when description extraction lags

  let domWatchTimer = null;
  const domWatcher = new MutationObserver(() => {
    if (isStaleRun()) {
      domWatcher.disconnect();
      return;
    }
    const el = document.querySelector('.jobs-description');
    if (!el) return;

    // Element appeared — debounce by 500 ms to let content finish rendering
    clearTimeout(domWatchTimer);
    domWatchTimer = setTimeout(() => {
      console.log('[JobLink] .jobs-description appeared in DOM — re-scraping');
      domWatcher.disconnect();
      runScrape();
    }, 500);
  });

  domWatcher.observe(document.body, { childList: true, subtree: true });

  // Safety disconnect after 30 s so the observer does not run indefinitely
  setTimeout(() => {
    domWatcher.disconnect();
    console.log('[JobLink] DOM watcher timed out after 30 s');
  }, 30000);
}

// ── Navigation watcher (SPA navigation detection) ─────────────────────────────

/** Full href at the time of the last scrape — used to detect URL changes. */
let lastSeenHref = window.location.href;

/** Debounce timer handle for re-scrape scheduling; null when idle. */
let debounceTimer = null;

/** Monotonic counter used to cancel stale overlapping scrape runs. */
let scrapeRunCounter = 0;

/** Job ID of the last successfully scraped job — used for DOM staleness checks. */
let lastScrapedJobId = null;

/** Title+company signature of the last scraped job — used for DOM staleness checks. */
let lastScrapedSignature = null;

/**
 * Start a MutationObserver that detects in-page job navigation on LinkedIn.
 *
 * LinkedIn's SPA updates the URL and re-renders the job panel without a full
 * page reload when the user clicks a different job listing.  The observer
 * watches for any DOM mutation and, when the URL has also changed to a URL
 * containing /jobs/ (confirming the user is viewing a job), schedules a
 * re-scrape after EXTRACTION_DELAY_MS.  Debouncing ensures that a rapid burst
 * of DOM mutations from a single navigation triggers only one scrape.
 */
function startNavigationWatcher() {
  const observer = new MutationObserver(() => {
    const currentHref = window.location.href;

    // No URL change — ignore this batch of mutations
    if (currentHref === lastSeenHref) return;

    // URL changed but not to a jobs URL — update tracking but don't scrape
    if (!currentHref.includes('/jobs/')) {
      lastSeenHref = currentHref;
      return;
    }

    lastSeenHref = currentHref;
    console.log('[JobLink] URL changed, new jobId detected:', currentHref);

    // Debounce: cancel any pending scrape and restart the timer.
    // NAV_EXTRACTION_DELAY_MS (1500ms) gives LinkedIn's async content swap
    // enough time to begin rendering before the first scrape attempt.
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log('[JobLink] Navigation detected — re-scraping:', currentHref);
      runScrape();
    }, NAV_EXTRACTION_DELAY_MS);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  console.log('[JobLink] Navigation watcher started');
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Wait for LinkedIn's SPA to finish rendering, then run the initial scrape.
 * Also starts the navigation watcher so subsequent job-clicks are captured
 * without a page reload.
 */
setTimeout(() => {
  runScrape();
  startNavigationWatcher();
}, EXTRACTION_DELAY_MS);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PING_CONTENT_SCRIPT') {
    sendResponse({ ok: true, source: 'linkedin' });
    return false;
  }

  if (message.type === 'REQUEST_SCRAPE') {
    // Cancel any pending navigation-debounce or retry so the externally
    // requested scrape runs clean without a duplicate follow-up firing later.
    clearTimeout(debounceTimer);
    debounceTimer = null;
    runScrape();
    sendResponse({ ok: true, source: 'linkedin' });
    return false;
  }

  return false;
});
})();
