/**
 * AI provider helpers for JobLink extension.
 *
 * Provides direct REST calls to Claude, OpenAI, and Gemini — no SDKs,
 * just fetch().  All functions are globals (no import/export) so this file
 * can be loaded as a plain <script> tag.
 *
 * Load order requirement: helpers.js must be loaded before this file
 * (uses STORAGE_KEYS and getStorageValue from helpers.js).
 */

// ── Model constants ────────────────────────────────────────────────────────

const AI_MODELS = {
  claude: 'claude-sonnet-4-6',   // Sonnet for cost efficiency
  openai: 'gpt-4o',
  gemini: 'gemini-1.5-flash',    // Flash for speed and cost
};

// ── Prompt builder ─────────────────────────────────────────────────────────

/**
 * Build a fit-evaluation prompt for the given job.
 *
 * @param {Object} job           - { jobTitle, company, description }
 * @param {string} [profileText] - Candidate profile text read from Drive.
 *   If omitted or empty the prompt instructs the AI to evaluate on job
 *   requirements alone.
 * @returns {string} Prompt ready to send to an AI provider
 */
function buildEvaluatePrompt(job, profileText) {
  const profileSection = profileText
    ? `--- CANDIDATE PROFILE ---\n${profileText}`
    : `--- CANDIDATE PROFILE ---\n(No profile provided — evaluate based on job requirements alone)`;

  return `You are an expert career coach evaluating job fit.

${profileSection}

Assess how well this candidate matches the job posting below.

Return ONLY a raw JSON object — no markdown, no code fences, no explanation outside the JSON.
Use exactly this shape:
{
  "score": <integer 0-100>,
  "correspondence": "<paragraph on how the candidate's background aligns with the role>",
  "discrepancies": "<paragraph on gaps or mismatches between the candidate and the role>",
  "recommendation": "<one clear sentence: whether to apply and how to position the application>"
}

--- JOB ---
Title: ${job.jobTitle || '(unknown)'}
Company: ${job.company || '(unknown)'}

${job.description || '(no description provided)'}`;
}

// ── Low-level API callers ──────────────────────────────────────────────────

/**
 * Call the Anthropic Messages API directly from the browser.
 *
 * @param {string} apiKey - Anthropic API key
 * @param {string} prompt - Full prompt text
 * @returns {Promise<string>} Model response text
 * @throws {Error} On HTTP error or missing response content
 */
async function callAnthropicAPI(apiKey, prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: AI_MODELS.claude,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text;
  if (!text) throw new Error('No content returned from Claude.');
  return text;
}

/**
 * Call the OpenAI Chat Completions API.
 *
 * @param {string} apiKey - OpenAI API key
 * @param {string} prompt - Full prompt text
 * @returns {Promise<string>} Model response text
 * @throws {Error} On HTTP error or missing response content
 */
async function callOpenAIAPI(apiKey, prompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: AI_MODELS.openai,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('No content returned from OpenAI.');
  return text;
}

/**
 * Call the Google Gemini generateContent API.
 *
 * @param {string} apiKey - Google AI API key
 * @param {string} prompt - Full prompt text
 * @returns {Promise<string>} Model response text
 * @throws {Error} On HTTP error or missing response content
 */
async function callGeminiAPI(apiKey, prompt) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${AI_MODELS.gemini}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No content returned from Gemini.');
  return text;
}

// ── Response parser ────────────────────────────────────────────────────────

/**
 * Strip markdown code fences and parse JSON from a model response.
 * Falls back to finding the first {...} block if direct parse fails.
 *
 * @param {string} text - Raw model response text
 * @returns {Object|null} Parsed object, or null on failure
 */
function parseAIResponse(text) {
  // Strip ```json ... ``` or ``` ... ``` fences
  let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (_) {
    // Fallback: find the first {...} block in the raw text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (_) { /* fall through */ }
    }
    return null;
  }
}

// ── Provider dispatcher ────────────────────────────────────────────────────

/**
 * Read the appropriate API key from storage, then call the selected provider.
 *
 * @param {'claude'|'openai'|'gemini'} provider
 * @param {string} prompt
 * @returns {Promise<string>} Raw model response text
 * @throws {Error} If the API key is not set or the API call fails
 */
