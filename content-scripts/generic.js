(() => {
/**
 * Generic job page scraper for JobLink extension.
 *
 * Runs on any URL that is not LinkedIn or Indeed (excluded via manifest.json).
 * Uses common DOM patterns and meta tags to extract job data without site-
 * specific knowledge. Only sends data when a job title is found and the
 * description is longer than 200 characters.
 *
 * This is a content script — it runs in the page context and must remain
 * self-contained. No imports. No Drive API calls. DOM parsing only.
 */

/** Delay (ms) before extracting — many career sites render content late. */
const EXTRACTION_DELAY_MS = 1000;

/** Minimum description length (chars) required to consider the page a job post. */
const MIN_DESC_LENGTH = 200;

/** Minimum text length (chars) for a block element to qualify as the description. */
const MIN_BLOCK_LENGTH = 500;

/**
 * Return trimmed innerText (or textContent fallback) for the first element
 * that matches any of the given CSS selectors and has non-empty text.
 *
 * @param {string[]} selectors
 * @returns {string}
 */
function queryText(selectors) {
  for (const selector of selectors) {
    try {
      const el = document.querySelector(selector);
      if (el) {
        const text = (el.innerText || el.textContent || '').trim();
        if (text) return text;
      }
    } catch (_) { /* malformed selector — skip */ }
  }
  return '';
}

/**
 * Build attribute selectors for common class/id name patterns.
 * Returns both [class*="…"] and [id*="…"] variants for each keyword.
 *
 * @param {string[]} keywords
 * @returns {string[]}
 */
function attrSelectors(keywords) {
  const attrs = [];
  for (const kw of keywords) {
    attrs.push(`[class*="${kw}"]`, `[id*="${kw}"]`);
  }
  return attrs;
}

/**
 * Extract the job title.
 *
 * Priority order:
 *   1. h1 (most pages put the job title in the page's primary heading)
 *   2. h2
 *   3. Elements whose class or id contains common title keywords
 *
 * @returns {string}
 */
function extractJobTitle() {
  // Try heading elements first
  const headingText = queryText(['h1', 'h2']);
  if (headingText) return headingText;

  // Fall back to keyword-matched elements
  return queryText(attrSelectors(['job-title', 'jobtitle', 'position-title', 'position', 'role-title', 'role']));
}

/**
 * Remove artefacts that commonly appear in company names sourced from page
 * titles, meta tags, or DOM elements on career sites.
 *
 * Strips, in order:
 *   1. Trailing standalone noise words — "migration", "careers", "jobs",
 *      "hiring", "inc", "llc" — matched whole-word and case-insensitively.
 *      Applied in a loop so sequences like "Jobs Careers" are fully removed.
 *      The word must be preceded by whitespace or a comma to count as
 *      standalone, preventing "AcmeCareers" or "WorkMigration" from being
 *      truncated.
 *   2. Trailing punctuation (, . · | – — -) left behind after each strip.
 *   3. Leading/trailing whitespace.
 *
 * @param {string} raw
 * @returns {string}
 */
function cleanCompanyName(raw) {
  // Matches: optional leading comma/whitespace separator, a whole noise word,
  // optional trailing punctuation — all anchored to end-of-string.
  const NOISE_WORD_RE = /[,\s]+\b(?:migration|careers|jobs|hiring|inc|llc)\b[.,·|–—\-]?\s*$/i;
  const TRAILING_PUNCT_RE = /[,.\s·|–—\-]+$/;

  let name = raw.trim();

  // Iteratively strip trailing noise words until none remain.
  let prev;
  do {
    prev = name;
    name = name.replace(NOISE_WORD_RE, '').trim();
  } while (name !== prev);

  // Remove any leftover trailing punctuation after the noise words are gone.
  name = name.replace(TRAILING_PUNCT_RE, '').trim();

  return name;
}

/**
 * Extract the company name.
 *
 * Priority order:
 *   1. <meta> og:site_name — canonical brand name on many career sites
 *   2. <meta> application-name — another common brand tag
 *   3. Elements whose class or id contains company/employer keywords
 *   4. Fallback: the hostname stripped of common subdomains and TLD
 *
 * Every candidate value passes through cleanCompanyName() before being returned.
 *
 * @returns {string}
 */
function extractCompany() {
  // 1. Open Graph site name
  const ogSiteName = document.querySelector('meta[property="og:site_name"]');
  if (ogSiteName?.content?.trim()) return cleanCompanyName(ogSiteName.content.trim());

  // 2. application-name meta
  const appName = document.querySelector('meta[name="application-name"]');
  if (appName?.content?.trim()) return cleanCompanyName(appName.content.trim());

  // 3. DOM elements with company/employer keywords
  const fromDom = queryText(attrSelectors(['company-name', 'company', 'employer-name', 'employer', 'org-name', 'organization']));
  if (fromDom) return cleanCompanyName(fromDom);

  // 4. Derive from hostname — strip www./careers./jobs. prefix and TLD
  try {
    const host = window.location.hostname
      .replace(/^(www|careers|jobs|apply|talent|work)\./i, '');
    // Remove trailing TLD e.g. ".com", ".co.uk"
    const parts = host.split('.');
    if (parts.length >= 2) {
      // Keep just the second-level domain, title-cased
      const name = parts[parts.length - 2];
      return cleanCompanyName(name.charAt(0).toUpperCase() + name.slice(1));
    }
    return cleanCompanyName(host);
  } catch (_) {
    return '';
  }
}

/**
 * Extract the job location.
 *
 * @returns {string}
 */
function extractLocation() {
  return queryText(attrSelectors(['job-location', 'location', 'city', 'office', 'workplace']));
}

/**
 * Extract the job description.
 *
 * Priority order:
 *   1. Elements whose class or id contains description/overview/responsibilities keywords
 *   2. <article> elements with substantial text (>= MIN_BLOCK_LENGTH chars)
 *   3. The single <div> block with the most text (if >= MIN_BLOCK_LENGTH chars)
 *
 * For every candidate element both innerText and textContent are tried; the
 * longer result is returned so that overflow-clamped or visually hidden text
 * is captured.
 *
 * @returns {string}
 */
function extractDescription() {
  const descKeywords = [
    'job-description', 'jobdescription',
    'job-details',     'jobdetails',
    'job-overview',    'joboverview',
    'job-content',     'jobcontent',
    'description',
    'overview',
    'responsibilities',
    'about-the-job',   'about-role',
    'posting-description',
  ];

  for (const selector of attrSelectors(descKeywords)) {
    try {
      const el = document.querySelector(selector);
      if (el) {
        const inner   = (el.innerText   || '').trim();
        const content = (el.textContent || '').trim();
        const text    = inner.length >= content.length ? inner : content;
        if (text.length >= MIN_DESC_LENGTH) return text;
      }
    } catch (_) { /* malformed selector — skip */ }
  }

  // Fallback 1: largest <article> element
  let best = '';
  for (const el of document.querySelectorAll('article')) {
    const inner   = (el.innerText   || '').trim();
    const content = (el.textContent || '').trim();
    const text    = inner.length >= content.length ? inner : content;
    if (text.length >= MIN_BLOCK_LENGTH && text.length > best.length) best = text;
  }
  if (best) return best;

  // Fallback 2: largest <div> block (excluding script/style content)
  let bestDiv = '';
  for (const el of document.querySelectorAll('div')) {
    // Skip very deeply nested or hidden elements to avoid grabbing navbars
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const inner   = (el.innerText   || '').trim();
    const content = (el.textContent || '').trim();
    const text    = inner.length >= content.length ? inner : content;
    if (text.length >= MIN_BLOCK_LENGTH && text.length > bestDiv.length) bestDiv = text;
  }
  return bestDiv;
}

/**
 * Scrape all job fields from the current page using generic heuristics.
 *
 * @returns {Object} Job data object conforming to the JobLink scraper output format
 */
function scrapeGenericJob() {
  return {
    jobTitle:       extractJobTitle(),
    company:        extractCompany(),
    location:       extractLocation(),
    description:    extractDescription(),
    applicationUrl: window.location.href,
    source:         'generic',
    scrapedAt:      new Date().toISOString(),
  };
}

/**
 * Send a completed job data object to the service worker.
 *
 * @param {Object} jobData
 */
function sendJobData(jobData) {
  try {
    chrome.runtime.sendMessage(
      { type: 'JOB_DATA_EXTRACTED', payload: jobData },
      (response) => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || '';
          if (msg.includes('Extension context invalidated')) return;
          console.warn('[JobLink] Generic scraper message warning:', msg);
        }
      }
    );
  } catch (error) {
    if ((error?.message || '').includes('Extension context invalidated')) return;
    console.error('[JobLink] Generic scraper failed to send job data:', error);
  }
}

/**
 * Scrape the current page and send data if the quality threshold is met.
 *
 * Only sends when:
 *   - A job title was found, AND
 *   - The description is longer than MIN_DESC_LENGTH characters
 */
function runScrape() {
  const jobData = scrapeGenericJob();

  if (!jobData.jobTitle) {
    console.warn('[JobLink] Generic scraper: no job title found — skipping send');
    return;
  }
  if (jobData.description.length < MIN_DESC_LENGTH) {
    console.warn(`[JobLink] Generic scraper: description too short (${jobData.description.length} chars) — skipping send`);
    return;
  }

  sendJobData(jobData);
}

// ── Entry point ───────────────────────────────────────────────────────────────

setTimeout(runScrape, EXTRACTION_DELAY_MS);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PING_CONTENT_SCRIPT') {
    sendResponse({ ok: true, source: 'generic' });
    return false;
  }

  if (message.type === 'REQUEST_SCRAPE') {
    runScrape();
    sendResponse({ ok: true, source: 'generic' });
    return false;
  }

  return false;
});
})();
