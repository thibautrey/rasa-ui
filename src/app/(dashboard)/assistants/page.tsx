import { Bot, ChevronRight, Languages, Store, Workflow } from "lucide-react";
import Link from "next/link";
import { CreateAssistant } from "@/components/create-assistant";
import { canEdit, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

function statusClass(status?: string) {
  if (status === "SUCCEEDED") return "success";
  if (status === "FAILED") return "danger";
  return "warning";
}

export const metadata = { title: "Assistants" };

export default async function AssistantsPage() {
  const user = await requireUser();
  const editable = canEdit(user);
  const assistants = await db.assistant.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { storeBots: true, conversations: true } },
      trainingRuns: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Authoring</p>
          <h1 className="page-title">Assistants</h1>
          <p className="page-subtitle">
            Gérez les intentions, réponses, stories, règles et configurations
            sources de chaque assistant.
          </p>
        </div>
        {editable ? <CreateAssistant /> : null}
      </div>

      {assistants.length ? (
        <section className="assistant-grid">
          {assistants.map((assistant) => {
            const latest = assistant.trainingRuns[0];
            return (
              <Link
                className="card assistant-card"
                href={`/assistants/${assistant.id}`}
                key={assistant.id}
              >
                <div className="assistant-card-head">
                  <span className="assistant-orb">
                    <Bot />
                  </span>
                  <span className="icon-button">
                    <ChevronRight />
                  </span>
                </div>
                <h2>{assistant.name}</h2>
                <p>
                  {assistant.description ||
                    "Assistant Rasa prêt à être configuré."}
                </p>
                <div className="assistant-card-meta">
                  <span>
                    <Languages />
                    {assistant.language.toUpperCase()}
                  </span>
                  <span>
                    <Store />
                    {assistant._count.storeBots} widget
                    {assistant._count.storeBots > 1 ? "s" : ""}
                  </span>
                  <span>
                    <Workflow />
                    {assistant._count.conversations} conversations
                  </span>
                </div>
                <div className="assistant-card-foot">
                  <span className={`pill ${statusClass(latest?.status)}`}>
                    {latest?.status ?? "Non entraîné"}
                  </span>
                  <time>
                    {new Intl.DateTimeFormat("fr-FR", {
                      dateStyle: "medium"
                    }).format(assistant.updatedAt)}
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
              <Bot />
            </span>
            <h3>Aucun assistant</h3>
            <p>
              Créez un projet pour commencer à définir vos intentions, réponses
              et parcours conversationnels.
            </p>
            {editable ? <CreateAssistant /> : null}
          </div>
        </section>
      )}
    </>
  );
}
