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
  if (
    !/^bot_[A-Za-z0-9_-]{20,80}$/.test(botKey) ||
    !/^https?:\/\//i.test(parentOrigin) ||
    sessionToken.length < 64
  ) {
    return;
  }

  var color = safeColor(config.primaryColor, "#8b6cff");
  var position = config.position === "left" ? "left" : "right";
  var isFrench = String(config.locale || "").toLowerCase().startsWith("fr");

  var style = document.createElement("style");
  style.textContent =
    "*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}" +
    "body{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#10202d}" +
    ".prw-wrap{display:flex;width:100%;height:100%;align-items:" +
    (position === "left" ? "flex-start" : "flex-end") +
    ";justify-content:flex-end;flex-direction:column;padding:2px}" +
    ".prw-launcher{display:flex;align-items:center;gap:9px;min-height:52px;border:0;border-radius:999px;padding:0 18px;color:#fff;background:" +
    color +
    ";box-shadow:0 12px 30px rgba(10,20,30,.28);font-weight:700;cursor:pointer}" +
    ".prw-launcher svg{width:19px}.prw-panel{display:none;width:100%;height:100%;overflow:hidden;border:1px solid rgba(10,30,45,.1);border-radius:21px;background:#fff;box-shadow:0 20px 60px rgba(10,20,30,.24)}" +
    ".prw-panel.open{display:flex;flex-direction:column}.prw-head{display:flex;align-items:center;gap:11px;padding:17px;background:" +
    color +
    ";color:#fff}.prw-avatar{display:grid;width:38px;height:38px;place-items:center;overflow:hidden;border-radius:12px;background:rgba(255,255,255,.18)}" +
    ".prw-avatar img{width:100%;height:100%;object-fit:cover}.prw-avatar svg{width:19px}.prw-head-copy{min-width:0;flex:1}.prw-head-copy strong,.prw-head-copy span{display:block}" +
    ".prw-head-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.prw-head-copy span{margin-top:3px;font-size:10px;opacity:.78}" +
    ".prw-close{display:grid;width:32px;height:32px;place-items:center;border:0;border-radius:9px;color:#fff;background:rgba(255,255,255,.12);cursor:pointer}.prw-close svg{width:15px}" +
    ".prw-messages{display:flex;flex:1;flex-direction:column;gap:10px;overflow-y:auto;padding:16px;background:#f5f8fa}" +
    ".prw-msg{max-width:84%;border-radius:14px 14px 14px 4px;padding:10px 12px;background:#fff;box-shadow:0 3px 12px rgba(20,40,55,.06);font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}" +
    ".prw-msg.user{align-self:flex-end;border-radius:14px 14px 4px;color:#fff;background:" +
    color +
    "}.prw-buttons{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.prw-buttons button{border:1px solid " +
    color +
    ";border-radius:999px;padding:6px 9px;color:" +
    color +
    ";background:#fff;font-size:10px;cursor:pointer}.prw-typing{color:#6d8292;font-style:italic}.prw-error{align-self:center;color:#be3f54;background:#fff0f2}" +
    ".prw-form{display:grid;grid-template-columns:1fr 42px;gap:8px;border-top:1px solid #e7edf1;padding:11px;background:#fff}.prw-input{min-width:0;border:1px solid #d8e2e8;border-radius:11px;outline:0;padding:0 11px;color:#10202d;background:#fff;font-size:12px}" +
    ".prw-input:focus{border-color:" +
    color +
    "}.prw-send{display:grid;width:42px;height:42px;place-items:center;border:0;border-radius:11px;color:#fff;background:" +
    color +
    ";cursor:pointer}.prw-send:disabled{opacity:.5}.prw-send svg{width:17px}";
  document.head.appendChild(style);

  var wrap = element("div", "prw-wrap");
  var panel = element("section", "prw-panel");
  var head = element("header", "prw-head");
  var avatar = element("span", "prw-avatar");
  if (config.avatarUrl && /^https:\/\//i.test(String(config.avatarUrl))) {
    var avatarImage = document.createElement("img");
    avatarImage.src = String(config.avatarUrl);
    avatarImage.alt = "";
    avatarImage.referrerPolicy = "no-referrer";
    avatar.appendChild(avatarImage);
  } else {
    avatar.innerHTML = chatIcon();
  }

  var headCopy = element("div", "prw-head-copy");
  var name = document.createElement("strong");
  name.textContent = String(config.name || "Assistant");
  var status = document.createElement("span");
  status.textContent = isFrench ? "En ligne" : "Online";
  headCopy.append(name, status);

  var close = element("button", "prw-close");
  close.type = "button";
  close.setAttribute("aria-label", isFrench ? "Fermer" : "Close");
  close.innerHTML = closeIcon();
  head.append(avatar, headCopy, close);

  var messages = element("div", "prw-messages");
  appendMessage(
    messages,
    { text: String(config.welcomeMessage || "") },
    "bot"
  );

  var form = element("form", "prw-form");
  var input = element("input", "prw-input");
  input.placeholder = String(config.placeholder || "");
  input.maxLength = 4000;
  input.autocomplete = "off";
  var send = element("button", "prw-send");
  send.type = "submit";
  send.setAttribute("aria-label", isFrench ? "Envoyer" : "Send");
  send.innerHTML = sendIcon();
  form.append(input, send);
  panel.append(head, messages, form);

  var launcher = element("button", "prw-launcher");
  launcher.type = "button";
  launcher.innerHTML = chatIcon();
  var label = document.createElement("span");
  label.textContent = String(config.launcherLabel || "");
  launcher.appendChild(label);
  wrap.append(panel, launcher);
  host.appendChild(wrap);

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

  function toggle(open) {
    panel.classList.toggle("open", open);
    launcher.style.display = open ? "none" : "flex";
    publishLayout(open);
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
    appendMessage(messages, { text: text }, "user");
    var typing = appendMessage(
      messages,
      { text: isFrench ? "Écriture…" : "Typing…" },
      "typing"
    );

    fetch("/api/widget/" + encodeURIComponent(botKey) + "/chat", {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({
        sessionToken: sessionToken,
        message: text,
        requestId: requestId()
      })
    })
      .then(function (response) {
        if (response.status === 401) {
          window.location.reload();
          throw new Error("Session expired");
        }
        return response.json().then(function (body) {
          if (!response.ok) throw new Error(body.error || "Unavailable");
          return body;
        });
      })
      .then(function (body) {
        typing.remove();
        if (!Array.isArray(body.replies) || !body.replies.length) {
          appendMessage(
            messages,
            {
              text: isFrench
                ? "Je n’ai pas encore de réponse."
                : "I do not have an answer yet."
            },
            "bot"
          );
          return;
        }
        body.replies.slice(0, 12).forEach(function (reply) {
          appendMessage(messages, reply, "bot");
        });
      })
      .catch(function () {
        if (!typing.isConnected) return;
        typing.remove();
        appendMessage(
          messages,
          {
            text: isFrench
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

  publishLayout(false);

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
    message.textContent = String(payload && payload.text ? payload.text : "");

    if (Array.isArray(payload && payload.buttons)) {
      var buttons = element("div", "prw-buttons");
      payload.buttons.slice(0, 8).forEach(function (definition) {
        var title = String(definition && definition.title ? definition.title : "");
        var value = String(
          definition && definition.payload ? definition.payload : ""
        );
        if (!title || !value) return;
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = title;
        button.addEventListener("click", function () {
          input.value = value;
          form.requestSubmit();
        });
        buttons.appendChild(button);
      });
      if (buttons.childNodes.length) message.appendChild(buttons);
    }

    container.appendChild(message);
    container.scrollTop = container.scrollHeight;
    return message;
  }

  function requestId() {
    if (self.crypto && self.crypto.randomUUID) {
      return self.crypto.randomUUID();
    }
    var bytes = new Uint8Array(16);
    self.crypto.getRandomValues(bytes);
    return Array.from(bytes, function (value) {
      return value.toString(16).padStart(2, "0");
    }).join("");
  }

  function element(tag, className) {
    var node = document.createElement(tag);
    node.className = className;
    return node;
  }

  function safeColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : fallback;
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
