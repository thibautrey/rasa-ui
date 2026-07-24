"use client";

import { LoaderCircle, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function CreateAssistant() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("fr");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/assistants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, language })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Création impossible.");
      setOpen(false);
      router.push(`/assistants/${result.assistant.id}`);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Création impossible."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button className="button primary" onClick={() => setOpen(true)}>
        <Plus />
        Nouvel assistant
      </button>
      {open ? (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-labelledby="create-assistant-title"
            aria-modal="true"
            className="modal card"
            role="dialog"
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">Nouveau projet</p>
                <h2 id="create-assistant-title">Créer un assistant</h2>
              </div>
              <button
                aria-label="Fermer"
                className="icon-button"
                onClick={() => setOpen(false)}
                type="button"
              >
                <X />
              </button>
            </div>
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="assistant-name">Nom</label>
                <input
                  autoFocus
                  className="input"
                  id="assistant-name"
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Conseiller boutique"
                  required
                  value={name}
                />
              </div>
              <div className="field">
                <label htmlFor="assistant-description">Description</label>
                <textarea
                  className="textarea"
                  id="assistant-description"
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Rôle, audience et objectifs de l’assistant…"
                  value={description}
                />
              </div>
              <div className="field">
                <label htmlFor="assistant-language">Langue principale</label>
                <select
                  className="select"
                  id="assistant-language"
                  onChange={(event) => setLanguage(event.target.value)}
                  value={language}
                >
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                  <option value="de">Deutsch</option>
                  <option value="it">Italiano</option>
                </select>
              </div>
              {error ? <div className="error-banner">{error}</div> : null}
              <div className="form-actions">
                <button
                  className="button secondary"
                  onClick={() => setOpen(false)}
                  type="button"
                >
                  Annuler
                </button>
                <button className="button primary" disabled={pending}>
                  {pending ? <LoaderCircle className="spin" /> : <Plus />}
                  {pending ? "Création…" : "Créer le projet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
