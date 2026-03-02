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
  claude:       'claude-sonnet-4-6',         // Sonnet — high quality
  claudeHaiku:  'claude-haiku-4-5-20251001', // Haiku — fast and cheap
  openai:       'gpt-4o',
  geminiFlash:  'gemini-2.0-flash', // Flash 2.0
  geminiFlash25: 'gemini-2.5-flash', // Flash 2.5
  geminiPro:     'gemini-2.5-pro', // Pro 2.5
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
 * @param {string} [model] - Model ID to use (defaults to AI_MODELS.claude)
 * @returns {Promise<string>} Model response text
 * @throws {Error} On HTTP error or missing response content
 */
async function callAnthropicAPI(apiKey, prompt, model = AI_MODELS.claude) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model,
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
 * @param {string} [model] - Model ID to use (defaults to AI_MODELS.gemini)
 * @returns {Promise<string>} Model response text
 * @throws {Error} On HTTP error or missing response content
 */
async function callGeminiAPI(apiKey, prompt, model = AI_MODELS.gemini) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  console.log('[JobLink] Gemini URL:', url);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    console.error('[JobLink] Gemini error response:', JSON.stringify(errBody));
    throw new Error(errBody.error?.message || `Gemini API error: ${response.status}`);
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
 * When the package pipeline passes a Gemini model ID via the model parameter
 * (e.g. AI_MODELS.geminiFlash) with provider='claude', this function detects
 * the Gemini model and re-routes to callGeminiAPI using the stored Gemini key.
 *
 * @param {'claude'|'openai'|'gemini'} provider
 * @param {string} prompt
 * @param {string|null} [model] - Optional model override. Gemini model IDs
 *   (starting with 'gemini-') are routed to Gemini regardless of provider.
 * @returns {Promise<string>} Raw model response text
 * @throws {Error} If the API key is not set or the API call fails
 */
async function callAI(provider, prompt, model = null) {
  // Gemini models selected via the package dropdown arrive with provider='claude'.
  // Detect them by model ID prefix and re-route before the normal key lookup.
  if (model && model.startsWith('gemini-')) {
    const geminiKey = await getStorageValue(STORAGE_KEYS.GEMINI_API_KEY);
    if (!geminiKey) throw new Error('No Google Gemini API key set. Open Settings to add your key.');
    return callGeminiAPI(geminiKey, prompt, model);
  }

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
    case 'claude': return callAnthropicAPI(apiKey, prompt, model || AI_MODELS.claude);
    case 'openai': return callOpenAIAPI(apiKey, prompt);
    case 'gemini': return callGeminiAPI(apiKey, prompt, model || AI_MODELS.gemini);
  }
}

// ── Package preparation prompt builders ────────────────────────────────────

/**
 * Build a prompt asking the AI to select the best CV template for a job
 * from an array of templates.
 *
 * @param {Object} job         - { jobTitle, company, description }
 * @param {string} profileText - Candidate profile text (may be empty)
 * @param {Array<{name: string, text: string}>} templates - CV template objects
 * @returns {string} Prompt text
 */
function buildSelectTemplatePrompt(job, profileText, templates) {
  const templateBlocks = templates.map((t, i) =>
    `--- TEMPLATE ${i + 1}: ${t.name} ---\n${t.text}`
  ).join('\n\n');

  return `You are an expert career coach. A candidate has ${templates.length} CV template${templates.length !== 1 ? 's' : ''} and needs to apply for a job.

Read all CV templates and the job description, then decide which template is best suited for this specific role.

Return ONLY a raw JSON object — no markdown, no code fences:
{
  "selected": <integer 1 to ${templates.length}>,
  "reason": "<one sentence explaining why this template is better suited>"
}

--- CANDIDATE PROFILE ---
${profileText || '(no profile provided)'}

--- JOB ---
Title: ${job.jobTitle || '(unknown)'}
Company: ${job.company || '(unknown)'}
${job.description || ''}

${templateBlocks}`;
}

/**
 * Build a prompt asking Claude to tailor a CV for a specific job.
 *
 * @param {Object} job           - { jobTitle, company, description }
 * @param {string} profileText   - Candidate profile text (may be empty)
 * @param {string} cvTemplateText - Full text of the selected CV template
 * @returns {string} Prompt text
 */
