# AI Job Agent Chrome Extension

This is the first Phase 2 milestone. Version 0.1.0 only detects Greenhouse application forms and displays a small status notice.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked**.
4. Choose the `apps/extension` folder from this repository.
5. Open a Greenhouse-hosted job application page.

The extension should show an **AI Job Agent** notice when it recognises an application form.

## Current limitations

- Detection only; it does not read your account or candidate profile.
- It does not fill fields, upload files, click buttons, or submit applications.
- Profile access will be added through a separate, authenticated connection in a later milestone.
