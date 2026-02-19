/**
 * LinkedIn job scraper for JobLink extension.
 *
 * Handles two LinkedIn job page layouts:
 *   1. Standalone job view  — linkedin.com/jobs/view/[id]/
 *   2. Split-panel view     — linkedin.com/jobs/search/ with a job selected on the right
 *
 * Returns a plain JS object in the JobLink scraper output format and sends it
 * to the service worker via chrome.runtime.sendMessage.
 *
 * This is a content script — it runs in the page context and must remain
 * self-contained. No imports. No Drive API calls. DOM parsing only.
 */

/** Delay (ms) before extracting on split-panel search pages. */
const EXTRACTION_DELAY_MS = 500;

/** Delay (ms) before extracting on standalone job pages — they load more slowly. */
const STANDALONE_EXTRACTION_DELAY_MS = 1500;

/**
 * Return true when the current page is a standalone job view
 * (linkedin.com/jobs/view/[id]/) rather than the split-panel search results.
 *
 * @returns {boolean}
 */
function isStandalonePage() {
  return window.location.pathname.startsWith('/jobs/view/');
}

/**
 * Log key standalone-page elements to the console so selector issues can be
 * diagnosed in DevTools without having to manually inspect the DOM.
 * Called only when isStandalonePage() is true.
 */
function logStandaloneDiagnostics() {
  const h1     = document.querySelector('h1');
  const org    = document.querySelector('.topcard__org-name-link');
  const bullet = document.querySelector('.topcard__flavor--bullet');
  const desc   = document.querySelector('.description__text');
  const markup = document.querySelector('.show-more-less-html__markup');

  console.log('[JobLink][STANDALONE-DIAG] h1:',
    h1 && h1.innerText);
  console.log('[JobLink][STANDALONE-DIAG] .topcard__org-name-link:',
    org && org.innerText);
  console.log('[JobLink][STANDALONE-DIAG] .topcard__flavor--bullet:',
    bullet && bullet.innerText);
  console.log('[JobLink][STANDALONE-DIAG] .description__text (200):',
    desc && desc.innerText.substring(0, 200));
  console.log('[JobLink][STANDALONE-DIAG] .show-more-less-html__markup (200):',
    markup && markup.innerText.substring(0, 200));
}

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
 * @param {boolean} standalone - true when on a linkedin.com/jobs/view/ page
 * @returns {string} Location text, or '' if not found
 */
