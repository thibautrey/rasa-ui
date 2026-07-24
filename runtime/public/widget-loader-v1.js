(function () {
  "use strict";

  var script = document.currentScript;
  if (!script || !script.dataset.botKey) return;

  var botKey = String(script.dataset.botKey);
  if (!/^bot_[A-Za-z0-9_-]{20,80}$/.test(botKey)) return;
  if (!window.location.origin || window.location.origin === "null") return;

  var baseUrl;
  try {
    var candidate = new URL(
      script.dataset.baseUrl || script.src,
      window.location.href
    );
    var loopback =
      candidate.hostname === "localhost" ||
      candidate.hostname === "127.0.0.1" ||
      candidate.hostname === "[::1]";
    if (
      candidate.protocol !== "https:" &&
      !(loopback && candidate.protocol === "http:")
    ) {
      return;
    }
    baseUrl = candidate.origin;
  } catch {
    return;
  }

  var id = "pleiades-rasa-widget-" + botKey;
  if (document.getElementById(id)) return;

  var frame = document.createElement("iframe");
  frame.id = id;
  frame.title = "Assistant d’observation astronomique";
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
    "camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; usb 'none'"
  );
  frame.style.cssText =
    "position:fixed;right:10px;bottom:10px;width:min(250px,calc(100vw - 20px));" +
    "height:76px;border:0;background:transparent;z-index:2147483000;" +
    "color-scheme:light;opacity:0;pointer-events:none;transition:opacity .15s ease";

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
    frame.style.pointerEvents = "auto";
    frame.style.left = left ? "10px" : "auto";
    frame.style.right = left ? "auto" : "10px";
    frame.style.width = open
      ? "min(420px,calc(100vw - 20px))"
      : "min(250px,calc(100vw - 20px))";
    frame.style.height = open
      ? "min(680px,calc(100vh - 20px))"
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
