"use client";

import { CheckCircle2, Download, LoaderCircle, Rocket, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ModelActions({
  id,
  active,
  canActivate,
  canDelete
}: {
  id: string;
  active: boolean;
  canActivate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"activate" | "delete" | null>(null);
  const [error, setError] = useState("");

  async function activate() {
    setPending("activate");
    setError("");
    const response = await fetch(`/api/models/${id}/activate`, {
      method: "POST"
    });
    const result = await response.json();
    setPending(null);
    if (!response.ok) {
      setError(result.error ?? "Activation impossible.");
      return;
    }
    router.refresh();
  }

  async function remove() {
    if (!window.confirm("Supprimer définitivement cette archive de modèle ?")) {
      return;
    }
    setPending("delete");
    setError("");
    const response = await fetch(`/api/models/${id}`, { method: "DELETE" });
    const result = await response.json();
    setPending(null);
    if (!response.ok) {
      setError(result.error ?? "Suppression impossible.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="model-actions">
      {active ? (
        <span className="pill success">
          <CheckCircle2 />
          Actif
        </span>
      ) : canActivate ? (
        <button
          className="button secondary compact"
          disabled={pending !== null}
          onClick={activate}
          type="button"
        >
          {pending === "activate" ? <LoaderCircle className="spin" /> : <Rocket />}
          Promouvoir
        </button>
      ) : null}
      <a
        aria-label="Télécharger l’archive"
        className="icon-button"
        href={`/api/models/${id}/download`}
      >
        <Download />
      </a>
      {canDelete && !active ? (
        <button
          aria-label="Supprimer l’archive"
          className="icon-button danger-text"
          disabled={pending !== null}
          onClick={remove}
          type="button"
        >
          {pending === "delete" ? <LoaderCircle className="spin" /> : <Trash2 />}
        </button>
      ) : null}
      {error ? <span className="inline-error">{error}</span> : null}
    </div>
  );
}