function extractLocation(standalone) {
  const bulletSelectors = [
    // Standalone-specific selectors — tried first on /jobs/view/ pages
    ...(standalone ? [
      '.topcard__flavor--bullet',
      '.top-card-layout__first-subline .topcard__flavor:not(.topcard__flavor--bullet)',
    ] : []),
    // Unified top card used in both layouts (2024+)
    '.job-details-jobs-unified-top-card__bullet',
    // Direct tvm__text span inside the primary description container
    '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
    // Older split-panel top card
    '.jobs-unified-top-card__bullet',
    // Workplace type label (Remote / Hybrid / On-site) on split-panel
    '.jobs-unified-top-card__workplace-type',
    // Classic standalone topcard (shared fallback)
    '.topcard__flavor--bullet',
    '.topcard__flavor',
    // Wildcard class fallbacks — catch LinkedIn class renames
    '[class*="job-location"]',
    '[class*="workplace-type"]',
    '[class*="location"]',
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
 * @param {boolean} standalone - true when on a linkedin.com/jobs/view/ page
 * @returns {string} Description text, or '' if not found
 */
function extractDescription(standalone) {
  const MIN_DESC_LENGTH = 100;

  const descSelectors = [
    // Standalone-specific selectors — tried first on /jobs/view/ pages
    ...(standalone ? [
      '.show-more-less-html__markup',
      '.description__text',
      '.core-section-container__content',
    ] : []),
    // Split-panel and shared selectors
    '.jobs-description__content .jobs-description-content__text',
    '.jobs-description',
    '.jobs-box__html-content',
    '.job-details-about-the-job-module__description',
    '.jobs-description-content',
    '[id*="job-details"]',
  ];

  for (const selector of descSelectors) {
    const el = document.querySelector(selector);
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
 *   3. Fall back to window.location.href (standalone view or last resort).
 *
 * @returns {string} Absolute URL for this job posting
 */
function extractApplicationUrl() {
  // 1. Canonical link tag (most reliable across both layouts)
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

  // 3. Fallback — standalone job view already has the correct URL
  return window.location.href;
}

/**
 * Scrape all job fields from the currently open LinkedIn job page.
 *
 * @param {boolean} standalone - true when on a linkedin.com/jobs/view/ page
 * @returns {Object} Job data object conforming to the JobLink scraper output format
 */
function scrapeLinkedInJob(standalone) {
  const jobTitle = extractText([
    // Standalone-specific selectors — tried first on /jobs/view/ pages
    ...(standalone ? [
      'h1.top-card-layout__title',
      'h1.topcard__title',
      'h1',
    ] : []),
    // Unified top card — h1 inside the title wrapper (most reliable, 2024+)
    '.job-details-jobs-unified-top-card__job-title h1',
    // Older split-panel top card
    '.jobs-unified-top-card__job-title h1',
    '.jobs-unified-top-card__job-title',
    // Generic h1 with LinkedIn's heading class (standalone fallback)
    'h1.t-24',
    // Classic topcard title
    '.topcard__title',
  ]);

  const company = extractText([
    // Standalone-specific selectors — tried first on /jobs/view/ pages
    ...(standalone ? [
      '.topcard__org-name-link',
      '.top-card-layout__first-subline a',
    ] : []),
    // Unified top card — company link (2024+)
    '.job-details-jobs-unified-top-card__company-name a',
    '.job-details-jobs-unified-top-card__company-name',
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

  const location = extractLocation(standalone);
  const description = extractDescription(standalone);

  return {
    jobTitle,
    company,
    location,
    description,
    applicationUrl: extractApplicationUrl(),
    source: 'linkedin',
    scrapedAt: new Date().toISOString(),
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
          // Non-fatal: service worker may be inactive on first run.
          console.warn('[JobLink] Message warning:', chrome.runtime.lastError.message);
        }
      }
    );
  } catch (error) {
    console.error('[JobLink] Failed to send job data to service worker:', error);
  }
}

/**
 * Wait for LinkedIn's dynamic content to render, then extract and send job data.
 *
 * Standalone pages use a longer initial delay (1500 ms) as they render more
 * slowly than the split-panel view. If the description is still empty after
 * the first pass, a single retry fires after an additional 1000 ms — the
 * description panel sometimes loads after the rest of the top card.
 * All other fields are taken from the first pass regardless.
 */
const standalone = isStandalonePage();
const delay = standalone ? STANDALONE_EXTRACTION_DELAY_MS : EXTRACTION_DELAY_MS;

console.log(`[JobLink] Layout: ${standalone ? 'standalone' : 'split-panel'}, delay: ${delay} ms`);

setTimeout(() => {
  // Standalone diagnostics — logs key elements to help identify selector issues
  if (standalone) logStandaloneDiagnostics();

  // --- DEBUG: log raw DOM so selector issues can be diagnosed in DevTools ---
  // Remove this block once company/location selectors are confirmed working.
  console.log('[JobLink][DEBUG] body HTML (first 3000 chars):',
    document.body.innerHTML.substring(0, 3000));
  console.log('[JobLink][DEBUG] company probe [class*="company"]  :',
    document.querySelector('[class*="company"]'));
  console.log('[JobLink][DEBUG] company probe [class*="hiring"]   :',
    document.querySelector('[class*="hiring"]'));
  console.log('[JobLink][DEBUG] location probe [class*="location"]:',
    document.querySelector('[class*="location"]'));
  console.log('[JobLink][DEBUG] location probe [class*="workplace"]:',
    document.querySelector('[class*="workplace"]'));
  // --- END DEBUG ---

  const jobData = scrapeLinkedInJob(standalone);
  console.log('[JobLink] LinkedIn scraper result (first pass):', jobData);

  if (jobData.description) {
    sendJobData(jobData);
    return;
  }

  // Description was empty — the panel may still be loading. Retry once.
  console.log('[JobLink] Description empty on first pass — retrying in 1000 ms');
  setTimeout(() => {
    jobData.description = extractDescription(standalone);
    console.log('[JobLink] LinkedIn scraper result (after retry):', jobData);
    sendJobData(jobData);
  }, 1000);
}, delay);
