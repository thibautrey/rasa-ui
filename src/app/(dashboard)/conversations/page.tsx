import { MessageSquareText, Search } from "lucide-react";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import styles from "../insights.module.css";

export const metadata = { title: "Conversations" };

type SearchParams = Record<string, string | string[] | undefined>;
type Props = { searchParams: Promise<SearchParams> };

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short"
});

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function channelLabel(channel: string) {
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

export default async function ConversationsPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = firstValue(params.q).trim();
  const channel = firstValue(params.channel).trim();
  const assistantId = firstValue(params.assistant).trim();
  const filters: Prisma.ConversationWhereInput[] = [];

  if (query) {
    filters.push({
      OR: [
        { senderId: { contains: query, mode: "insensitive" } },
        {
          assistant: {
            name: { contains: query, mode: "insensitive" }
          }
        },
        {
          storeBot: {
            is: { name: { contains: query, mode: "insensitive" } }
          }
        },
        {
          messages: {
            some: { text: { contains: query, mode: "insensitive" } }
          }
        }
      ]
    });
  }
  if (channel) filters.push({ channel });
  if (assistantId) filters.push({ assistantId });

  const where: Prisma.ConversationWhereInput | undefined = filters.length
    ? { AND: filters }
    : undefined;

  const [assistants, channelRows, conversations] = await Promise.all([
    db.assistant.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true }
    }),
    db.conversation.findMany({
      distinct: ["channel"],
      orderBy: { channel: "asc" },
      select: { channel: true }
    }),
    db.conversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take: 100,
      include: {
        assistant: { select: { id: true, name: true } },
        storeBot: { select: { id: true, name: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { direction: true, text: true }
        },
        _count: { select: { messages: true } }
      }
    })
  ]);

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Observabilité</p>
          <h1 className="page-title">Conversations</h1>
          <p className="page-subtitle">
            Consultez les sessions les plus récentes, quel que soit leur
            assistant, leur canal ou leur widget d’origine.
          </p>
        </div>
      </div>

      <form
        action="/conversations"
        className={`card ${styles.filters}`}
        method="get"
      >
        <div className={styles.filterField}>
          <label htmlFor="conversation-search">Recherche</label>
          <input
            className="input"
            defaultValue={query}
            id="conversation-search"
            name="q"
            placeholder="Expéditeur, assistant, widget ou message…"
          />
        </div>
        <div className={styles.filterField}>
          <label htmlFor="conversation-channel">Canal</label>
          <select
            className="select"
            defaultValue={channel}
            id="conversation-channel"
            name="channel"
          >
            <option value="">Tous les canaux</option>
            {channelRows.map((row) => (
              <option key={row.channel} value={row.channel}>
                {channelLabel(row.channel)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filterField}>
          <label htmlFor="conversation-assistant">Assistant</label>
          <select
            className="select"
            defaultValue={assistantId}
            id="conversation-assistant"
            name="assistant"
          >
            <option value="">Tous les assistants</option>
            {assistants.map((assistant) => (
              <option key={assistant.id} value={assistant.id}>
                {assistant.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filterActions}>
          <button className="button primary" type="submit">
            <Search />
            Filtrer
          </button>
          {(query || channel || assistantId) && (
            <Link className="button secondary" href="/conversations">
              Réinitialiser
            </Link>
          )}
        </div>
      </form>

      <div className={styles.resultSummary}>
        <span>
          {conversations.length} conversation
          {conversations.length > 1 ? "s" : ""}
          {conversations.length === 100 ? " (100 plus récentes)" : ""}
        </span>
        <span>Triées par dernière activité</span>
      </div>

      {conversations.length ? (
        <section
          aria-label="Liste des conversations"
          className={styles.conversationList}
        >
          {conversations.map((conversation) => {
            const latestMessage = conversation.messages[0];
            return (
              <Link
                className={`card ${styles.conversationRow}`}
                href={`/conversations/${conversation.id}`}
                key={conversation.id}
              >
                <div className={styles.conversationIdentity}>
                  <div className={styles.channelLine}>
                    <span className="pill">
                      {channelLabel(conversation.channel)}
                    </span>
                  </div>
                  <strong>{conversation.assistant.name}</strong>
                  <span className="mono">{conversation.senderId}</span>
                </div>
                <div className={styles.conversationPreview}>
                  <strong>
                    {conversation.storeBot?.name ?? "Console Studio"}
                  </strong>
                  <span>
                    {latestMessage
                      ? `${latestMessage.direction === "INBOUND" ? "Visiteur" : "Assistant"} : ${latestMessage.text}`
                      : "Aucun message enregistré"}
                  </span>
                </div>
                <div className={styles.conversationMeta}>
                  <span>
                    {conversation._count.messages} message
                    {conversation._count.messages > 1 ? "s" : ""}
                  </span>
                  <time dateTime={conversation.lastMessageAt.toISOString()}>
                    {dateFormatter.format(conversation.lastMessageAt)}
                  </time>
                </div>
              </Link>
            );
          })}
        </section>
      ) : (
        <section className="card empty-state">
          <div>
            <span className="empty-state-icon">
              <MessageSquareText />
            </span>
            <h3>Aucune conversation</h3>
            <p>
              Aucune session ne correspond aux filtres sélectionnés. Modifiez
              la recherche ou démarrez un échange depuis un assistant.
            </p>
            {(query || channel || assistantId) && (
              <Link className="button secondary" href="/conversations">
                Effacer les filtres
              </Link>
            )}
          </div>
        </section>
      )}
    </>
  );
}
