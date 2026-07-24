import {
  Activity,
  Bot,
  MessageSquareText,
  MessagesSquare
} from "lucide-react";
import Link from "next/link";
import { db } from "@/lib/db";
import styles from "../insights.module.css";

export const metadata = { title: "Analytics" };

type DailyVolumeRow = {
  day: Date;
  total: bigint;
};

type BreakdownItem = {
  count: number;
  href?: string;
  label: string;
  note: string;
};

const shortDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short"
});

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function BreakdownList({
  emptyLabel,
  items
}: {
  emptyLabel: string;
  items: BreakdownItem[];
}) {
  if (!items.length) {
    return <div className={styles.emptyCompact}>{emptyLabel}</div>;
  }

  const maximum = Math.max(...items.map((item) => item.count), 1);
  return (
    <div className={styles.breakdownList}>
      {items.map((item) => {
        const content = (
          <>
            <div className={styles.breakdownLine}>
              <div>
                <strong>{item.label}</strong>
                <span>{item.note}</span>
              </div>
              <strong>{item.count}</strong>
            </div>
            <div className={styles.progress}>
              <span
                style={{
                  width: `${Math.max((item.count / maximum) * 100, 3)}%`
                }}
              />
            </div>
          </>
        );

        return item.href ? (
          <Link
            className={styles.breakdownRow}
            href={item.href}
            key={`${item.label}-${item.note}`}
          >
            {content}
          </Link>
        ) : (
          <div
            className={styles.breakdownRow}
            key={`${item.label}-${item.note}`}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

export default async function AnalyticsPage() {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - 29);

  const [
    conversationCount,
    messageCount,
    inboundCount,
    activeAssistantCount,
    dailyRows,
    channelGroups,
    assistants,
    widgets
  ] = await Promise.all([
    db.conversation.count({ where: { createdAt: { gte: since } } }),
    db.message.count({ where: { createdAt: { gte: since } } }),
    db.message.count({
      where: { createdAt: { gte: since }, direction: "INBOUND" }
    }),
    db.assistant.count({
      where: { conversations: { some: { createdAt: { gte: since } } } }
    }),
    db.$queryRaw<DailyVolumeRow[]>`
      SELECT
        DATE_TRUNC('day', "created_at") AS "day",
        COUNT(*)::bigint AS "total"
      FROM "messages"
      WHERE "created_at" >= ${since}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    db.conversation.groupBy({
      by: ["channel"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { channel: "desc" } }
    }),
    db.assistant.findMany({
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            conversations: { where: { createdAt: { gte: since } } }
          }
        }
      }
    }),
    db.storeBot.findMany({
      select: {
        id: true,
        name: true,
        enabled: true,
        assistant: { select: { name: true } },
        _count: {
          select: {
            conversations: { where: { createdAt: { gte: since } } }
          }
        }
      }
    })
  ]);

  const dailyByDate = new Map(
    dailyRows.map((row) => [
      localDateKey(new Date(row.day)),
      Number(row.total)
    ])
  );
  const dailyVolumes = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(since);
    date.setDate(since.getDate() + index);
    return {
      date,
      total: dailyByDate.get(localDateKey(date)) ?? 0
    };
  });
  const maximumDailyVolume = Math.max(
    ...dailyVolumes.map((volume) => volume.total),
    1
  );
  const averageMessages = conversationCount
    ? (messageCount / conversationCount).toFixed(1)
    : "0";
  const inboundShare = messageCount
    ? Math.round((inboundCount / messageCount) * 100)
    : 0;

  const channelItems: BreakdownItem[] = channelGroups.map((group) => ({
    count: group._count._all,
    href: `/conversations?channel=${encodeURIComponent(group.channel)}`,
    label:
      group.channel.charAt(0).toUpperCase() + group.channel.slice(1),
    note: "Conversations créées"
  }));
  const assistantItems: BreakdownItem[] = assistants
    .map((assistant) => ({
      count: assistant._count.conversations,
      href: `/assistants/${assistant.id}`,
      label: assistant.name,
      note: "Conversations sur 30 jours"
    }))
    .filter((assistant) => assistant.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);
  const widgetItems: BreakdownItem[] = widgets
    .map((widget) => ({
      count: widget._count.conversations,
      href: `/conversations?q=${encodeURIComponent(widget.name)}`,
      label: widget.name,
      note: `${widget.assistant.name} · ${
        widget.enabled ? "actif" : "désactivé"
      }`
    }))
    .filter((widget) => widget.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Performance</p>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">
            Activité consolidée des 30 derniers jours, du{" "}
            {shortDateFormatter.format(since)} à aujourd’hui.
          </p>
        </div>
        <Link className="button secondary" href="/conversations">
          Voir les conversations
        </Link>
      </div>

      <section className="grid metrics">
        <article className="card metric-card">
          <div className="metric-head">
            Conversations
            <span className="metric-icon">
              <MessagesSquare />
            </span>
          </div>
          <div className="metric-value">{conversationCount}</div>
          <div className="metric-note">nouvelles sessions sur 30 jours</div>
        </article>
        <article className="card metric-card">
          <div className="metric-head">
            Messages
            <span className="metric-icon">
              <MessageSquareText />
            </span>
          </div>
          <div className="metric-value">{messageCount}</div>
          <div className="metric-note">
            {averageMessages} messages par conversation
          </div>
        </article>
        <article className="card metric-card">
          <div className="metric-head">
            Messages visiteurs
            <span className="metric-icon">
              <Activity />
            </span>
          </div>
          <div className="metric-value">{inboundShare}%</div>
          <div className="metric-note">{inboundCount} messages entrants</div>
        </article>
        <article className="card metric-card">
          <div className="metric-head">
            Assistants actifs
            <span className="metric-icon">
              <Bot />
            </span>
          </div>
          <div className="metric-value">{activeAssistantCount}</div>
          <div className="metric-note">avec au moins une nouvelle session</div>
        </article>
      </section>

      <section className={`card ${styles.chartCard}`}>
        <div className="section-title">
          <div>
            <h2>Volume journalier</h2>
            <p>Messages entrants et sortants cumulés</p>
          </div>
          <span className="pill">30 jours</span>
        </div>
        <div className={styles.chartViewport}>
          <div
            aria-label="Volume de messages par jour"
            className={styles.chart}
            role="img"
          >
            {dailyVolumes.map((volume, index) => {
              const height = volume.total
                ? Math.max((volume.total / maximumDailyVolume) * 100, 3)
                : 0;
              return (
                <div className={styles.chartDay} key={localDateKey(volume.date)}>
                  <div
                    className={styles.barTrack}
                    title={`${shortDateFormatter.format(volume.date)} : ${
                      volume.total
                    } message${volume.total > 1 ? "s" : ""}`}
                  >
                    <span
                      className={styles.bar}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                  <span className={styles.chartLabel}>
                    {index % 5 === 0 || index === dailyVolumes.length - 1
                      ? shortDateFormatter.format(volume.date)
                      : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className={styles.breakdowns}>
        <article className={`card ${styles.breakdownCard}`}>
          <div className="section-title">
            <div>
              <h2>Canaux</h2>
              <p>Origine des nouvelles sessions</p>
            </div>
          </div>
          <BreakdownList
            emptyLabel="Aucun canal actif sur cette période."
            items={channelItems}
          />
        </article>
        <article className={`card ${styles.breakdownCard}`}>
          <div className="section-title">
            <div>
              <h2>Widgets</h2>
              <p>Points de contact les plus utilisés</p>
            </div>
          </div>
          <BreakdownList
            emptyLabel="Aucun widget utilisé sur cette période."
            items={widgetItems}
          />
        </article>
        <article className={`card ${styles.breakdownCard}`}>
          <div className="section-title">
            <div>
              <h2>Top assistants</h2>
              <p>Classement par nouvelles conversations</p>
            </div>
          </div>
          <BreakdownList
            emptyLabel="Aucun assistant actif sur cette période."
            items={assistantItems}
          />
        </article>
      </section>
    </>
  );
}
