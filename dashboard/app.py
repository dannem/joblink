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
        Convert an ISO 8601 timestamp string to a human-readable date.

        Example: '2026-02-23T14:35:00.000Z' → '23 Feb 2026'

        Returns the original string unchanged if it cannot be parsed.
        """
        if not iso_str:
            return ''
        try:
            dt = datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
            return dt.strftime('%-d %b %Y')
        except (ValueError, AttributeError):
            return iso_str

    return app


if __name__ == '__main__':
    application = create_app()
    application.run(debug=config.DEBUG)
