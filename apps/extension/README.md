# AI Job Agent Chrome Extension

The Manifest V3 extension currently supports Greenhouse application detection and secure account pairing.

## Load or update it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked** (first install), or click **Reload** after pulling updates.
4. Choose the `apps/extension` folder from this repository.

For local development, `config.js` uses `http://localhost:4000`. To use a hosted API, set `apiBaseUrl` in `config.js` to its HTTPS URL and add that API host to `host_permissions` in `manifest.json` before reloading the extension. Keep only the specific API host needed; do not add API secrets to the extension.

## Connect your account

1. Start the AI Job Agent API and web app locally.
2. Sign in to AI Job Agent at `http://localhost:5173`.
3. In your candidate profile, choose **Generate extension pairing code**.
4. Click the AI Job Agent toolbar icon.
5. Enter the 12-character one-time code and choose **Connect account**.

The pairing code expires after five minutes and can be used once. The extension access token expires after seven days. Use **Disconnect** in the popup to remove the token from this browser.

## Current capabilities and limitations

- Detects supported Greenhouse application forms.
- Pairs with the signed-in AI Job Agent account using a one-time code.
- Retrieves only contact fields and account email through a scoped extension endpoint.
- Does not read resume contents, application drafts, or job tracker data.
- Autofill is not enabled yet; the next milestone adds field preview and user-triggered fill.
- Never uploads a resume, clicks application buttons, bypasses verification, or submits an application.
