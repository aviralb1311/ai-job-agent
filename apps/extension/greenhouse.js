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

    const candidates = document.querySelectorAll("[role='dialog'], dialog, form");
    for (const candidate of candidates) {
      const text = (candidate.innerText || candidate.textContent || "").toLowerCase();
      if (/apply for this job|application form/.test(text) &&
          candidate.querySelector("input, select, textarea")) return candidate;
    }
    return null;
  }

  function mountHelper() {
    if (document.getElementById(ROOT_ID)) return;

    const host = document.createElement("div");
    host.id = ROOT_ID;
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;font:14px/1.45 Arial,sans-serif";
    for (const eventName of ["pointerdown", "mousedown", "click"]) {
      host.addEventListener(eventName, event => event.stopPropagation());
    }

    const shadow = host.attachShadow({ mode: "open" });
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "display:flex;flex-direction:column;align-items:flex-end;gap:10px";

    const panel = document.createElement("section");
    panel.hidden = true;
    panel.style.cssText = "box-sizing:border-box;width:310px;padding:16px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;color:#0f172a;box-shadow:0 4px 18px rgba(15,23,42,.2)";
    const title = document.createElement("strong");
    title.textContent = "AI Job Agent";
    title.style.cssText = "display:block;font-size:16px;margin-bottom:8px";
    const status = document.createElement("p");
    status.style.cssText = "margin:0 0 8px";
    const detail = document.createElement("p");
    detail.style.cssText = "margin:0;color:#475569";
    const safety = document.createElement("p");
    safety.textContent = "You review all suggested values. This helper never submits an application.";
    safety.style.cssText = "margin:10px 0 0;font-size:12px;color:#475569";
    panel.append(title, status, detail, safety);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = "AI Job Agent";
    toggle.setAttribute("aria-expanded", "false");
    toggle.style.cssText = "border:0;border-radius:999px;padding:12px 18px;background:#1d4ed8;color:#fff;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(15,23,42,.22)";
    toggle.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const opening = panel.hidden;
      panel.hidden = !opening;
      toggle.setAttribute("aria-expanded", String(opening));
      toggle.textContent = opening ? "Close helper" : "AI Job Agent";
      const detected = Boolean(findApplicationForm());
      status.textContent = detected ? "Greenhouse application form detected." : "AI Job Agent is active on MyGreenhouse.";
      detail.textContent = detected
        ? "Your account connection is ready. Profile matching and reviewed autofill are the next features."
        : "Open a job application form to let the helper detect its fields.";
    });

    wrapper.append(panel, toggle);
    shadow.append(wrapper);
    document.documentElement.append(host);
  }

  mountHelper();
  const observer = new MutationObserver(() => {
    if (!document.getElementById(ROOT_ID)) mountHelper();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
})();