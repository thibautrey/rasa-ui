(function () {
  "use strict";

  var script = document.currentScript;
  if (!script || !script.dataset.botKey) return;

  var botKey = String(script.dataset.botKey);
  if (!/^bot_[A-Za-z0-9_-]{20,80}$/.test(botKey)) return;
  if (!window.location.origin || window.location.origin === "null") return;

  var baseUrl;
  try {
    baseUrl = new URL(
      script.dataset.baseUrl || script.src,
      window.location.href
    ).origin;
  } catch {
    return;
  }
  if (!/^https?:\/\//i.test(baseUrl)) return;

  var id = "pleiades-rasa-widget-" + botKey;
  if (document.getElementById(id)) return;

  var frame = document.createElement("iframe");
  frame.id = id;
  frame.title = "Assistance en ligne";
  frame.src =
    baseUrl +
    "/widget/" +
    encodeURIComponent(botKey) +
    "?parentOrigin=" +
    encodeURIComponent(window.location.origin);
  frame.sandbox = "allow-scripts";
  frame.referrerPolicy = "origin";
  frame.setAttribute(
    "allow",
    "camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'"
  );
  frame.style.cssText =
    "position:fixed;right:10px;bottom:10px;width:min(240px,calc(100vw - 20px));" +
    "height:76px;border:0;background:transparent;z-index:2147483000;" +
    "color-scheme:light;opacity:0;transition:opacity .15s ease";

  window.addEventListener("message", function (event) {
    if (
      event.origin !== "null" ||
      event.source !== frame.contentWindow ||
      !event.data ||
      event.data.type !== "pleiades-rasa-widget:layout" ||
      event.data.botKey !== botKey
    ) {
      return;
    }

    var open = event.data.open === true;
    var left = event.data.position === "left";
    frame.style.left = left ? "10px" : "auto";
    frame.style.right = left ? "auto" : "10px";
    frame.style.width = open
      ? "min(400px,calc(100vw - 20px))"
      : "min(240px,calc(100vw - 20px))";
    frame.style.height = open
      ? "min(660px,calc(100vh - 20px))"
      : "76px";
    frame.style.opacity = "1";
  });

  function appendFrame() {
    if (!document.getElementById(id)) {
      document.body.appendChild(frame);
    }
  }

  if (document.body) {
    appendFrame();
  } else {
    document.addEventListener("DOMContentLoaded", appendFrame, {
      once: true
    });
  }
})();
