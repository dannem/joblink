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

/** Wait this long (ms) before extracting, to let LinkedIn's JS finish rendering. */
const EXTRACTION_DELAY_MS = 500;

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
  // Try named bullet/location classes (present in most layouts)
  const bulletSelectors = [
    // Unified top card used in both layouts (2024+)
    '.job-details-jobs-unified-top-card__bullet',
    // Older split-panel top card
    '.jobs-unified-top-card__bullet',
    // Classic standalone topcard
    '.topcard__flavor--bullet',
    '.topcard__flavor',
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
 * Uses textContent (rather than innerText) so that text hidden behind LinkedIn's
 * "See more" CSS clamp is still captured, since LinkedIn sometimes puts the full
 * text in the DOM and hides it with overflow/max-height rather than conditional
 * rendering.
 *
 * @returns {string} Description text, or '' if not found
 */
function extractDescription() {
  const descSelectors = [
    // Main description content wrapper (split-panel and standalone, 2023+)
    '.jobs-description__content',
    // Newer standalone module (2024+)
    '.job-details-about-the-job-module__description',
    // id-based selector seen on many standalone pages
    '#job-details',
    // Older HTML content box
    '.jobs-box__html-content',
    // Older standalone topcard
    '.description__text',
  ];

  for (const selector of descSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      const text = (el.textContent || el.innerText || '').trim();
      if (text) return text;
    }
  }

  return '';
}

/**
 * Scrape all job fields from the currently open LinkedIn job page.
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
    // Generic h1 with LinkedIn's heading class (standalone fallback)
    'h1.t-24',
    // Classic topcard title
    '.topcard__title',
  ]);

  const company = extractText([
    // Unified top card — company link (2024+)
    '.job-details-jobs-unified-top-card__company-name a',
    '.job-details-jobs-unified-top-card__company-name',
    // Older split-panel top card
    '.jobs-unified-top-card__company-name a',
    '.jobs-unified-top-card__company-name',
    // Classic topcard company link
    '.topcard__org-name-link',
  ]);

  const location = extractLocation();
  const description = extractDescription();

  return {
    jobTitle,
    company,
    location,
    description,
    applicationUrl: window.location.href,
    source: 'linkedin',
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Wait for LinkedIn's dynamic content to render, then extract and send job data.
 * Wrapped in setTimeout to give the SPA time to finish populating the DOM.
 */
setTimeout(() => {
  const jobData = scrapeLinkedInJob();

  console.log('[JobLink] LinkedIn scraper result:', jobData);

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
}, EXTRACTION_DELAY_MS);
