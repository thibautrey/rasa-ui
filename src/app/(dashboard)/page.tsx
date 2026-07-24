import {
  Bot,
  Boxes,
  MessageSquareText,
  Store,
  WandSparkles
} from "lucide-react";
import Link from "next/link";
import { CreateAssistant } from "@/components/create-assistant";
import { RasaStatusCard } from "@/components/rasa-status-card";
import { db } from "@/lib/db";
import { getRasaOverview } from "@/lib/rasa";

function dateLabel(date: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export default async function DashboardPage() {
  const [
    assistantCount,
    conversationCount,
    botCount,
    trainingCount,
    recentAssistants,
    recentRuns,
    rasa
  ] = await Promise.all([
    db.assistant.count(),
    db.conversation.count(),
    db.storeBot.count({ where: { enabled: true } }),
    db.trainingRun.count({ where: { status: "SUCCEEDED" } }),
    db.assistant.findMany({
      orderBy: { updatedAt: "desc" },
      take: 4,
      include: {
        _count: { select: { storeBots: true, conversations: true } },
        trainingRuns: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    }),
    db.trainingRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { assistant: { select: { name: true } } }
    }),
    getRasaOverview()
  ]);

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Control plane</p>
          <h1 className="page-title">Vue d’ensemble</h1>
          <p className="page-subtitle">
            Pilotez vos assistants, leurs modèles et les points de contact
            déployés sur vos boutiques.
          </p>
        </div>
        <CreateAssistant />
      </div>

      <section className="grid metrics">
        <article className="card metric-card">
          <div className="metric-head">
            Assistants
            <span className="metric-icon">
              <Bot />
            </span>
          </div>
          <div className="metric-value">{assistantCount}</div>
          <div className="metric-note">projets éditables</div>
        </article>
        <article className="card metric-card">
          <div className="metric-head">
            Conversations
            <span className="metric-icon">
              <MessageSquareText />
            </span>
          </div>
          <div className="metric-value">{conversationCount}</div>
          <div className="metric-note">sessions indexées</div>
        </article>
        <article className="card metric-card">
          <div className="metric-head">
            Widgets actifs
            <span className="metric-icon">
              <Store />
            </span>
          </div>
          <div className="metric-value">{botCount}</div>
          <div className="metric-note">boutiques connectées</div>
        </article>
        <article className="card metric-card">
          <div className="metric-head">
            Modèles entraînés
            <span className="metric-icon">
              <Boxes />
            </span>
          </div>
          <div className="metric-value">{trainingCount}</div>
          <div className="metric-note">exécutions réussies</div>
        </article>
      </section>

      <div className="dashboard-stack">
        <RasaStatusCard overview={rasa} />

        <div className="grid two">
          <section className="card pad">
            <div className="section-title">
              <div>
                <h2>Assistants récents</h2>
                <p>Derniers projets modifiés</p>
              </div>
              <Link className="button secondary compact" href="/assistants">
                Tout voir
              </Link>
            </div>
            {recentAssistants.length ? (
              <div className="assistant-mini-list">
                {recentAssistants.map((assistant) => (
                  <Link
                    className="assistant-mini"
                    href={`/assistants/${assistant.id}`}
                    key={assistant.id}
                  >
                    <span className="assistant-mini-icon">
                      <WandSparkles />
                    </span>
                    <span className="assistant-mini-copy">
                      <strong>{assistant.name}</strong>
                      <span>
                        {assistant.language.toUpperCase()} ·{" "}
                        {assistant._count.storeBots} widget
                        {assistant._count.storeBots > 1 ? "s" : ""}
                      </span>
                    </span>
                    <span className="assistant-mini-time">
                      {dateLabel(assistant.updatedAt)}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="mini-empty">
                Aucun assistant. Créez votre premier projet.
              </div>
            )}
          </section>

          <section className="card pad">
            <div className="section-title">
              <div>
                <h2>Activité des modèles</h2>
                <p>Entraînements les plus récents</p>
              </div>
              <Link className="button secondary compact" href="/models">
                Historique
              </Link>
            </div>
            {recentRuns.length ? (
              <div className="run-list">
                {recentRuns.map((run) => (
                  <div className="run-row" key={run.id}>
                    <span
                      className={`run-indicator ${run.status.toLowerCase()}`}
                    />
                    <div>
                      <strong>{run.assistant.name}</strong>
                      <span>{dateLabel(run.createdAt)}</span>
                    </div>
                    <span
                      className={`pill ${
                        run.status === "SUCCEEDED"
                          ? "success"
                          : run.status === "FAILED"
                            ? "danger"
                            : "warning"
                      }`}
                    >
                      {run.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mini-empty">
                Les entraînements apparaîtront ici.
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
