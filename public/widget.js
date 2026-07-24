(function () {
  "use strict";

  var script = document.currentScript;
  if (!script || !script.dataset.botKey) return;

  var botKey = script.dataset.botKey;
  var baseUrl = script.dataset.baseUrl || new URL(script.src).origin;
  var storageKey = "pleiades-rasa-sender:" + botKey;
  var sender = localStorage.getItem(storageKey);
  if (!sender) {
    sender =
      (self.crypto && self.crypto.randomUUID
        ? self.crypto.randomUUID()
        : Date.now() + "-" + Math.random().toString(36).slice(2));
    localStorage.setItem(storageKey, sender);
  }

  fetch(baseUrl + "/api/widget/" + encodeURIComponent(botKey) + "/config", {
    credentials: "omit",
    mode: "cors"
  })
    .then(function (response) {
      if (!response.ok) throw new Error("Widget unavailable");
      return response.json();
    })
    .then(mount)
    .catch(function () {
      // Fail closed and stay invisible when the origin is not authorized.
    });

  function mount(config) {
    var host = document.createElement("div");
    host.id = "pleiades-rasa-widget";
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: "closed" });

    var style = document.createElement("style");
    style.textContent =
      ":host{all:initial}" +
      ".prw-wrap{position:fixed;z-index:2147483000;bottom:22px;" +
      (config.position === "left" ? "left:22px" : "right:22px") +
      ";font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#10202d}" +
      ".prw-launcher{display:flex;align-items:center;gap:9px;min-height:50px;border:0;border-radius:999px;padding:0 18px;color:#fff;background:" +
      safeColor(config.primaryColor, "#8b6cff") +
      ";box-shadow:0 16px 38px rgba(10,20,30,.28);font-weight:700;cursor:pointer}" +
      ".prw-launcher svg{width:19px}.prw-panel{display:none;width:min(370px,calc(100vw - 28px));height:min(590px,calc(100vh - 100px));margin-bottom:12px;overflow:hidden;border:1px solid rgba(10,30,45,.1);border-radius:21px;background:#fff;box-shadow:0 24px 75px rgba(10,20,30,.25)}" +
      ".prw-panel.open{display:flex;flex-direction:column}.prw-head{display:flex;align-items:center;gap:11px;padding:17px;background:" +
      safeColor(config.primaryColor, "#8b6cff") +
      ";color:#fff}.prw-avatar{display:grid;width:38px;height:38px;place-items:center;overflow:hidden;border-radius:12px;background:rgba(255,255,255,.18)}.prw-avatar img{width:100%;height:100%;object-fit:cover}.prw-avatar svg{width:19px}.prw-head-copy{min-width:0;flex:1}.prw-head strong,.prw-head span{display:block}.prw-head strong{font-size:13px}.prw-head span{margin-top:3px;font-size:10px;opacity:.78}.prw-close{display:grid;width:32px;height:32px;place-items:center;border:0;border-radius:9px;color:#fff;background:rgba(255,255,255,.12);cursor:pointer}.prw-close svg{width:15px}" +
      ".prw-messages{display:flex;flex:1;flex-direction:column;gap:10px;overflow-y:auto;padding:16px;background:#f5f8fa}.prw-msg{max-width:82%;border-radius:14px 14px 14px 4px;padding:10px 12px;background:#fff;box-shadow:0 3px 12px rgba(20,40,55,.06);font-size:12px;line-height:1.5;white-space:pre-wrap}.prw-msg.user{align-self:flex-end;border-radius:14px 14px 4px;color:#fff;background:" +
      safeColor(config.primaryColor, "#8b6cff") +
      "}.prw-msg img{display:block;max-width:100%;margin-top:8px;border-radius:9px}.prw-buttons{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.prw-buttons button{border:1px solid " +
      safeColor(config.primaryColor, "#8b6cff") +
      ";border-radius:999px;padding:6px 9px;color:" +
      safeColor(config.primaryColor, "#8b6cff") +
      ";background:#fff;font-size:10px;cursor:pointer}.prw-typing{color:#6d8292;font-style:italic}.prw-error{align-self:center;color:#be3f54;background:#fff0f2}" +
      ".prw-form{display:grid;grid-template-columns:1fr 42px;gap:8px;border-top:1px solid #e7edf1;padding:11px;background:#fff}.prw-input{min-width:0;border:1px solid #d8e2e8;border-radius:11px;outline:0;padding:0 11px;color:#10202d;background:#fff;font-size:12px}.prw-input:focus{border-color:" +
      safeColor(config.primaryColor, "#8b6cff") +
      "}.prw-send{display:grid;width:42px;height:42px;place-items:center;border:0;border-radius:11px;color:#fff;background:" +
      safeColor(config.primaryColor, "#8b6cff") +
      ";cursor:pointer}.prw-send:disabled{opacity:.5}.prw-send svg{width:17px}@media(max-width:520px){.prw-wrap{right:14px!important;bottom:14px!important;left:14px!important}.prw-panel{width:100%;height:calc(100vh - 92px)}}";
    root.appendChild(style);

    var wrap = element("div", "prw-wrap");
    var panel = element("section", "prw-panel");
    var head = element("header", "prw-head");
    var avatar = element("span", "prw-avatar");
    if (config.avatarUrl && /^https:\/\//i.test(config.avatarUrl)) {
      var image = document.createElement("img");
      image.src = config.avatarUrl;
      image.alt = "";
      avatar.appendChild(image);
    } else {
      avatar.innerHTML = chatIcon();
    }
    var headCopy = element("div", "prw-head-copy");
    var name = document.createElement("strong");
    name.textContent = config.name;
    var status = document.createElement("span");
    status.textContent = config.locale === "fr" ? "En ligne" : "Online";
    headCopy.append(name, status);
    var close = element("button", "prw-close");
    close.type = "button";
    close.setAttribute("aria-label", "Fermer");
    close.innerHTML = closeIcon();
    head.append(avatar, headCopy, close);

    var messages = element("div", "prw-messages");
    appendMessage(messages, { text: config.welcomeMessage }, "bot");
    var form = element("form", "prw-form");
    var input = element("input", "prw-input");
    input.placeholder = config.placeholder;
    input.maxLength = 4000;
    input.autocomplete = "off";
    var send = element("button", "prw-send");
    send.type = "submit";
    send.setAttribute("aria-label", "Envoyer");
    send.innerHTML = sendIcon();
    form.append(input, send);
    panel.append(head, messages, form);

    var launcher = element("button", "prw-launcher");
    launcher.type = "button";
    launcher.innerHTML = chatIcon();
    var label = document.createElement("span");
    label.textContent = config.launcherLabel;
    launcher.appendChild(label);
    wrap.append(panel, launcher);
    root.appendChild(wrap);

    function toggle(force) {
      var open =
        typeof force === "boolean" ? force : !panel.classList.contains("open");
      panel.classList.toggle("open", open);
      launcher.style.display = open ? "none" : "flex";
      if (open) input.focus();
    }

    launcher.addEventListener("click", function () {
      toggle(true);
    });
    close.addEventListener("click", function () {
      toggle(false);
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      input.value = "";
      input.disabled = true;
      send.disabled = true;
      var requestId =
        self.crypto && self.crypto.randomUUID
          ? self.crypto.randomUUID()
          : sender +
            "-" +
            Date.now() +
            "-" +
            Math.random().toString(36).slice(2);
      appendMessage(messages, { text: text }, "user");
      var typing = appendMessage(
        messages,
        { text: config.locale === "fr" ? "Écriture…" : "Typing…" },
        "typing"
      );

      fetch(baseUrl + "/api/widget/" + encodeURIComponent(botKey) + "/chat", {
        method: "POST",
        credentials: "omit",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: sender,
          message: text,
          requestId: requestId
        })
      })
        .then(function (response) {
          return response.json().then(function (body) {
            if (!response.ok) throw new Error(body.error || "Unavailable");
            return body;
          });
        })
        .then(function (body) {
          typing.remove();
          if (!body.replies || !body.replies.length) {
            appendMessage(
              messages,
              {
                text:
                  config.locale === "fr"
                    ? "Je n’ai pas encore de réponse."
                    : "I do not have an answer yet."
              },
              "bot"
            );
            return;
          }
          body.replies.forEach(function (reply) {
            appendMessage(messages, reply, "bot");
          });
        })
        .catch(function () {
          typing.remove();
          appendMessage(
            messages,
            {
              text:
                config.locale === "fr"
                  ? "Le service est temporairement indisponible."
                  : "The service is temporarily unavailable."
            },
            "error"
          );
        })
        .finally(function () {
          input.disabled = false;
          send.disabled = false;
          input.focus();
        });
    });
  }

  function appendMessage(container, payload, type) {
    var message = element(
      "div",
      "prw-msg " +
        (type === "user"
          ? "user"
          : type === "typing"
            ? "prw-typing"
            : type === "error"
              ? "prw-error"
              : "")
    );
    message.textContent = String(payload.text || "");
    if (payload.image && /^https:\/\//i.test(payload.image)) {
      var image = document.createElement("img");
      image.src = payload.image;
      image.alt = "";
      image.loading = "lazy";
      message.appendChild(image);
    }
    if (Array.isArray(payload.buttons) && payload.buttons.length) {
      var buttons = element("div", "prw-buttons");
      payload.buttons.slice(0, 8).forEach(function (definition) {
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = String(definition.title || "");
        button.addEventListener("click", function () {
          var form = container.parentNode.querySelector(".prw-form");
          var input = form.querySelector(".prw-input");
          input.value = String(definition.payload || definition.title || "");
          form.requestSubmit();
        });
        buttons.appendChild(button);
      });
      message.appendChild(buttons);
    }
    container.appendChild(message);
    container.scrollTop = container.scrollHeight;
    return message;
  }

  function element(tag, className) {
    var node = document.createElement(tag);
    node.className = className;
    return node;
  }

  function safeColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value)) ? value : fallback;
  }

  function chatIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>';
  }

  function closeIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  }

  function sendIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';
  }
})();
