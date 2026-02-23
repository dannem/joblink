# JobLink Dashboard

A standalone Python/Flask web app for reviewing job applications saved by the
JobLink Chrome extension. Reads directly from Google Drive — no database needed.

## Prerequisites

- Python 3.10+
- The JobLink Chrome extension installed and at least one job saved to Drive
- A Google Cloud project with the **Google Drive API** enabled
- An **OAuth 2.0 Desktop client** credential downloaded from Google Cloud Console

## Setup

### 1 — Install Python dependencies

```bash
cd dashboard
pip install -r requirements.txt
```

### 2 — Download OAuth credentials

1. Open [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**
2. Click your OAuth 2.0 Client ID (type: Desktop app) → **Download JSON**
3. Rename the file to `credentials.json` and place it in the `dashboard/` folder

> If you haven't created a Desktop OAuth client yet: **Create Credentials** →
> **OAuth client ID** → Application type: **Desktop app** → Download.

### 3 — Set your Drive root folder ID

Open `dashboard/config.py` and paste your root folder ID into `ROOT_FOLDER_ID`:

```python
ROOT_FOLDER_ID = 'your-folder-id-here'
```

To find the ID: open Google Drive, navigate to the root jobs folder you chose
during JobLink setup, and copy the ID from the URL:
```
https://drive.google.com/drive/folders/<THIS_IS_THE_ID>
```

Alternatively, find it in the extension's storage — open DevTools on any
extension page and run:
```js
chrome.storage.sync.get('DRIVE_ROOT_FOLDER_ID', console.log)
```

### 4 — Run the app

```bash
python app.py
```

On **first run** a browser tab opens for Google OAuth consent. After approving,
the token is saved to `token.json` — subsequent runs skip the browser step.

The dashboard is available at **http://localhost:5000**.

---

## Drive folder structure

The dashboard reads jobs from three subfolders created automatically by the
Chrome extension on first save:

```
[Root folder]/
├── Preparation/    ← jobs being actively prepared
│   └── [Company] - [Job Title]/
│       └── job_info.json
├── Submitted/      ← jobs already applied for
└── Rejected/       ← jobs ruled out
```

**Status is read-only.** It reflects which Drive subfolder a job lives in.
To change a job's status, drag its folder in Google Drive and refresh the dashboard.

---

## File structure

| File | Purpose |
|---|---|
| `app.py` | Flask app factory and entry point |
| `config.py` | All configuration (credentials path, folder ID, folder names) |
| `drive_service.py` | Google Drive API wrapper — all Drive calls live here |
| `routes.py` | Flask route handlers (job list, job detail) |
| `templates/base.html` | Shared page layout |
| `templates/jobs.html` | Job list page |
| `templates/job_detail.html` | Job detail page with AI provider selector |
| `static/style.css` | Plain CSS — no frontend frameworks |
| `requirements.txt` | Python dependencies |

---

## Security notes

- `credentials.json` and `token.json` contain sensitive OAuth data.
  Both are listed in `.gitignore` and must never be committed to the repo.
- `config.py`'s `SECRET_KEY` should be changed to a random value if you
  expose the dashboard on a network beyond localhost.
- The dashboard requests `drive.readonly` scope only — it cannot modify
  or delete any files in your Drive.
