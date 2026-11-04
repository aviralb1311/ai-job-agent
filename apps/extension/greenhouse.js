(function () {
  var ROOT_ID = "ai-job-agent-greenhouse-helper";

  function findApplicationForm() {
    var selectors = "#application_form, form[action*='/applications'], form#application";
    var knownForm = document.querySelector(selectors);
    if (knownForm) return knownForm;

    var candidates = document.querySelectorAll("[role='dialog'], dialog, form");
    for (var i = 0; i < candidates.length; i += 1) {
      var candidate = candidates[i];
      var text = (candidate.innerText || candidate.textContent || "").toLowerCase();
      if ((text.indexOf("apply for this job") !== -1 || text.indexOf("application form") !== -1) &&
          candidate.querySelector("input, select, textarea")) {
        return candidate;
      }
    }
    return null;
  }

  function mountHelper() {
    if (document.getElementById(ROOT_ID)) return;

    var host = document.createElement("div");
    host.id = ROOT_ID;
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;font:14px/1.45 Arial,sans-serif";
    ["pointerdown", "mousedown", "click"].forEach(function (eventName) {
      host.addEventListener(eventName, function (event) {
        event.stopPropagation();
      });
    });

    var shadow = host.attachShadow({ mode: "open" });
    var wrapper = document.createElement("div");
    wrapper.style.cssText = "display:flex;flex-direction:column;align-items:flex-end;gap:10px";

    var panel = document.createElement("section");
    panel.hidden = true;
    panel.style.cssText = "box-sizing:border-box;width:310px;padding:16px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;color:#0f172a;box-shadow:0 4px 18px rgba(15,23,42,.2)";

    var title = document.createElement("strong");
    title.textContent = "AI Job Agent";
    title.style.cssText = "display:block;font-size:16px;margin-bottom:8px";

    var status = document.createElement("p");
    status.style.cssText = "margin:0 0 8px";

    var detail = document.createElement("p");
    detail.style.cssText = "margin:0;color:#475569";

    var safety = document.createElement("p");
    safety.textContent = "You review all suggested values. This helper never submits an application.";
    safety.style.cssText = "margin:10px 0 0;font-size:12px;color:#475569";
    panel.appendChild(title);
    panel.appendChild(status);
    panel.appendChild(detail);
    panel.appendChild(safety);

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = "AI Job Agent";
    toggle.setAttribute("aria-expanded", "false");
    toggle.style.cssText = "border:0;border-radius:999px;padding:12px 18px;background:#1d4ed8;color:#fff;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(15,23,42,.22)";
    toggle.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();

      var opening = panel.hidden;
      panel.hidden = !opening;
      toggle.setAttribute("aria-expanded", String(opening));
      toggle.textContent = opening ? "Close helper" : "AI Job Agent";

      var detected = Boolean(findApplicationForm());
      status.textContent = detected ? "Greenhouse application form detected." : "AI Job Agent is active on MyGreenhouse.";
      detail.textContent = detected
        ? "Your account connection is ready. Profile matching and reviewed autofill are the next features."
        : "Open a job application form to let the helper detect its fields.";
    });

    wrapper.appendChild(panel);
    wrapper.appendChild(toggle);
    shadow.appendChild(wrapper);
    document.documentElement.appendChild(host);
  }

  mountHelper();

  var observer = new MutationObserver(function () {
    if (!document.getElementById(ROOT_ID)) mountHelper();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("pagehide", function () {
    observer.disconnect();
  }, { once: true });
}());