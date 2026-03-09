# JobLink — Permissions Justification

**Extension name:** JobLink
**Version:** 1.0.0
**Prepared for:** Chrome Web Store review and Google OAuth verification

---

## Overview

JobLink is a personal-use Chrome extension that helps job seekers capture job postings from LinkedIn, Indeed, and other career pages, review them in a Chrome Side Panel, and save structured copies to their own Google Drive. No data is sent to any third-party server. All job data is stored exclusively in the user's own Google Drive account.

---

## Chrome Extension Permissions

### `storage`
**Why needed:** Stores user preferences in `chrome.storage.sync` — specifically the Google Drive folder IDs the user configured during setup, their AI provider API keys, default package mode, and the Pro/licence key status. Without this permission the extension cannot remember any settings between browser sessions.

### `identity`
**Why needed:** Powers the Google OAuth 2.0 login flow via `chrome.identity.getAuthToken()`. This is the standard Chrome extension mechanism for obtaining a Google access token so the extension can call the Drive and Docs APIs on the user's behalf. No third-party identity provider is used.

### `sidePanel`
**Why needed:** JobLink's primary UI is a Chrome Side Panel that opens alongside the job posting page. This permission is required to register and display that panel. Without it, the extension has no user interface.

### `activeTab`
**Why needed:** Used to read the URL of the currently active tab so the extension knows which job page the user is viewing and can send a scrape request to the correct content script. No page content is read via `activeTab` — content reading is handled by the registered content scripts.

### `scripting`
**Why needed:** Used by the background service worker to programmatically inject content scripts into tabs that were already open before the extension was installed (cold-start injection). This ensures the scraper works on pre-loaded pages without requiring a page refresh.

### `tabs`
**Why needed:** Used to query the active tab's URL and ID so the side panel can target the correct tab when requesting a scrape and when checking Google Drive for a duplicate job record. Only the tab URL and ID are accessed — no tab content is read.

---

## Host Permissions

### `https://linkedin.com/*` and `https://*.linkedin.com/*`
**Why needed:** The LinkedIn content script (`linkedin.js`) runs on LinkedIn job pages to extract the job title, company name, location, and job description from the page DOM. This is the core scraping functionality. The extension only reads the currently visible page — it never navigates, clicks, or submits forms on LinkedIn.

### `*://indeed.com/*` and `*://*.indeed.com/*`
**Why needed:** The Indeed content script (`indeed.js`) runs on Indeed job pages for the same purpose as the LinkedIn script — read-only extraction of visible job posting data.

### `<all_urls>`
**Why needed:** A generic fallback scraper (`generic.js`) runs on any other career page (company career sites, job boards other than LinkedIn and Indeed). This allows users to save job postings from any website, not just the two primary platforms. The generic scraper uses the same read-only DOM extraction approach and only sends data when a recognisable job title and description are found. LinkedIn and Indeed are explicitly excluded from this script via `exclude_matches` in the manifest.

---

## Google OAuth Scopes

### `https://www.googleapis.com/auth/userinfo.email`
**Classification:** Non-sensitive
**Why needed:** Displays the connected Google account's email address in the extension's Settings page so the user can confirm which account is linked. The email address is shown in the UI only and is never stored or transmitted.

### `https://www.googleapis.com/auth/drive.file`
**Classification:** Sensitive
**Why needed:** Allows the extension to create and manage the files and folders it creates in the user's Google Drive — specifically the job folders, and the JSON, HTML, PDF, and Google Doc files saved within them. This scope is restricted to files created by the extension itself and does not grant access to any pre-existing Drive content.

### `https://www.googleapis.com/auth/drive.metadata.readonly`
**Classification:** Sensitive
**Why needed:** Used to search the user's Drive for existing job folders by name (duplicate detection) and to look up folder names when the user configures a folder in Settings. Read-only — no files are modified via this scope.

### `https://www.googleapis.com/auth/drive.readonly`
**Classification:** Sensitive
**Why needed:** Used to read the user's own Google Docs stored in their designated profile and template folders (e.g. CV templates, cover letter templates, candidate profile documents). The extension reads these documents to use as input for AI-powered CV and cover letter generation. No documents are read outside of the folders the user explicitly configured. Read-only — no files are modified via this scope.

### `https://www.googleapis.com/auth/drive`
**Classification:** Sensitive (Restricted)
**Why needed:** Required to move job folders between status subfolders (Preparation → Submitted → Rejected) within the user's own Drive. The Drive API's file move operation (updating a file's `parents`) requires the full `drive` scope. This scope is used exclusively on files and folders created by the extension itself, within the user's designated root folder. The extension never accesses, reads, modifies, or deletes any Drive content outside of its own designated folder structure.

### `https://www.googleapis.com/auth/documents`
**Classification:** Sensitive (Restricted)
**Why needed:** Used to read the structure of Google Doc CV and cover letter templates (to extract the current text of sections like Professional Summary and work history bullets), and to apply targeted text replacements to a copy of those templates via the Docs API `batchUpdate` method. This preserves the original document's formatting, fonts, and layout while inserting AI-tailored content. The extension only accesses documents that the user has explicitly designated as templates in Settings.

---

## Data Handling Summary

- **No backend server.** The extension makes API calls directly from the browser to Google APIs and the user's chosen AI provider (Anthropic/OpenAI/Google Gemini). No job data, profile data, or personal information passes through any server operated by the extension developer.
- **No data collection.** The extension does not collect analytics, crash reports, or usage data of any kind.
- **User-owned storage.** All saved job data lives in the user's own Google Drive account. The developer has no access to it.
- **API keys stored locally.** AI provider API keys entered by the user are stored in `chrome.storage.sync` (encrypted by Chrome, synced to the user's Google account). They are never transmitted to any server other than the respective AI provider's own API endpoint.
- **Licence key.** The optional Pro licence key is stored in `chrome.storage.sync`. It is not validated against an external server in V1 — validation is local only.
