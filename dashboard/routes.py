"""
Flask route handlers for the JobLink dashboard.

Routes:
    GET /           — job list page (all jobs across all status folders)
    GET /job/<id>   — job detail page (single job by Drive folder ID)
"""
from flask import Blueprint, render_template, abort, current_app

from drive_service import DriveService

jobs_bp = Blueprint('jobs', __name__)


def _get_drive_service():
    """Instantiate a DriveService using the credentials stored on the app."""
    return DriveService(current_app.config['DRIVE_CREDS'])


@jobs_bp.route('/')
def job_list():
    """
    Render the jobs list page.

    Fetches all jobs from Preparation, Submitted, and Rejected subfolders
    and passes them to the template sorted by date (newest first).
    """
    drive = _get_drive_service()
    jobs = drive.get_all_jobs()
    return render_template('jobs.html', jobs=jobs)


@jobs_bp.route('/job/<folder_id>')
def job_detail(folder_id):
    """
    Render the detail page for a single job.

    Reads job_info.json for the job data, then resolves the status label by
    checking which status subfolder (Preparation/Submitted/Rejected) contains
    the folder. The status is added to the job dict before rendering.

    Args:
        folder_id: the Google Drive folder ID for the job (from the list page URL)

    Returns 404 if the folder cannot be read or job_info.json is missing.
    """
    drive = _get_drive_service()
    job = drive.get_job_by_folder_id(folder_id)
    if job is None:
        abort(404)
    job['status'] = drive.get_job_status(folder_id) or 'Unknown'
    return render_template('job_detail.html', job=job)
