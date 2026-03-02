(() => {
/**
 * LinkedIn job scraper for JobLink extension.
 *
 * Supported layout (v1):
 *   Split-panel view — linkedin.com/jobs/search/ with a job selected on the right
 *
 * NOT supported (v1):
 *   Standalone job view — linkedin.com/jobs/view/[id]/
 *   These pages load the job detail inside a cross-origin iframe, blocking all
 *   content-script DOM access. Standalone support is deferred to a future version.
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
 * element found that has non-empty text.
 *
 * @param {string[]} selectors - CSS selectors to try, in priority order
 * @returns {string} Trimmed visible text, or '' if nothing matched
 */
function extractText(selectors) {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) {
      // innerText respects CSS visibility and gives clean, human-readable text
      const text = (el.innerText || el.textContent || '').trim();
      if (text) return text;
    }
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
    if (el) {
      const text = (el.innerText || el.textContent || '').trim();
      if (text) return text;
    }
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
    const spans = container.querySelectorAll('.tvm__text');
    for (const span of spans) {
      const text = (span.innerText || span.textContent || '').trim();
      // Skip separator dots and very short strings
      if (text && text !== '·' && text !== '•' && text.length > 2) {
        return text;
      }
    }
  }

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
    console.log('[JobLink] desc selector', selector, ':', el?.innerText?.substring(0, 100));
    if (el) {
      const byInnerText   = (el.innerText   || '').trim();
      const byTextContent = (el.textContent || '').trim();
      // Prefer whichever strategy surfaced more text
      const text = byInnerText.length >= byTextContent.length
        ? byInnerText
        : byTextContent;
      if (text.length >= MIN_DESC_LENGTH) return text;
    }
  }

  return '';
}

/**
 * Extract the canonical URL for this individual job posting.
 *
 * In the split-panel view (linkedin.com/jobs/search/?currentJobId=…) the page
 * URL is the search-results page, not the job itself.  Try in order:
 *   1. <link rel="canonical"> — LinkedIn inserts the correct permalink here.
 *   2. Construct a /jobs/view/[id]/ URL from the currentJobId query param.
 *   3. Fall back to window.location.href (last resort).
 *
 * @returns {string} Absolute URL for this job posting
 */
function extractApplicationUrl() {
  // 1. Canonical link tag (most reliable)
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical && canonical.href) {
    return canonical.href;
  }

  // 2. Construct from currentJobId param (split-panel search results page)
  const params = new URLSearchParams(window.location.search);
  const jobId = params.get('currentJobId');
  if (jobId) {
    return `https://www.linkedin.com/jobs/view/${jobId}/`;
  }

  // 3. Fallback
  return window.location.href;
}

/**
 * Scrape all job fields from the currently open LinkedIn split-panel job view.
 *
 * @returns {Object} Job data object conforming to the JobLink scraper output format
 */
function scrapeLinkedInJob() {
  const jobTitle = extractText([
    // Unified top card — h1 inside the title wrapper (most reliable, 2024+)
    '.job-details-jobs-unified-top-card__job-title h1',
    // Older split-panel top card
    '.jobs-unified-top-card__job-title h1',
    '.jobs-unified-top-card__job-title',
    // Generic h1 fallback
    'h1.t-24',
    '.topcard__title',
  ]);

  const company = extractText([
    // Collections/recommended layout — company may render without its own
    // named container; try the primary-description link and generic anchors first
    '.job-details-jobs-unified-top-card__company-name',
    '[class*="topcard__org-name"]',
    '.jobs-premium-applicant-insights__header a',
    '.job-details-jobs-unified-top-card__primary-description a',
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

  return {
    jobTitle,
    company,
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

  const jobData = scrapeLinkedInJob();
  console.log('[JobLink] LinkedIn scraper result (attempt 1):', jobData);

  if (isStaleRun()) {
    console.log('[JobLink] runScrape aborted (stale attempt 1):', runId);
    return;
  }

  if (jobData.description) {
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

    Object.assign(jobData, scrapeLinkedInJob());
    console.log(`[JobLink] runScrape attempt ${attempt + 1} description length:`, jobData.description.length);
    console.log(`[JobLink] Retry ${attempt} result:`, jobData.description ? 'got description' : 'still empty');
    if (jobData.description) {
      sendJobData(jobData);
      return;
    }
  }

  // All timed retries exhausted — fall back to a one-time MutationObserver
  // that fires runScrape() the moment .jobs-description appears in the DOM.
  // Disconnects itself after the first match or after 30 s to avoid leaking.
  console.log('[JobLink] All retries exhausted — watching DOM for .jobs-description');
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
    runScrape();
    sendResponse({ ok: true, source: 'linkedin' });
    return false;
  }

  return false;
});
})();