async function callAI(provider, prompt) {
  const keyMap = {
    claude: STORAGE_KEYS.ANTHROPIC_API_KEY,
    openai: STORAGE_KEYS.OPENAI_API_KEY,
    gemini: STORAGE_KEYS.GEMINI_API_KEY,
  };

  const storageKey = keyMap[provider];
  if (!storageKey) throw new Error(`Unknown AI provider: "${provider}"`);

  const apiKey = await getStorageValue(storageKey);
  if (!apiKey) {
    const names = { claude: 'Anthropic', openai: 'OpenAI', gemini: 'Google Gemini' };
    throw new Error(`No ${names[provider]} API key set. Open Settings to add your key.`);
  }

  switch (provider) {
    case 'claude': return callAnthropicAPI(apiKey, prompt);
    case 'openai': return callOpenAIAPI(apiKey, prompt);
    case 'gemini': return callGeminiAPI(apiKey, prompt);
  }
}

// ── Package preparation prompt builders ────────────────────────────────────

/**
 * Build a prompt asking Claude to select the better CV template for a job
 * and return which one to use.
 *
 * @param {Object} job            - { jobTitle, company, description }
 * @param {string} cvTemplate1Text - Full text of first CV template
 * @param {string} cvTemplate1Name - Filename of first CV template
 * @param {string} cvTemplate2Text - Full text of second CV template
 * @param {string} cvTemplate2Name - Filename of second CV template
 * @returns {string} Prompt text
 */
function buildSelectTemplatePrompt(job, cvTemplate1Text, cvTemplate1Name, cvTemplate2Text, cvTemplate2Name) {
  return `You are an expert career coach. A candidate has two CV templates and needs to apply for a job.

Read both CV templates and the job description, then decide which template is better suited for this specific role.

Return ONLY a raw JSON object — no markdown, no code fences:
{
  "selected": "1" or "2",
  "reason": "<one sentence explaining why this template is better suited>"
}

--- JOB ---
Title: ${job.jobTitle || '(unknown)'}
Company: ${job.company || '(unknown)'}
${job.description || ''}

--- CV TEMPLATE 1: ${cvTemplate1Name} ---
${cvTemplate1Text}

--- CV TEMPLATE 2: ${cvTemplate2Name} ---
${cvTemplate2Text}`;
}

/**
 * Build a prompt asking Claude to tailor a CV for a specific job.
 *
 * @param {Object} job           - { jobTitle, company, description }
 * @param {string} cvTemplateText - Full text of the selected CV template
 * @returns {string} Prompt text
 */
function buildTailorCVPrompt(job, cvTemplateText) {
  return `You are an expert career coach tailoring a CV for a specific job application.

Using the candidate's CV template below, produce a tailored version optimised for the job posting.

Rules:
- Keep all factual information accurate — do not invent experience or qualifications
- Reorder or emphasise sections/bullet points that are most relevant to this role
- Adjust the professional summary/objective to speak directly to this role
- Use keywords from the job description naturally where they fit the candidate's real experience
- Keep the same overall structure and formatting markers as the original
- Return the complete tailored CV as plain text, ready to be saved as a document

--- JOB ---
Title: ${job.jobTitle || '(unknown)'}
Company: ${job.company || '(unknown)'}
${job.description || ''}

--- CANDIDATE CV TEMPLATE ---
${cvTemplateText}`;
}

/**
 * Build a prompt asking Claude to write a cover letter for a job.
 *
 * @param {Object} job    - { jobTitle, company, description }
 * @param {string} cvText - The tailored CV text (used for context)
 * @returns {string} Prompt text
 */
function buildCoverLetterPrompt(job, cvText) {
  return `You are an expert career coach writing a cover letter for a job application.

Write a professional, compelling cover letter based on the candidate's CV and the job posting below.

Rules:
- 3-4 paragraphs, no longer than one page
- Opening: express genuine interest in the role and company
- Middle: connect 2-3 specific experiences from the CV to key requirements of the job
- Closing: confident call to action
- Tone: professional but personable, not generic
- Do not use phrases like "I am writing to apply" or "Please find attached"
- Return only the cover letter text, no subject line or metadata

--- JOB ---
Title: ${job.jobTitle || '(unknown)'}
Company: ${job.company || '(unknown)'}
${job.description || ''}

--- CANDIDATE CV ---
${cvText}`;
}
