(function () {
  "use strict";

  var bootstrapNode = document.getElementById("pleiades-rasa-bootstrap");
  var host = document.getElementById("pleiades-rasa-frame");
  if (!bootstrapNode || !host) return;

  var bootstrap;
  try {
    bootstrap = JSON.parse(bootstrapNode.textContent || "");
  } catch {
    return;
  }

  var botKey = String(bootstrap.botKey || "");
  var parentOrigin = String(bootstrap.parentOrigin || "");
  var sessionToken = String(bootstrap.sessionToken || "");
  var config = bootstrap.config || {};
  var locations = Array.isArray(config.locations)
    ? config.locations.filter(validLocation)
    : [];
  if (
    bootstrap.version !== 1 ||
    !/^bot_[A-Za-z0-9_-]{20,80}$/.test(botKey) ||
    !exactOrigin(parentOrigin) ||
    !/^[A-Za-z0-9_-]{43,64}$/.test(sessionToken) ||
    locations.length < 1 ||
    locations.length > 12
  ) {
    return;
  }

  var isFrench = config.locale === "fr";
  var position = config.position === "left" ? "left" : "right";
  var color = /^#[0-9a-f]{6}$/i.test(String(config.primaryColor))
    ? String(config.primaryColor)
    : "#7657e8";
  var copy = isFrench
    ? {
        launcher: "Préparer mon observation",
        online: "Données astronomiques en direct",
        close: "Fermer",
        location: "Lieu d’observation",
        duration: "Période",
        day1: "Prochaines 24 heures",
        day3: "3 prochains jours",
        day7: "7 prochains jours",
        forecast: "Prévisions du ciel",
        events: "Événements astronomiques",
        ready: "Choisissez une analyse. Aucune phrase libre ni donnée de compte n’est envoyée.",
        loading: "Analyse en cours…",
        unavailable: "Le service est temporairement indisponible.",
        score: "Score d’observation",
        clouds: "Nuages",
        visibility: "Visibilité",
        at: "à"
      }
    : {
        launcher: "Plan my observation",
        online: "Live astronomy data",
        close: "Close",
        location: "Observation site",
        duration: "Period",
        day1: "Next 24 hours",
        day3: "Next 3 days",
        day7: "Next 7 days",
        forecast: "Sky forecast",
        events: "Astronomy events",
        ready: "Choose an analysis. No free text or account data is sent.",
        loading: "Analysing…",
        unavailable: "The service is temporarily unavailable.",
        score: "Observation score",
        clouds: "Clouds",
        visibility: "Visibility",
        at: "at"
      };

  var style = document.createElement("style");
  style.textContent =
    "*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}" +
    "body{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#142330}" +
    ".prw-wrap{display:flex;width:100%;height:100%;align-items:" +
    (position === "left" ? "flex-start" : "flex-end") +
    ";justify-content:flex-end;flex-direction:column;padding:2px}" +
    ".prw-launcher{display:flex;align-items:center;gap:9px;min-height:52px;border:0;border-radius:999px;padding:0 18px;color:#fff;background:" +
    color +
    ";box-shadow:0 12px 30px rgba(10,20,30,.28);font-weight:700;cursor:pointer}" +
    ".prw-mark{display:grid;width:26px;height:26px;place-items:center;border-radius:9px;background:rgba(255,255,255,.17);font-size:16px}" +
    ".prw-panel{display:none;width:100%;height:100%;overflow:hidden;border:1px solid rgba(10,30,45,.1);border-radius:21px;background:#fff;box-shadow:0 20px 60px rgba(10,20,30,.24)}" +
    ".prw-panel.open{display:flex;flex-direction:column}.prw-head{display:flex;align-items:center;gap:11px;padding:17px;background:" +
    color +
    ";color:#fff}.prw-head-copy{min-width:0;flex:1}.prw-head-copy strong,.prw-head-copy span{display:block}.prw-head-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}.prw-head-copy span{margin-top:3px;font-size:10px;opacity:.8}" +
    ".prw-close{display:grid;width:32px;height:32px;place-items:center;border:0;border-radius:9px;color:#fff;background:rgba(255,255,255,.12);font-size:21px;cursor:pointer}" +
    ".prw-body{display:flex;min-height:0;flex:1;flex-direction:column;gap:12px;overflow-y:auto;padding:16px;background:#f5f8fa}" +
    ".prw-controls,.prw-result{border:1px solid #e1e9ee;border-radius:15px;padding:13px;background:#fff;box-shadow:0 3px 12px rgba(20,40,55,.04)}" +
    ".prw-label{display:block;margin:0 0 5px;color:#526b7c;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}" +
    ".prw-select{width:100%;height:39px;margin-bottom:10px;border:1px solid #d5e0e6;border-radius:10px;padding:0 9px;color:#142330;background:#fff;font-size:12px}" +
    ".prw-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.prw-action{min-height:48px;border:1px solid " +
    color +
    ";border-radius:11px;padding:7px;color:" +
    color +
    ";background:#fff;font-size:11px;font-weight:700;cursor:pointer}.prw-action:hover{color:#fff;background:" +
    color +
    "}.prw-action:disabled{cursor:wait;opacity:.45}.prw-status{margin:0;color:#526b7c;font-size:12px;line-height:1.5}" +
    ".prw-result h2{margin:0 0 8px;font-size:14px}.prw-result p{margin:0 0 9px;font-size:12px;line-height:1.5}.prw-result ul{display:grid;gap:8px;margin:0;padding:0;list-style:none}.prw-result li{border-top:1px solid #edf1f4;padding-top:8px;font-size:11px;line-height:1.45}.prw-result strong{display:block;margin-bottom:2px}.prw-meta{color:#607787}.prw-error{color:#a52d43}.prw-foot{padding:9px 15px;color:#738694;background:#fff;font-size:9px;text-align:center}";
  document.head.appendChild(style);

  var wrap = element("div", "prw-wrap");
  var panel = element("section", "prw-panel");
  panel.setAttribute("aria-label", String(config.name || "Assistant"));
  var head = element("header", "prw-head");
  var mark = element("span", "prw-mark");
  mark.textContent = "✦";
  mark.setAttribute("aria-hidden", "true");
  var headCopy = element("div", "prw-head-copy");
  var name = document.createElement("strong");
  name.textContent = boundedText(config.name, 80, "Assistant");
  var online = document.createElement("span");
  online.textContent = copy.online;
  headCopy.append(name, online);
  var close = element("button", "prw-close");
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", copy.close);
  head.append(mark, headCopy, close);

  var body = element("div", "prw-body");
  var controls = element("section", "prw-controls");
  var locationLabel = label(copy.location, "prw-location");
  var locationSelect = element("select", "prw-select");
  locationSelect.id = "prw-location";
  locations.forEach(function (location) {
    var option = document.createElement("option");
    option.value = location.id;
    option.textContent = location.label;
    locationSelect.appendChild(option);
  });
  var durationLabel = label(copy.duration, "prw-duration");
  var durationSelect = element("select", "prw-select");
  durationSelect.id = "prw-duration";
  [
    ["1", copy.day1],
    ["3", copy.day3],
    ["7", copy.day7]
  ].forEach(function (definition) {
    var option = document.createElement("option");
    option.value = definition[0];
    option.textContent = definition[1];
    durationSelect.appendChild(option);
  });
  var actions = element("div", "prw-actions");
  var forecastButton = actionButton(copy.forecast);
  var eventsButton = actionButton(copy.events);
  actions.append(forecastButton, eventsButton);
  controls.append(
    locationLabel,
    locationSelect,
    durationLabel,
    durationSelect,
    actions
  );

  var result = element("section", "prw-result");
  result.setAttribute("aria-live", "polite");
  var initialStatus = element("p", "prw-status");
  initialStatus.textContent = copy.ready;
  result.appendChild(initialStatus);
  body.append(controls, result);

  var foot = element("footer", "prw-foot");
  foot.textContent = isFrench
    ? "Actions publiques en lecture seule"
    : "Read-only public actions";
  panel.append(head, body, foot);

  var launcher = element("button", "prw-launcher");
  launcher.type = "button";
  var launcherMark = element("span", "prw-mark");
  launcherMark.textContent = "✦";
  launcherMark.setAttribute("aria-hidden", "true");
  var launcherText = document.createElement("span");
  launcherText.textContent = copy.launcher;
  launcher.append(launcherMark, launcherText);
  wrap.append(panel, launcher);
  host.appendChild(wrap);

  launcher.addEventListener("click", function () {
    toggle(true);
  });
  close.addEventListener("click", function () {
    toggle(false);
  });
  forecastButton.addEventListener("click", function () {
    void turn("sky.forecast");
  });
  eventsButton.addEventListener("click", function () {
    void turn("sky.events");
  });

  publishLayout(false);

  function toggle(open) {
    panel.classList.toggle("open", open);
    launcher.style.display = open ? "none" : "flex";
    publishLayout(open);
  }

  function publishLayout(open) {
    window.parent.postMessage(
      {
        type: "pleiades-rasa-widget:layout",
        botKey: botKey,
        open: open,
        position: position
      },
      parentOrigin
    );
  }

  function turn(operation) {
    setBusy(true);
    showStatus(copy.loading, false);
    var payload = {
      sessionToken: sessionToken,
      requestId: requestId(),
      operation: operation,
      locationId: locationSelect.value
    };
    if (operation === "sky.events") {
      payload.days = Number(durationSelect.value);
    }

    return fetch(
      "/api/widget/" + encodeURIComponent(botKey) + "/turn",
      {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    )
      .then(function (response) {
        if (response.status === 401) {
          window.location.reload();
          throw new Error("Session expired");
        }
        return response.json().then(function (decoded) {
          if (!response.ok) throw new Error("Unavailable");
          return decoded;
        });
      })
      .then(function (decoded) {
        if (
          !decoded ||
          decoded.requestId !== payload.requestId ||
          decoded.capability !== operation ||
          typeof decoded.answer !== "string" ||
          !decoded.data
        ) {
          throw new Error("Invalid response");
        }
        renderResult(decoded);
      })
      .catch(function () {
        showStatus(copy.unavailable, true);
      })
      .finally(function () {
        setBusy(false);
      });
  }

  function setBusy(busy) {
    forecastButton.disabled = busy;
    eventsButton.disabled = busy;
    locationSelect.disabled = busy;
    durationSelect.disabled = busy;
  }

  function showStatus(text, error) {
    result.replaceChildren();
    var status = element("p", error ? "prw-status prw-error" : "prw-status");
    status.textContent = text;
    result.appendChild(status);
  }

  function renderResult(decoded) {
    result.replaceChildren();
    var title = document.createElement("h2");
    title.textContent =
      decoded.capability === "sky.forecast" ? copy.forecast : copy.events;
    var answer = document.createElement("p");
    answer.textContent = boundedText(decoded.answer, 500, "");
    result.append(title, answer);

    if (decoded.capability === "sky.forecast") {
      renderForecast(decoded.data);
    } else {
      renderEvents(decoded.data);
    }
  }

  function renderForecast(data) {
    if (!data || !Number.isFinite(data.score) || !Array.isArray(data.daily)) {
      throw new Error("Invalid forecast");
    }
    var meta = element("p", "prw-meta");
    meta.textContent =
      copy.score +
      " : " +
      Math.round(data.score) +
      "/100" +
      (data.location && data.location.name
        ? " · " + boundedText(data.location.name, 100, "")
        : "");
    result.appendChild(meta);
    var list = document.createElement("ul");
    data.daily.slice(0, 7).forEach(function (day) {
      if (!day || typeof day.date !== "string") return;
      var item = document.createElement("li");
      var heading = document.createElement("strong");
      heading.textContent =
        boundedText(day.date, 32, "") +
        " · " +
        Math.round(Number(day.score) || 0) +
        "/100";
      var details = document.createElement("span");
      details.className = "prw-meta";
      details.textContent =
        copy.clouds +
        " : " +
        Math.round(Number(day.cloudPercent) || 0) +
        "% · " +
        boundedText(day.summary, 300, "");
      item.append(heading, details);
      list.appendChild(item);
    });
    result.appendChild(list);
  }

  function renderEvents(data) {
    if (!data || !Array.isArray(data.items)) {
      throw new Error("Invalid events");
    }
    var list = document.createElement("ul");
    data.items.slice(0, 12).forEach(function (event) {
      if (!event || typeof event.name !== "string") return;
      var item = document.createElement("li");
      var heading = document.createElement("strong");
      heading.textContent = boundedText(event.name, 160, "");
      var details = document.createElement("span");
      details.className = "prw-meta";
      details.textContent =
        formatDate(event.peaksAt) +
        " · " +
        copy.visibility +
        " : " +
        Math.round(Number(event.visibilityScore) || 0) +
        "/100";
      item.append(heading, details);
      list.appendChild(item);
    });
    result.appendChild(list);
  }

  function formatDate(value) {
    var date = new Date(String(value));
    if (!Number.isFinite(date.getTime())) return "";
    try {
      return new Intl.DateTimeFormat(isFrench ? "fr-FR" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC"
      }).format(date);
    } catch {
      return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
    }
  }

  function requestId() {
    if (self.crypto && self.crypto.randomUUID) {
      return self.crypto.randomUUID();
    }
    var bytes = new Uint8Array(16);
    self.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.from(bytes, function (value) {
      return value.toString(16).padStart(2, "0");
    }).join("");
    return (
      hex.slice(0, 8) +
      "-" +
      hex.slice(8, 12) +
      "-" +
      hex.slice(12, 16) +
      "-" +
      hex.slice(16, 20) +
      "-" +
      hex.slice(20)
    );
  }

  function actionButton(text) {
    var button = element("button", "prw-action");
    button.type = "button";
    button.textContent = text;
    return button;
  }

  function label(text, target) {
    var node = element("label", "prw-label");
    node.textContent = text;
    node.htmlFor = target;
    return node;
  }

  function element(tag, className) {
    var node = document.createElement(tag);
    node.className = className;
    return node;
  }

  function boundedText(value, maximumLength, fallback) {
    if (typeof value !== "string") return fallback;
    return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, maximumLength);
  }

  function validLocation(value) {
    return (
      value &&
      typeof value.id === "string" &&
      /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value.id) &&
      typeof value.label === "string" &&
      value.label.length >= 1 &&
      value.label.length <= 80
    );
  }

  function exactOrigin(value) {
    try {
      var url = new URL(value);
      var loopback =
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]";
      return (
        (url.protocol === "https:" ||
          (loopback && url.protocol === "http:")) &&
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash &&
        url.origin === value
      );
    } catch {
      return false;
    }
  }
})();
