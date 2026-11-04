const API_BASE = "http://localhost:4000";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "AI_JOB_AGENT_GET_PROFILE") return false;

  (async () => {
    try {
      const saved = await chrome.storage.local.get("extensionAccessToken");
      const token = saved.extensionAccessToken;
      if (!token) throw new Error("Extension is not connected. Pair it from the toolbar menu.");
      const response = await fetch(API_BASE + "/api/extension/profile", {
        headers: { Authorization: "Bearer " + token }
      });
      const body = await response.json();
      if (!response.ok || !body.data) throw new Error(body.error || "Could not load your profile.");
      sendResponse({ ok: true, profile: body.data });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not load profile." });
    }
  })();

  return true;
});
