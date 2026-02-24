"""
JobLink dashboard — Flask application entry point.

Creates the Flask app, registers the Jinja2 date filter, loads Google Drive
credentials, and starts the development server.

Usage:
    python app.py
"""
from datetime import datetime, timezone

from flask import Flask

import config
from drive_service import get_credentials
from routes import jobs_bp


def create_app():
    """
    Application factory.

    Loads Drive credentials (running the OAuth browser flow on first run),
    registers the jobs Blueprint, and attaches the format_date template filter.

    Returns:
        Flask: configured application instance
    """
    app = Flask(__name__)
    app.secret_key = config.SECRET_KEY
    app.config['DEBUG'] = config.DEBUG

    # Obtain (or refresh) Drive credentials once at startup.
    # On first run this opens a browser tab for OAuth consent.
    app.config['DRIVE_CREDS'] = get_credentials()

    app.register_blueprint(jobs_bp)

    @app.template_filter('format_date')
    def format_date(iso_str):
        """
        Convert an ISO 8601 timestamp string to a human-readable date/time.

        Example: '2026-02-23T23:24:38.330Z' → 'Feb 23, 2026 at 11:24 PM'

        Tries parsing with milliseconds first, then without.
        Returns 'Unknown date' if the string is missing or cannot be parsed.
        """
        if not iso_str:
            return 'Unknown date'
        try:
            clean = iso_str.rstrip('Z')
            try:
                dt = datetime.strptime(clean, '%Y-%m-%dT%H:%M:%S.%f')
            except ValueError:
                dt = datetime.strptime(clean, '%Y-%m-%dT%H:%M:%S')
            return f"{dt.strftime('%b')} {dt.day}, {dt.year} at {dt.strftime('%I:%M %p')}"
        except (ValueError, AttributeError):
            return 'Unknown date'

    return app


if __name__ == '__main__':
    application = create_app()
    application.run(debug=config.DEBUG)
