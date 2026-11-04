(() => {
  const ROOT_ID = "ai-job-agent-greenhouse-helper";
  const FORM_SELECTOR = [
    "#application_form",
    "form[action*='/applications']",
    "form#application"
  ].join(",");

  function findApplicationForm() {
    const knownForm = document.querySelector(FORM_SELECTOR);
    if (knownForm) return knownForm;

    // MyGreenhouse can render the application inside a modal with different markup.
    const candidates = document.querySelectorAll("[role='dialog'], dialog, form");
    for (const candidate of candidates) {
      const text = (candidate.innerText || candidate.textContent || "").toLowerCase();
      if (/apply for this job|application form/.test(text) &&
          candidate.querySelector("input, select, textarea")) {
        return candidate;
      }
    }
    return null;
  }

  function showHelper() {
    const form = findApplicationForm();
    const existing = document.getElementById(ROOT_ID);

    if (!form) {
      existing?.remove();
      return;
    }
    if (existing) return;

    const host = document.createElement("div");
    host.id = ROOT_ID;
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;font:14px/1.45 Arial,sans-serif";

    const shadow = host.attachShadow({ mode: "closed" });
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "display:flex;flex-direction:column;align-items:flex-end;gap:10px";

    const panel = document.createElement("section");
    panel.hidden = true;
    panel.setAttribute("aria-label", "AI Job Agent assistant");
    panel.style.cssText = "box-sizing:border-box;width:300px;padding:16px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;color:#0f172a;box-shadow:0 4px 18px rgba(15,23,42,.2)";

    const title = document.createElement("strong");
    title.textContent = "AI Job Agent";
    title.style.cssText = "display:block;font-size:16px;margin-bottom:8px";

    const status = document.createElement("p");
    status.textContent = "Greenhouse application detected.";
    status.style.cssText = "margin:0 0 8px";

    const detail = document.createElement("p");
    detail.textContent = "Your account is connected. Profile matching and reviewed autofill are the next features to enable.";
    detail.style.cssText = "margin:0;color:#475569";

    const safety = document.createElement("p");
    safety.textContent = "This helper will never submit an application for you.";
    safety.style.cssText = "margin:10px 0 0;font-size:12px;color:#475569";

    panel.append(title, status, detail, safety);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = "AI Job Agent";
    toggle.setAttribute("aria-expanded", "false");
    toggle.style.cssText = "border:0;border-radius:999px;padding:12px 18px;background:#1d4ed8;color:#fff;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(15,23,42,.22)";
    toggle.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
      toggle.textContent = panel.hidden ? "AI Job Agent" : "Close helper";
    });

    wrapper.append(panel, toggle);
    shadow.append(wrapper);
    document.documentElement.append(host);
  }

  showHelper();
  const observer = new MutationObserver(showHelper);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
})();
