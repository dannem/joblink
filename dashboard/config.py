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

# The Google Drive folder ID configured in the JobLink Chrome extension.
# To find it: open Drive, navigate to your root jobs folder, and copy the ID
# from the URL: drive.google.com/drive/folders/<THIS_IS_THE_ID>
# Alternatively, find it in the extension via chrome.storage.sync (DRIVE_ROOT_FOLDER_ID).
ROOT_FOLDER_ID = ''  # TODO: paste your Drive root folder ID here

# Names of the three status subfolders — must match what the extension creates.
PREPARATION_FOLDER = 'Preparation'
SUBMITTED_FOLDER = 'Submitted'
REJECTED_FOLDER = 'Rejected'

# ── Flask ──────────────────────────────────────────────────────────────────────

SECRET_KEY = 'dev-secret-key-change-before-sharing'
DEBUG = True
