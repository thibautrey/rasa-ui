"use client";

import {
  Bot,
  Braces,
  LoaderCircle,
  RotateCcw,
  Send,
  User
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

type ChatMessage = {
  id: string;
  direction: "user" | "bot";
  text: string;
};

type GenerationMetadata = {
  provider: "litellm";
  model: string;
  status: "GENERATED" | "RASA_FALLBACK" | "DISABLED";
};

function sessionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `studio-${crypto.randomUUID()}`;
  }
  return `studio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function TestConsole({ assistantId }: { assistantId: string }) {
  const [sender, setSender] = useState(sessionId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [nlu, setNlu] = useState<Record<string, unknown> | null>(null);
  const [generation, setGeneration] = useState<GenerationMetadata | null>(
    null
  );

  const intent = useMemo(() => {
    const value = nlu?.intent;
    if (!value || typeof value !== "object") return null;
    const object = value as { name?: string; confidence?: number };
    return object.name
      ? `${object.name} · ${Math.round((object.confidence ?? 0) * 100)} %`
      : null;
  }, [nlu]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = text.trim();
    if (!message || pending) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      direction: "user",
      text: message
    };
    setMessages((current) => [...current, userMessage]);
    setText("");
    setPending(true);
    setError("");

    try {
      const requestId = crypto.randomUUID();
      const chatResponse = await fetch(`/api/assistants/${assistantId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender, message, requestId })
      });
      const chat = await chatResponse.json();
      if (!chatResponse.ok) {
        throw new Error(chat.error ?? "Le serveur Rasa ne répond pas.");
      }
      setNlu(chat.nlu ?? null);
      setGeneration(chat.generation ?? null);
      setMessages((current) => [
        ...current,
        ...(chat.replies.length
          ? chat.replies.map(
              (reply: { text?: string }, index: number): ChatMessage => ({
                id: `${Date.now()}-${index}`,
                direction: "bot",
                text: reply.text ?? "Réponse enrichie"
              })
            )
          : [
              {
                id: `${Date.now()}-empty`,
                direction: "bot" as const,
                text: "Aucune réponse textuelle n’a été produite."
              }
            ])
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Le test a échoué."
      );
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setSender(sessionId());
    setMessages([]);
    setNlu(null);
    setGeneration(null);
    setError("");
  }

  return (
    <div className="test-console">
      <div className="test-chat">
        <div className="test-chat-head">
          <div>
            <p className="eyebrow">Try it</p>
            <h3>Conversation de test</h3>
          </div>
          <button className="icon-button" onClick={reset} type="button">
            <RotateCcw />
          </button>
        </div>
        <div className="test-messages">
          {messages.length ? (
            messages.map((message) => (
              <div
                className={`test-message ${message.direction}`}
                key={message.id}
              >
                <span>
                  {message.direction === "bot" ? <Bot /> : <User />}
                </span>
                <p>{message.text}</p>
              </div>
            ))
          ) : (
            <div className="test-empty">
              <Bot />
              <strong>Commencez une conversation</strong>
              <span>
                Les messages passent par le canal REST du modèle actif.
              </span>
            </div>
          )}
          {pending ? (
            <div className="test-message bot">
              <span>
                <Bot />
              </span>
              <p className="typing">
                <i />
                <i />
                <i />
              </p>
            </div>
          ) : null}
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
        <form className="test-composer" onSubmit={send}>
          <input
            className="input"
            onChange={(event) => setText(event.target.value)}
            placeholder="Écrivez un message de test…"
            value={text}
          />
          <button
            aria-label="Envoyer"
            className="button primary"
            disabled={pending || !text.trim()}
          >
            {pending ? <LoaderCircle className="spin" /> : <Send />}
          </button>
        </form>
      </div>

      <aside className="nlu-inspector">
        <div className="nlu-inspector-head">
          <Braces />
          <div>
            <strong>Inspecteur NLU</strong>
            <span>Dernière analyse</span>
          </div>
        </div>
        {nlu ? (
          <>
            <div className="nlu-intent">
              <span>Intention détectée</span>
              <strong>{intent ?? "Non déterminée"}</strong>
            </div>
            {generation ? (
              <div className="nlu-intent">
                <span>Génération · {generation.status}</span>
                <strong>
                  {generation.provider} · {generation.model}
                </strong>
              </div>
            ) : null}
            <pre>{JSON.stringify(nlu, null, 2)}</pre>
          </>
        ) : (
          <div className="nlu-placeholder">
            Envoyez un message pour voir l’intention, la confiance et les
            entités extraites.
          </div>
        )}
      </aside>
    </div>
  );
}