function buildTailorCVPrompt(job, profileText, cvTemplateText) {
  return `You are an expert career coach tailoring a CV for a specific job application.

Using the candidate's CV template below, produce a tailored version optimised for the job posting.

Rules:
- Keep all factual information accurate — do not invent experience or qualifications
- Reorder or emphasise sections/bullet points that are most relevant to this role
- Adjust the professional summary/objective to speak directly to this role
- Use keywords from the job description naturally where they fit the candidate's real experience
- Preserve the structure and hierarchy of the original CV exactly
- Return the complete tailored CV as clean HTML using these elements only:
    <h1> for the candidate's name
    <h2> for section headings (Experience, Education, Skills, etc.)
    <h3> for job titles / role names within sections
    <p> for paragraph text
    <ul> and <li> for bullet point lists
    <strong> for bold emphasis
    <em> for italic text
    <br> for line breaks within a block
- Do NOT include <html>, <head>, <body>, <style>, or any CSS
- Do NOT include markdown, code fences, or any text outside the HTML

--- CANDIDATE PROFILE ---
${profileText || '(no profile provided)'}

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
 * @param {Object} job         - { jobTitle, company, description }
 * @param {string} profileText - Candidate profile text (may be empty)
 * @param {string} cvText      - The tailored CV text (used for context)
 * @returns {string} Prompt text
 */
function buildCoverLetterPrompt(job, profileText, cvText) {
  return `You are an expert career coach writing a cover letter for a job application.

Write a professional, compelling cover letter based on the candidate's profile, CV, and the job posting below.

Rules:
- 3-4 paragraphs, no longer than one page
- Opening: express genuine interest in the role and company
- Middle: connect 2-3 specific experiences from the CV to key requirements of the job
- Closing: confident call to action
- Tone: professional but personable, not generic
- Do not use phrases like "I am writing to apply" or "Please find attached"
- Return the cover letter as clean HTML using these elements only:
    <p> for each paragraph
    <strong> for any bold emphasis
- Do NOT include <html>, <head>, <body>, <style>, or any CSS
- Do NOT include markdown, code fences, or any text outside the HTML

--- CANDIDATE PROFILE ---
${profileText || '(no profile provided)'}

--- JOB ---
Title: ${job.jobTitle || '(unknown)'}
Company: ${job.company || '(unknown)'}
${job.description || ''}

--- CANDIDATE CV ---
${cvText}`;
}

/**
 * Build a prompt that asks Claude to return structured CV replacements as JSON.
 * Used for Docs API tailoring — returns only the sections that change, preserving
 * all other formatting in the original Google Doc.
 *
 * @param {Object} job
 * @param {string} profileText
 * @param {string} currentSummary   - Current Professional Summary text from the template
 * @param {string[]} currentBullets - Current Director role bullet texts from the template
 * @returns {string} Prompt string
 */
function buildTailorCVStructuredPrompt(job, profileText, currentSummary, currentBullets) {
  return `You are tailoring a CV for a specific job application. Return ONLY a JSON object — no explanation, no markdown, no code fences.

JOB:
Title: ${job.jobTitle || 'N/A'}
Company: ${job.company || 'N/A'}
Description: ${job.description || 'N/A'}

CANDIDATE PROFILE:
${profileText}

CURRENT PROFESSIONAL SUMMARY:
${currentSummary}

CURRENT DIRECTOR ROLE BULLETS:
${currentBullets.map((b, i) => `${i + 1}. ${b}`).join('\n')}

TASK:
1. Rewrite the Professional Summary (2-3 sentences, plain text, no bullet points) to better match the job requirements while staying truthful to the candidate's background.
2. Rewrite each Director role bullet (plain text, no bullet symbols, no markdown) to emphasise aspects most relevant to this job. Keep the same number of bullets. Each bullet should be concise (one line).

Return this exact JSON structure:
{
  "summary": "rewritten summary text here",
  "bullets": [
    "rewritten bullet 1",
    "rewritten bullet 2",
    "rewritten bullet 3",
    "rewritten bullet 4"
  ]
}`;
}

/**
 * Build a prompt asking Claude to extract the company address block and write
 * the body paragraphs of a cover letter, returned as a single JSON object.
 *
 * @param {Object} job       - { jobTitle, company, location, description }
 * @param {string} cvSummary - Candidate's tailored CV summary for context
 * @returns {string} Prompt text
 */
function buildCLBodyPrompt(job, cvSummary) {
  return `You are preparing content for a professional cover letter for a job application.

Return ONLY a valid JSON object — no markdown, no code fences, no explanation.

The object must have exactly two keys:
1. "companyBlock" — an object with three string fields extracted from the job description:
   - "name": the company name
   - "department": the department or division hiring (e.g. "Research Department", "Engineering Division"); use empty string if not mentioned
   - "location": the city and state/country where the role is based (e.g. "Boston, MA"); use empty string if not mentioned
2. "bodyParagraphs" — a variable-length array of paragraph strings (typically 3–4) forming the letter body

Example format:
{
  "companyBlock": {
    "name": "Acme Corp",
    "department": "Research Department",
    "location": "Boston, MA"
  },
  "bodyParagraphs": [
    "First paragraph text here.",
    "Second paragraph text here.",
    "Third paragraph text here."
  ]
}

JOB:
Title: ${job.jobTitle || 'N/A'}
Company: ${job.company || 'N/A'}
Location: ${job.location || 'N/A'}
Description: ${job.description || 'N/A'}

CANDIDATE CV SUMMARY:
${cvSummary || '(no summary provided)'}

For companyBlock: extract the company name, department, and location directly from the job description above.
For bodyParagraphs: write compelling, specific paragraphs that:
- Open by connecting the candidate's background to this specific role and company
- Highlight 2–3 relevant experiences or achievements that match the job requirements
- Close with enthusiasm for the role and a confident call to action
- Are professional but personable, not generic or formulaic
- Contain no markdown, no bullet points, no bold — plain prose only`;
}
