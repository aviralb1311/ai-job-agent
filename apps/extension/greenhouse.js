(() => {
  const ROOT_ID = "ai-job-agent-greenhouse-notice";
  const FORM_SELECTOR = [
    "#application_form",
    "form[action*='/applications']",
    "form#application"
  ].join(",");

  function findApplicationForm() {
    return document.querySelector(FORM_SELECTOR);
  }

  function showNotice() {
    const form = findApplicationForm();
    const existing = document.getElementById(ROOT_ID);

    if (!form) {
      existing?.remove();
      return;
    }
    if (existing) return;

    const host = document.createElement("div");
    host.id = ROOT_ID;
    host.setAttribute("role", "status");
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:320px;font:14px/1.45 Arial,sans-serif";

    const shadow = host.attachShadow({ mode: "closed" });
    const panel = document.createElement("div");
    panel.style.cssText = "padding:14px 16px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#0f172a;box-shadow:0 4px 18px rgba(15,23,42,.18)";

    const heading = document.createElement("strong");
    heading.textContent = "AI Job Agent";
    heading.style.cssText = "display:block;margin-bottom:4px;font-size:14px";

    const message = document.createElement("span");
    message.textContent = "Greenhouse application detected. Profile connection and autofill are coming next.";

    panel.append(heading, message);
    shadow.append(panel);
    document.documentElement.append(host);
  }

  showNotice();
  const observer = new MutationObserver(showNotice);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
})();