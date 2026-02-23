"""
Google Drive access layer for the JobLink dashboard.

All Drive API calls are isolated here. Nothing outside this module
should import google-api-python-client or google-auth directly.

Public surface:
    get_credentials()       — load / refresh / create OAuth credentials
    DriveService(creds)     — thin wrapper around the Drive v3 API client
        .get_all_jobs()     — read jobs from all three status subfolders
        .get_job_by_folder_id(folder_id) — read one job by its folder ID
"""
import json
import os

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

import config


def get_credentials():
    """
    Load OAuth credentials from token.json, refreshing if expired.
    If no token exists, opens a local browser window to complete the
    OAuth flow and saves the resulting token to token.json.

    Returns:
        google.oauth2.credentials.Credentials
    Raises:
        FileNotFoundError: if credentials.json is missing
        google.auth.exceptions.TransportError: on network failure
    """
    creds = None

    if os.path.exists(config.TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(config.TOKEN_FILE, config.SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                config.CREDENTIALS_FILE, config.SCOPES
            )
            creds = flow.run_local_server(port=0)

        with open(config.TOKEN_FILE, 'w') as token_file:
            token_file.write(creds.to_json())

    return creds


class DriveService:
    """
    Read-only wrapper around the Google Drive v3 API.

    Responsibilities:
        - Listing folders and files under the configured root
        - Reading job_info.json from job folders
        - Assembling job records augmented with their status labels

    This class never writes to Drive.
    """

    def __init__(self, creds):
        """
        Args:
            creds: google.oauth2.credentials.Credentials
        """
        self._svc = build('drive', 'v3', credentials=creds)

    # ── Low-level helpers ──────────────────────────────────────────────────────

    def _list_folders(self, parent_id):
        """
        Return all non-trashed folders directly inside parent_id.

        Args:
            parent_id (str): Drive folder ID

        Returns:
            list[dict]: each dict has 'id' and 'name'
        """
        query = (
            f"'{parent_id}' in parents "
            "and mimeType = 'application/vnd.google-apps.folder' "
            "and trashed = false"
        )
        result = self._svc.files().list(
            q=query,
            fields='files(id, name)',
            orderBy='name',
        ).execute()
        return result.get('files', [])

    def _find_folder(self, parent_id, name):
        """
        Return the first child folder with the given exact name, or None.

        Args:
            parent_id (str): Drive folder ID to search within
            name (str): exact folder name to find

        Returns:
            dict | None: {'id': ..., 'name': ...} or None
        """
        for folder in self._list_folders(parent_id):
            if folder['name'] == name:
                return folder
        return None

    def _list_files(self, folder_id):
        """
        Return all non-trashed, non-folder files directly inside folder_id.

        Args:
            folder_id (str): Drive folder ID

        Returns:
            list[dict]: each dict has 'id' and 'name'
        """
        query = (
            f"'{folder_id}' in parents "
            "and mimeType != 'application/vnd.google-apps.folder' "
            "and trashed = false"
        )
        result = self._svc.files().list(
            q=query,
            fields='files(id, name)',
        ).execute()
        return result.get('files', [])

    def _read_file(self, file_id):
        """
        Download and return the UTF-8 text content of a Drive file.

        Args:
            file_id (str): Drive file ID

        Returns:
            str: decoded file content

        Raises:
            HttpError: if the Drive API returns an error
        """
        content = self._svc.files().get_media(fileId=file_id).execute()
        return content.decode('utf-8')

    def _read_job_info(self, folder_id):
        """
        Find job_info.json in folder_id and return its parsed contents.

        Args:
            folder_id (str): Drive folder ID for the job

        Returns:
            dict | None: parsed job data, or None if the file is missing or invalid
        """
        for f in self._list_files(folder_id):
            if f['name'] == 'job_info.json':
                try:
                    return json.loads(self._read_file(f['id']))
                except (json.JSONDecodeError, HttpError, UnicodeDecodeError):
                    return None
        return None

    # ── Public API ─────────────────────────────────────────────────────────────

    def get_all_jobs(self):
        """
        Read every job from the Preparation, Submitted, and Rejected subfolders.

        Jobs are augmented with two extra keys before being returned:
            'status'    — the display label derived from the subfolder name
            'folder_id' — the Drive folder ID (used to build the detail URL)

        Subfolders that don't exist in Drive are silently skipped.

        Returns:
            list[dict]: job records sorted by scraped date descending
        """
        status_map = [
            (config.PREPARATION_FOLDER, 'Preparation'),
            (config.SUBMITTED_FOLDER,   'Submitted'),
            (config.REJECTED_FOLDER,    'Rejected'),
        ]

        jobs = []
        for folder_name, status_label in status_map:
            status_folder = self._find_folder(config.ROOT_FOLDER_ID, folder_name)
            if not status_folder:
                continue

            for job_folder in self._list_folders(status_folder['id']):
                job_info = self._read_job_info(job_folder['id'])
                if job_info:
                    job_info['status']    = status_label
                    job_info['folder_id'] = job_folder['id']
                    jobs.append(job_info)

        # Sort newest first; fall back to empty string for missing scrapedAt
        jobs.sort(key=lambda j: j.get('scrapedAt') or '', reverse=True)
        return jobs

    def get_job_by_folder_id(self, folder_id):
        """
        Read and return a single job's data from its Drive folder.

        Args:
            folder_id (str): Drive folder ID for the job

        Returns:
            dict | None: job data augmented with 'folder_id', or None if not found
        """
        job_info = self._read_job_info(folder_id)
        if job_info is not None:
            job_info['folder_id'] = folder_id
        return job_info
