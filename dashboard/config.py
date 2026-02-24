"""
Configuration for the JobLink dashboard.
All tuneable values live here — never scattered across other modules.
"""
import os

# ── Google OAuth ───────────────────────────────────────────────────────────────

# Path to the OAuth 2.0 client credentials JSON downloaded from Google Cloud
# Console → APIs & Services → Credentials → your OAuth 2.0 Client ID.
CREDENTIALS_FILE = os.path.join(os.path.dirname(__file__), 'credentials.json')

# Path where the OAuth token is cached after the first successful auth flow.
# Delete this file to force re-authentication.
TOKEN_FILE = os.path.join(os.path.dirname(__file__), 'token.json')

# Drive read-only scope is sufficient — the dashboard never writes to Drive.
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

# ── Drive folder ───────────────────────────────────────────────────────────────

# The exact name of your root jobs folder in Google Drive.
# The dashboard searches your entire Drive for a folder with this name.
# Must match the folder name character-for-character (case-sensitive).
ROOT_FOLDER_NAME = 'My_Job_Apps'

# Names of the three status subfolders — must match what the extension creates.
PREPARATION_FOLDER = 'Preparation'
SUBMITTED_FOLDER = 'Submitted'
REJECTED_FOLDER = 'Rejected'

# ── Flask ──────────────────────────────────────────────────────────────────────

SECRET_KEY = 'dev-secret-key-change-before-sharing'
DEBUG = True
