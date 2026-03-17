# JobLink Bug Log

A record of bugs encountered, diagnosed, and resolved during development.
Use this to avoid re-introducing known issues in future sessions.

---

## BUG-001 — Dashboard shows empty despite jobs existing in Drive
**Status:** Resolved
**Date:** 2026-03-15
**Symptom:** Dashboard loads but shows 0 jobs in all three sections
**Root cause:** handleSaveToDrive() in service-worker.js was changed to save the job JSON file as "Post - JobTitle (Company).json" via jobPostingFileName(), but readJobFromFolder() in dashboard.js looks for "job_info.json" exactly.
**Fix:** Restore hardcoded filenames in handleSaveToDrive():
- job_info.json (was jobPostingFileName(job) + '.json')
- job_summary.html (was jobPostingFileName(job) + '.html')
- job_summary.pdf (was jobPostingFileName(job) + '.pdf')
**File:** background/service-worker.js
**Commit:** c968411
**Rule:** NEVER change the filenames job_info.json, job_summary.html, job_summary.pdf — the dashboard depends on these exact names.

---

## BUG-002 — Dashboard broken in Edge (getAuthToken not supported)
**Status:** Resolved
**Date:** 2026-03-16
**Symptom:** "This API is not supported on Microsoft Edge" when opening dashboard
**Root cause:** dashboard.js getAuthToken() used chrome.identity.getAuthToken() which is Chrome-only.
**Fix:** Added Edge detection in dashboard.js getAuthToken() — Edge uses getOAuthToken(true) from helpers.js, Chrome keeps original chrome.identity.getAuthToken() path.
**File:** dashboard/dashboard.js
**Commit:** 40a1fb3
**Rule:** dashboard.js must detect Chrome vs Edge. Chrome uses chrome.identity.getAuthToken(). Edge uses getOAuthToken(true) from helpers.js.

---

## BUG-003 — Edge OAuth not working in sidepanel/setup
**Status:** Resolved
**Date:** 2026-03-14
**Symptom:** "This API is not supported on Microsoft Edge" when clicking Connect Google Drive
**Root cause:** chrome.identity.getAuthToken() is Chrome-only.
**Fix:** Added cross-browser getOAuthToken() helper in utils/helpers.js. Requires separate Web application OAuth client in Google Cloud Console with chromiumapp.org redirect URI.
**Files:** utils/helpers.js, setup/setup.js, background/service-worker.js
**Important:** Edge OAuth client ID: 406710056933-s0p707igu50ij1h6ia8ev542odvad00s.apps.googleusercontent.com. When published to Chrome Web Store, register the new extension ID as an additional redirect URI.
**Rule:** Always use getOAuthToken() in new code needing tokens, EXCEPT dashboard.js which has its own Edge detection.

---

## BUG-004 — Folder picker not showing all Drive folders (legacy 0B... IDs)
**Status:** Partially resolved — Google platform limitation
**Date:** 2026-03-15
**Symptom:** Folder picker missing folders that exist in Drive
**Root cause:** Folders created with old Drive sync client have legacy 0B... format IDs. Cannot be listed via Drive API v3 — returns 404.
**Fix:** Added 404 fallback with supportsAllDrives=true. Changed scope to drive.readonly.
**Workaround for users:** Move affected folders in Google Drive (right-click → Move to → same location) to re-parent with modern ID.
**Rule:** Legacy 0B... Drive folder IDs cannot be traversed via API v3. Do not attempt to fix with API parameters.

---

## BUG-005 — Application Materials folders not persisting
**Status:** Resolved
**Date:** 2026-03-15
**Symptom:** CV/CL/Profile folder selections disappeared after closing Settings
**Root cause:** Storage keys existed in setup.js but not registered in STORAGE_KEYS in helpers.js.
**Fix:** Added all keys to STORAGE_KEYS and DEFAULT_STORAGE. Names saved at save time.
**Files:** utils/helpers.js, setup/setup.js
**Rule:** Every storage key MUST be registered in STORAGE_KEYS in helpers.js. Never use raw strings as storage keys.

---

## BUG-006 — Gemini 1.5 models retired
**Status:** Resolved
**Date:** 2026-03-15
**Symptom:** Gemini 1.5 Flash and 1.5 Pro in dropdown — both retired by Google
**Fix:** Updated to Gemini 3 Flash, 3.1 Pro, 3.1 Flash-Lite, 2.5 Flash
**Files:** utils/ai-helpers.js, sidepanel/sidepanel.js, sidepanel/sidepanel.html, setup/setup.js
**Rule:** Check https://ai.google.dev/gemini-api/docs/models before updating Gemini model IDs.

---

## BUG-007 — Licence key validation is a stub (accepts any string)
**Status:** Known issue — fix before launch
**Date:** 2026-03-15
**Root cause:** handleActivateLicence() accepts any key without server validation (V1 stub)
**Fix needed:** Replace with real Lemon Squeezy API validation before Chrome Web Store submission.
**File:** setup/setup.js → handleActivateLicence()
**Rule:** Do not ship without real licence validation.

---

## BUG-008 — Drive connection lost after browser restart
**Status:** Resolved
**Date:** 2026-03-15
**Symptom:** Settings showed "Connect Google Drive" button instead of connected
email after restarting the browser
**Root cause:** OAuth token was stored only in chrome.storage.session which is
cleared when the browser closes. The connected email was never persisted.
**Fix:** Added CONNECTED_EMAIL storage key to chrome.storage.sync. On page load,
tryRestoreDriveConnection() reads the stored email and shows the connected state
immediately, then attempts a silent background token refresh. handleOpenFolderPicker()
re-auths silently if token has expired.
**Files:** utils/helpers.js, setup/setup.js
**Rule:** Always persist user-visible connection state (like email) to
chrome.storage.sync, not session. Session storage is cleared on browser restart.

---

## BUG-009 — Check Status button fails in Edge
**Status:** Resolved
**Date:** 2026-03-17
**Symptom:** "Could not check — This API is not supported on Microsoft Edge" when clicking Check Status in the side panel
**Root cause:** handleCheckStatus() in sidepanel.js used chrome.identity.getAuthToken() directly instead of the cross-browser getOAuthToken() helper.
**Fix:** Replaced the inline chrome.identity.getAuthToken() Promise wrapper in handleCheckStatus() with getOAuthToken(false).
**File:** sidepanel/sidepanel.js
**Commit:** b26761f
**Rule:** Never use chrome.identity.getAuthToken() directly in sidepanel.js. Always use getOAuthToken() from helpers.js. See also BUG-003 and BUG-004.
