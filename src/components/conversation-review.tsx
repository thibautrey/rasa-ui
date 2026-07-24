"use client";

import { CheckCircle2, LoaderCircle, Star } from "lucide-react";
import { useState } from "react";
import styles from "./conversation-quality.module.css";

type Props = {
  conversationId: string;
  editable: boolean;
  initialRating: number | null;
  initialReviewedAt: string | null;
};

export function ConversationReview({
  conversationId,
  editable,
  initialRating,
  initialReviewedAt
}: Props) {
  const [rating, setRating] = useState(initialRating ?? 0);
  const [reviewed, setReviewed] = useState(Boolean(initialReviewedAt));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function save() {
    if (rating < 1 || pending) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/conversations/${conversationId}/review`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating })
        }
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Évaluation impossible.");
      }
      setRating(result.conversation.rating);
      setReviewed(Boolean(result.conversation.reviewedAt));
      setNotice("Évaluation enregistrée.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Évaluation impossible."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="Évaluation de la conversation" className={`card ${styles.reviewCard}`}>
      <div className={styles.reviewCopy}>
        <strong>Qualité de la conversation</strong>
        <span>
          Notez la pertinence globale des réponses pour alimenter le suivi
          qualité.
        </span>
      </div>

      <div aria-label="Note sur cinq" className={styles.stars} role="group">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            aria-label={`Noter ${value} sur 5`}
            aria-pressed={rating === value}
            className={`${styles.star} ${
              value <= rating ? styles.starActive : ""
            }`}
            disabled={!editable}
            key={value}
            onClick={() => {
              setRating(value);
              setNotice("");
              setError("");
            }}
            type="button"
          >
            <Star />
          </button>
        ))}
      </div>

      <div className={styles.reviewActions}>
        <span className={styles.reviewState}>
          {reviewed ? <CheckCircle2 /> : null}
          {reviewed ? `Revue · ${rating}/5` : "À revoir"}
        </span>
        <button
          className="button primary compact"
          disabled={!editable || rating < 1 || pending}
          onClick={save}
          type="button"
        >
          {pending ? <LoaderCircle className="spin" /> : null}
          {editable ? "Enregistrer" : "Lecture seule"}
        </button>
      </div>

      {error || notice ? (
        <p
          className={`${styles.feedback} ${
            error ? styles.feedbackError : ""
          }`}
          role={error ? "alert" : "status"}
        >
          {error || notice}
        </p>
      ) : null}
    </section>
  );
}
