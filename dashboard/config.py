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

# No root folder name or ID is needed here. The dashboard auto-discovers the
# JobLink root folder by searching Drive for a folder that contains all three
# status subfolders (Preparation, Submitted, Rejected). That structure is
# created automatically by the Chrome extension on its first save.

# Names of the three status subfolders — must match what the extension creates.
PREPARATION_FOLDER = 'Preparation'
SUBMITTED_FOLDER = 'Submitted'
REJECTED_FOLDER = 'Rejected'

# ── Flask ──────────────────────────────────────────────────────────────────────

SECRET_KEY = 'dev-secret-key-change-before-sharing'
DEBUG = True
