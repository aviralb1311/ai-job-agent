(function () {
  var ROOT_ID = "ai-job-agent-greenhouse-helper";

  function findForm() {
    var direct = document.querySelector("#application_form, form[action*='/applications'], form#application");
    if (direct) return direct;
    var nodes = document.querySelectorAll("[role='dialog'], dialog, form");
    for (var i = 0; i < nodes.length; i++) {
      var text = (nodes[i].innerText || nodes[i].textContent || "").toLowerCase();
      if ((text.indexOf("apply for this job") >= 0 || text.indexOf("application form") >= 0) &&
          nodes[i].querySelector("input, textarea")) return nodes[i];
    }
    return null;
  }

  function describe(field) {
    var value = [field.name, field.id, field.placeholder, field.getAttribute("aria-label"), field.autocomplete].join(" ");
    if (field.id) {
      var label = document.querySelector("label[for='" + CSS.escape(field.id) + "']");
      if (label) value += " " + label.textContent;
    }
    if (field.labels) Array.from(field.labels).forEach(function (label) { value += " " + label.textContent; });
    return value.toLowerCase();
  }

  function mount() {
    if (document.getElementById(ROOT_ID)) return;
    var host = document.createElement("div");
    host.id = ROOT_ID;
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;font:14px Arial,sans-serif";
    ["click", "pointerdown", "mousedown"].forEach(function (name) {
      host.addEventListener(name, function (event) { event.stopPropagation(); });
    });
    var root = host.attachShadow({ mode: "open" });
    var panel = document.createElement("section");
    panel.hidden = true;
    panel.style.cssText = "width:320px;max-height:65vh;overflow:auto;padding:14px;background:#fff;color:#172033;border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 4px 18px #0003;margin-bottom:8px";
    var heading = document.createElement("b"); heading.textContent = "AI Job Agent";
    var status = document.createElement("p"); status.textContent = "Load your saved profile to preview matching fields.";
    var preview = document.createElement("div");
    var load = document.createElement("button"); load.type = "button"; load.textContent = "Load profile & preview";
    var fill = document.createElement("button"); fill.type = "button"; fill.textContent = "Fill reviewed fields"; fill.disabled = true;
    [load, fill].forEach(function (button) {
      button.style.cssText = "display:block;width:100%;padding:10px;margin-top:8px;border:0;border-radius:7px;background:#1d4ed8;color:#fff;cursor:pointer";
    });
    var note = document.createElement("p");
    note.textContent = "Review every value before filling. Resume uploads and unknown questions stay manual. This helper never submits the application.";
    note.style.cssText = "font-size:11px;color:#64748b";
    panel.append(heading, status, load, preview, fill, note);
    var toggle = document.createElement("button"); toggle.type = "button"; toggle.textContent = "AI Job Agent";
    toggle.style.cssText = "padding:12px 18px;border:0;border-radius:24px;background:#1d4ed8;color:#fff;font-weight:bold;cursor:pointer";
    var approvedMatches = [];

    load.addEventListener("click", async function (event) {
      event.preventDefault(); event.stopPropagation();
      load.disabled = true; fill.disabled = true; preview.textContent = ""; status.textContent = "Loading profile…";
      try {
        var reply = await chrome.runtime.sendMessage({ type: "AI_JOB_AGENT_GET_PROFILE" });
        if (!reply || !reply.ok) throw new Error(reply && reply.error ? reply.error : "Could not load profile.");
        var profile = reply.profile;
        var parts = String(profile.fullName || "").trim().split(/\s+/);
        var first = parts.shift() || ""; var last = parts.join(" ");
        var definitions = [
          { label: "First name", value: first, test: /first.?name|given.?name/ },
          { label: "Last name", value: last, test: /last.?name|family.?name|surname/ },
          { label: "Email", value: profile.email || "", test: /email/ },
          { label: "Phone", value: profile.phone || "", test: /phone|mobile|telephone/ },
          { label: "City", value: profile.city || "", test: /city|town/ },
          { label: "State", value: profile.state || "", test: /state|province/ },
          { label: "PIN code", value: profile.pinCode || "", test: /postal|zip|pin.?code/ },
          { label: "LinkedIn", value: profile.linkedinUrl || "", test: /linkedin/ },
          { label: "GitHub", value: profile.githubUrl || "", test: /github/ },
          { label: "Portfolio", value: profile.portfolioUrl || "", test: /portfolio|personal.?website|website/ }
        ];
        var form = findForm();
        if (!form) throw new Error("Open a Greenhouse application form first.");
        approvedMatches = [];
        Array.from(form.querySelectorAll("input, textarea")).forEach(function (field) {
          var type = String(field.type || "").toLowerCase();
          if (field.disabled || field.readOnly || ["hidden", "file", "password", "submit", "button", "checkbox", "radio"].indexOf(type) >= 0) return;
          var text = describe(field);
          var match = definitions.find(function (item) { return item.value && item.test.test(text); });
          if (match) approvedMatches.push({ field: field, label: match.label, value: match.value });
        });
        if (!approvedMatches.length) {
          status.textContent = "Profile loaded, but no fields matched safely. Please fill the form manually.";
          return;
        }
        approvedMatches.forEach(function (item) {
          var row = document.createElement("p");
          row.textContent = item.label + ": " + item.value;
          row.style.cssText = "padding:6px;background:#f1f5f9;border-radius:5px";
          preview.appendChild(row);
        });
        status.textContent = "Review " + approvedMatches.length + " matched fields. Nothing has been filled yet.";
        fill.disabled = false;
      } catch (error) {
        status.textContent = error && error.message ? error.message : "Could not load profile.";
      } finally {
        load.disabled = false;
      }
    });

    fill.addEventListener("click", function (event) {
      event.preventDefault(); event.stopPropagation();
      var form = findForm();
      if (!form) { status.textContent = "The form is no longer open. Reopen it and preview again."; return; }
      var count = 0;
      approvedMatches.forEach(function (item) {
        if (!form.contains(item.field)) return;
        var prototype = item.field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        if (descriptor && descriptor.set) descriptor.set.call(item.field, item.value);
        else item.field.value = item.value;
        item.field.dispatchEvent(new Event("input", { bubbles: true }));
        item.field.dispatchEvent(new Event("change", { bubbles: true }));
        count++;
      });
      status.textContent = "Filled " + count + " reviewed fields. Check each value. Nothing was submitted.";
      fill.disabled = true;
    });

    toggle.addEventListener("click", function (event) {
      event.preventDefault(); event.stopPropagation();
      panel.hidden = !panel.hidden;
      toggle.textContent = panel.hidden ? "AI Job Agent" : "Close helper";
    });
    root.append(panel, toggle);
    document.documentElement.appendChild(host);
  }

  mount();
  new MutationObserver(function () {
    if (!document.getElementById(ROOT_ID)) mount();
  }).observe(document.documentElement, { childList: true, subtree: true });
}());
