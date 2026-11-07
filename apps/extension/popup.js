const API_BASE = globalThis.AI_JOB_AGENT_CONFIG.apiBaseUrl.replace(/\/+$/, "");

const codeInput = document.getElementById("pairing-code");
const connectButton = document.getElementById("connect-button");
const disconnectButton = document.getElementById("disconnect-button");
const statusNode = document.getElementById("connection-status");
const messageNode = document.getElementById("message");

function showMessage(message, isError = false) {
  messageNode.textContent = message;
  messageNode.style.color = isError ? "#b91c1c" : "#166534";
}

async function readSavedToken() {
  const saved = await chrome.storage.local.get("extensionAccessToken");
  return typeof saved.extensionAccessToken === "string" ? saved.extensionAccessToken : "";
}

async function refreshConnectionStatus() {
  const token = await readSavedToken();
  if (!token) {
    statusNode.textContent = "Not connected to your account.";
    return;
  }
  try {
    const response = await fetch(API_BASE + "/api/extension/profile", {
      headers: { Authorization: "Bearer " + token }
    });
    if (!response.ok) throw new Error("Connection expired");
    const body = await response.json();
    statusNode.textContent = "Connected" + (body.data?.email ? " as " + body.data.email : "") + ".";
  } catch {
    await chrome.storage.local.remove("extensionAccessToken");
    statusNode.textContent = "Connection expired. Pair the extension again.";
  }
}

connectButton.addEventListener("click", async () => {
  const code = codeInput.value.trim().toUpperCase();
  if (!/^[A-F0-9]{12}$/.test(code)) {
    showMessage("Enter the 12-character code from your AI Job Agent profile.", true);
    return;
  }
  connectButton.disabled = true;
  showMessage("Connecting…");
  try {
    const response = await fetch(API_BASE + "/api/extension/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    const body = await response.json();
    if (!response.ok || !body.data?.accessToken) throw new Error(body.error || "Could not connect");
    await chrome.storage.local.set({ extensionAccessToken: body.data.accessToken });
    codeInput.value = "";
    await refreshConnectionStatus();
    showMessage("Your extension is securely connected.");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Could not connect. Check that the AI Job Agent API is running.", true);
  } finally {
    connectButton.disabled = false;
  }
});

disconnectButton.addEventListener("click", async () => {
  await chrome.storage.local.remove("extensionAccessToken");
  statusNode.textContent = "Not connected to your account.";
  showMessage("Extension disconnected from your account.");
});

void refreshConnectionStatus();
