/**
 * Indeed job scraper for JobLink extension.
 *
 * Supported layouts:
 *   - Job detail page — indeed.com/viewjob?jk=…
 *   - Inline job panel — indeed.com/jobs?q=…&jk=…
 *
 * Returns a plain JS object in the JobLink scraper output format and sends it
 * to the service worker via chrome.runtime.sendMessage.
 *
 * This is a content script — it runs in the page context and must remain
 * self-contained. No imports. No Drive API calls. DOM parsing only.
 */

/** Delay (ms) before extracting — Indeed renders content dynamically. */
const EXTRACTION_DELAY_MS = 800;

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
      const text = (el.innerText || el.textContent || '').trim();
      if (text) return text;
    }
  }
  return '';
}

/**
 * Extract the job title from the page.
 *
 * The bare 'h1' selector is avoided as a direct fallback because Indeed's site
 * logo renders as an h1 with the text "Indeed", which would be returned instead
 * of the job title. The last-resort fallback explicitly filters that element out.
 *
 * @returns {string} Job title text, or '' if not found
 */
function extractJobTitle() {
  const text = extractText([
    '[data-testid="jobsearch-JobInfoHeader-title"]',
    'h1.jobsearch-JobInfoHeader-title',
    '.jobTitle h1',
    '.jobsearch-JobInfoHeader h1',
  ]);
  if (text) return text;

  // Last resort: find the first h1 whose visible text is not the site logo.
  const el = [...document.querySelectorAll('h1')]
    .find(h => h.innerText.trim() !== 'Indeed');
  return el ? el.innerText.trim() : '';
}

/**
 * Extract the company name from the page.
 *
 * @returns {string} Company name text, or '' if not found
 */
function extractCompany() {
  return extractText([
    '[data-testid="inlineHeader-companyName"] a',
    '[data-testid="inlineHeader-companyName"]',
    '.jobsearch-CompanyInfoContainer a',
  ]);
}

/**
 * Extract the job location from the page.
 *
 * @returns {string} Location text, or '' if not found
 */
function extractLocation() {
  return extractText([
    '[data-testid="job-location"]',
    '[data-testid="inlineHeader-companyLocation"]',
    '.jobsearch-JobInfoHeader-subtitle [data-testid]',
  ]);
}

/**
 * Extract the full job description text.
 *
 * Both innerText and textContent are tried for each element; the longer
 * result is used so that text inside overflow-clamped containers is captured.
 *
 * @returns {string} Description text, or '' if not found
 */
function extractDescription() {
  const descSelectors = [
    '#jobDescriptionText',
    '[data-testid="jobsearch-jobDescriptionText"]',
    '.jobsearch-jobDescriptionText',
  ];

  for (const selector of descSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      const byInnerText   = (el.innerText   || '').trim();
      const byTextContent = (el.textContent || '').trim();
      const text = byInnerText.length >= byTextContent.length
        ? byInnerText
        : byTextContent;
      if (text) return text;
    }
  }

  return '';
}

/**
 * Scrape all job fields from the currently open Indeed job page.
 *
 * @returns {Object} Job data object conforming to the JobLink scraper output format
 */
function scrapeIndeedJob() {
  return {
    jobTitle:       extractJobTitle(),
    company:        extractCompany(),
    location:       extractLocation(),
    description:    extractDescription(),
    applicationUrl: window.location.href,
    source:         'indeed',
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
      { type: 'JOB_DATA_EXTRACTED', data: jobData },
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
 * Scrape the currently visible job and send it to the service worker.
 *
 * Shared between the initial page-load path and the navigation watcher so
 * that both code paths stay in sync.
 */
function runScrape() {
  const jobData = scrapeIndeedJob();
  console.log('[JobLink] Indeed scraper result:', jobData);
  sendJobData(jobData);
}

// ── Navigation watcher (SPA navigation detection) ─────────────────────────────

/** Full href at the time of the last scrape — used to detect URL changes. */
let lastSeenHref = window.location.href;

/** Debounce timer handle for re-scrape scheduling; null when idle. */
let debounceTimer = null;

/**
 * Start a MutationObserver that detects in-page job navigation on Indeed.
 *
 * Indeed's SPA updates the URL when the user clicks a different job listing
 * without a full page reload.  The observer watches for any DOM mutation and,
 * when the URL has also changed to a URL containing a jk= query parameter
 * (Indeed's job key), schedules a re-scrape after EXTRACTION_DELAY_MS.
 * Debouncing ensures that a rapid burst of DOM mutations from a single
 * navigation triggers only one scrape.
 */
function startNavigationWatcher() {
  const observer = new MutationObserver(() => {
    const currentHref = window.location.href;

    // No URL change — ignore this batch of mutations
    if (currentHref === lastSeenHref) return;

    // URL changed but no jk= param — update tracking but don't scrape
    if (!currentHref.includes('jk=')) {
      lastSeenHref = currentHref;
      return;
    }

    lastSeenHref = currentHref;

    // Debounce: cancel any pending scrape and restart the timer
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log('[JobLink] Navigation detected — re-scraping:', currentHref);
      runScrape();
    }, EXTRACTION_DELAY_MS);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  console.log('[JobLink] Navigation watcher started');
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Wait for Indeed's dynamic content to render, then run the initial scrape.
 * Also starts the navigation watcher so subsequent job-clicks are captured
 * without a page reload.
 */
setTimeout(() => {
  runScrape();
  startNavigationWatcher();
}, EXTRACTION_DELAY_MS);
