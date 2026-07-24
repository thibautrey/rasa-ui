import { ArrowLeft, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConversationReview } from "@/components/conversation-review";
import { canEdit, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import styles from "../../insights.module.css";
import qualityStyles from "@/components/conversation-quality.module.css";

type Props = { params: Promise<{ id: string }> };

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short"
});

function channelLabel(channel: string) {
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const conversation = await db.conversation.findUnique({
    where: { id },
    select: { senderId: true }
  });
  return {
    title: conversation
      ? `Conversation ${conversation.senderId}`
      : "Conversation"
  };
}

export default async function ConversationDetailPage({ params }: Props) {
  const user = await requireUser();
  const { id } = await params;
  const conversation = await db.conversation.findUnique({
    where: { id },
    include: {
      assistant: { select: { id: true, name: true } },
      storeBot: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "asc" } }
    }
  });

  if (!conversation) notFound();

  return (
    <>
      <div className="page-header">
        <div>
          <Link className={styles.backLink} href="/conversations">
            <ArrowLeft />
            Retour aux conversations
          </Link>
          <p className="eyebrow" style={{ marginTop: 18 }}>
            Transcript
          </p>
          <h1 className="page-title">{conversation.assistant.name}</h1>
          <p className="page-subtitle">
            Session <span className="mono">{conversation.senderId}</span> via{" "}
            {channelLabel(conversation.channel)}.
          </p>
        </div>
        <Link
          className="button secondary"
          href={`/assistants/${conversation.assistant.id}`}
        >
          Ouvrir l’assistant
        </Link>
      </div>

      <section
        aria-label="Informations de la conversation"
        className={styles.detailMetrics}
      >
        <article className={`card ${styles.detailMetric}`}>
          <span>Canal</span>
          <strong>{channelLabel(conversation.channel)}</strong>
        </article>
        <article className={`card ${styles.detailMetric}`}>
          <span>Point de contact</span>
          <strong>{conversation.storeBot?.name ?? "Console Studio"}</strong>
        </article>
        <article className={`card ${styles.detailMetric}`}>
          <span>Début</span>
          <strong>{dateFormatter.format(conversation.createdAt)}</strong>
        </article>
        <article className={`card ${styles.detailMetric}`}>
          <span>Dernière activité</span>
          <strong>{dateFormatter.format(conversation.lastMessageAt)}</strong>
        </article>
      </section>

      <ConversationReview
        conversationId={conversation.id}
        editable={canEdit(user)}
        initialRating={conversation.rating}
        initialReviewedAt={conversation.reviewedAt?.toISOString() ?? null}
      />

      <section className={`card ${styles.transcript}`}>
        <div className={styles.transcriptHead}>
          <h2>Historique des messages</h2>
          <span>
            {conversation.messages.length} message
            {conversation.messages.length > 1 ? "s" : ""}
          </span>
        </div>

        {conversation.messages.length ? (
          <div className={styles.messageList}>
            {conversation.messages.map((message) => {
              const inbound = message.direction === "INBOUND";
              return (
                <article
                  className={`${styles.message} ${
                    inbound
                      ? styles.messageInbound
                      : styles.messageOutbound
                  }`}
                  key={message.id}
                >
                  <div className={styles.messageHeader}>
                    <strong>
                      {inbound ? "Visiteur" : conversation.assistant.name}
                    </strong>
                    <time dateTime={message.createdAt.toISOString()}>
                      {dateFormatter.format(message.createdAt)}
                    </time>
                  </div>
                  <p className={styles.messageText}>{message.text}</p>
                  {inbound ? (
                    <div
                      aria-label="Signaux qualité du message"
                      className={qualityStyles.messageSignals}
                    >
                      <span className={qualityStyles.signal}>
                        Intention
                        <strong>{message.intent ?? "Non détectée"}</strong>
                      </span>
                      <span className={qualityStyles.signal}>
                        Confiance
                        <strong>
                          {message.confidence === null
                            ? "—"
                            : `${Math.round(message.confidence * 100)} %`}
                        </strong>
                      </span>
                      <span className={qualityStyles.signal}>
                        Latence
                        <strong>
                          {message.latencyMs === null
                            ? "—"
                            : `${message.latencyMs} ms`}
                        </strong>
                      </span>
                      <span
                        className={`${qualityStyles.signal} ${
                          message.isFallback
                            ? qualityStyles.fallback
                            : qualityStyles.fallbackOk
                        }`}
                      >
                        Fallback
                        <strong>{message.isFallback ? "Oui" : "Non"}</strong>
                      </span>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyCompact}>
            <div>
              <MessageSquareText />
              <p>Aucun message enregistré pour cette session.</p>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
