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

### 3 — Set your Drive root folder name

Open `dashboard/config.py` and set `ROOT_FOLDER_NAME` to the exact name of
your root jobs folder in Google Drive:

```python
ROOT_FOLDER_NAME = 'My_Job_Apps'
```

The dashboard searches your entire Drive for a folder with this name — no
folder ID needed. The name must match **exactly**, including capitalisation
and any underscores or spaces (e.g. `My_Job_Apps` ≠ `my_job_apps`).

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
| `config.py` | All configuration (credentials path, root folder name, status folder names) |
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
