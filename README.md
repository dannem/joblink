# JobLink

A Chrome extension that captures job postings from LinkedIn, Indeed, and any career page, displays them in a Chrome Side Panel for review, and saves structured copies to your own Google Drive — with optional AI-powered CV and cover letter generation.

---

## Features

### Free
- **One-click capture** — scrapes job title, company, location, and full description from the current page
- **Side Panel UI** — review and edit captured fields without leaving the job posting
- **Save to Drive** — saves four files per job to your Google Drive: `job_info.json`, `job_summary.html`, `job_summary.pdf`, and a formatted Google Doc
- **Status tracking** — organises jobs into Preparation, Submitted, and Rejected folders
- **In-extension dashboard** — sortable, filterable table of all saved jobs with bulk actions and job detail view
- **Duplicate detection** — warns when you open a job you've already saved
- **Works everywhere** — dedicated scrapers for LinkedIn and Indeed, plus a generic fallback for any careers page

### Pro ($4.99/month)
- **Evaluate Fit** — AI scores how well your profile matches a job (0–100) with a breakdown of strengths, gaps, and a recommendation
- **Prepare Package** — AI generates a tailored CV and cover letter in your own Google Doc templates, saves them directly to your Drive
- **Academic Package** — generates CV, Cover Letter, Research Statement, Diversity Statement, and Teaching Statement in one click
- **Multi-model support** — choose from Claude, Gemini, or GPT-4o models

---

## Requirements

- Chrome 114 or later (Side Panel API)
- A Google account (for Google Drive storage)
- For Pro features: an API key from Anthropic, OpenAI, or Google (Gemini) — or a JobLink Pro licence key

---

## Installation (Developer Mode)

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `joblink/` folder
5. The JobLink icon appears in your toolbar

---

## First-Time Setup

1. Click the JobLink icon to open the Side Panel
2. Click the ⚙️ settings icon to open the Setup page
3. Click **Connect Google Drive** and sign in
4. Choose (or create) a root folder in your Drive where jobs will be saved
5. Optionally configure:
   - **CV Templates folder** — Google Docs used as CV templates for AI tailoring
   - **Cover Letter Templates folder** — Google Docs used as cover letter templates
   - **My Profile folder** — your candidate profile documents (CV, bio, etc.) read by AI
   - **AI Provider Keys** — Anthropic, OpenAI, or Gemini API keys for Pro features
   - **Default AI Model** — which model to use for Prepare Package
   - **Default Package** — CV only / Cover Letter only / Both

---

## Usage

### Saving a job
1. Navigate to a job posting on LinkedIn, Indeed, or any career page
2. Open the Side Panel (click the JobLink icon or use the Chrome side panel button)
3. The job fields populate automatically
4. Edit any fields if needed
5. Click **Save to Drive** — a folder is created in your configured root folder

### Prepare Package (Pro)
1. Save or navigate to a job posting
2. Select the package type (CV only / Cover Letter only / Both / Academic)
3. Select the AI model
4. Click **📦 Prepare Package**
5. The extension reads your profile and templates, generates tailored documents, and saves them to your Drive's Submitted folder

### Dashboard
- Click **Open Dashboard** in the Side Panel to open the full job management view
- Sort and filter by status, company, location, date, salary, or type
- Click any job row to see the full detail panel, open Drive documents, move status, or add notes
- Use checkboxes for bulk moves or bulk reject

---

## Google Drive Structure

```
[Your root folder]/
├── Preparation/
│   └── [Company] - [Job Title]/
│       ├── job_info.json
│       ├── job_summary.html
│       ├── job_summary.pdf
│       └── [Job Title] Summary (Google Doc)
├── Submitted/
│   └── [Company] - [Job Title]/
│       ├── job_info.json
│       ├── job_summary.html
│       ├── job_summary.pdf
│       ├── [Job Title] Summary (Google Doc)
│       ├── CV — [Job Title] (Google Doc + PDF)
│       └── Cover Letter — [Job Title] (Google Doc + PDF)
└── Rejected/
    └── [Company] - [Job Title]/
        └── ...
```

---

## AI Models Supported

| Provider  | Models |
|-----------|--------|
| Anthropic | Claude Sonnet 4.6, Claude Haiku 4.5 |
| Google    | Gemini 2.5 Pro, Gemini 2.5 Flash |
| OpenAI    | GPT-4o, GPT-4o Mini, GPT-4 Turbo, o1, o1-mini, o3-mini |

API keys are stored locally in `chrome.storage.sync`. They are never sent to any server other than the respective AI provider.

---

## Architecture

| Component | Technology |
|-----------|------------|
| Extension framework | Chrome Manifest V3 |
| Language | Vanilla JavaScript — no frameworks, no build tools |
| UI | Plain HTML + CSS (Side Panel + Setup page + Dashboard) |
| Authentication | Chrome Identity API (Google OAuth 2.0) |
| Settings storage | `chrome.storage.sync` |
| Job data storage | Google Drive REST API |
| PDF generation | jsPDF (bundled locally) |
| Word doc reading | mammoth.js (bundled locally) |
| PDF reading | PDF.js (bundled locally) |

All scraping, Drive, and UI logic is kept in strictly separate files. No data passes through any developer-operated server.

---

## Privacy

- All job data is saved to **your own** Google Drive account
- No analytics, telemetry, or usage data is collected
- API keys are stored locally and sent only to the respective AI provider
- See [`PERMISSIONS_JUSTIFICATION.md`](PERMISSIONS_JUSTIFICATION.md) for a full breakdown of every permission and OAuth scope

Privacy policy: https://dannem.github.io/joblink/privacy.html

---

## Licence

Personal use. Not for redistribution.
