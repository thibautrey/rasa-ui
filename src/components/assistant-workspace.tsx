"use client";

import {
  BookOpenText,
  Bot,
  Braces,
  Check,
  CircleAlert,
  Code2,
  FileClock,
  FileCode2,
  History,
  LoaderCircle,
  MessageSquareText,
  Network,
  Play,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NluEditor } from "@/components/nlu-editor";
import { TestConsole } from "@/components/test-console";

type TrainingRun = {
  id: string;
  status: string;
  modelName: string | null;
  log: string;
  createdAt: string;
  finishedAt: string | null;
};

type AssistantPayload = {
  id: string;
  name: string;
  description: string;
  language: string;
  slug: string;
  configYaml: string;
  domainYaml: string;
  nluYaml: string;
  storiesYaml: string;
  rulesYaml: string;
  endpointsYaml: string;
  credentialsYaml: string;
  activeModel: string | null;
  updatedAt: string;
  trainingRuns: TrainingRun[];
};

type AssistantRevision = {
  id: string;
  version: number;
  note: string;
  createdAt: string;
  createdBy: {
    id: string;
    name: string;
    email: string;
  };
};

const tabs = [
  { id: "nlu", label: "Intentions", icon: Braces },
  { id: "domain", label: "Domaine", icon: BookOpenText },
  { id: "stories", label: "Stories", icon: Network },
  { id: "rules", label: "Règles", icon: ShieldCheck },
  { id: "config", label: "Pipeline", icon: Settings2 },
  { id: "endpoints", label: "Connexions", icon: FileCode2 },
  { id: "history", label: "Révisions", icon: History },
  { id: "test", label: "Tester", icon: MessageSquareText }
] as const;

type TabId = (typeof tabs)[number]["id"];

export function AssistantWorkspace({
  initialAssistant,
  editable
}: {
  initialAssistant: AssistantPayload;
  editable: boolean;
}) {
  const router = useRouter();
  const [assistant, setAssistant] = useState(initialAssistant);
  const [tab, setTab] = useState<TabId>("nlu");
  const [pending, setPending] = useState(false);
  const [training, setTraining] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [revisions, setRevisions] = useState<AssistantRevision[]>([]);
  const [revisionState, setRevisionState] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [restoringRevision, setRestoringRevision] = useState("");

  const latestRun = assistant.trainingRuns[0];
  const trainingActive =
    latestRun?.status === "QUEUED" || latestRun?.status === "RUNNING";

  const loadRevisions = useCallback(async () => {
    setRevisionState("loading");
    try {
      const response = await fetch(
        `/api/assistants/${assistant.id}/revisions`,
        { cache: "no-store" }
      );
      const result = (await response.json()) as {
        error?: string;
        revisions?: Array<
          Omit<AssistantRevision, "createdAt"> & {
            createdAt: string | Date;
          }
        >;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Historique indisponible.");
      }
      setRevisions(
        (result.revisions ?? []).map((revision) => ({
          ...revision,
          createdAt: new Date(revision.createdAt).toISOString()
        }))
      );
      setRevisionState("loaded");
    } catch (caught) {
      setRevisionState("error");
      setError(
        caught instanceof Error ? caught.message : "Historique indisponible."
      );
    }
  }, [assistant.id]);

  useEffect(() => {
    if (!trainingActive && !training) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/assistants/${assistant.id}`, {
        cache: "no-store"
      });
      if (!response.ok) return;
      const payload = await response.json();
      setAssistant((current) => ({
        ...current,
        ...payload.assistant,
        trainingRuns: payload.assistant.trainingRuns.map(
          (run: TrainingRun & { createdAt: string | Date }) => ({
            ...run,
            createdAt: new Date(run.createdAt).toISOString(),
            finishedAt: run.finishedAt
              ? new Date(run.finishedAt).toISOString()
              : null
          })
        )
      }));
      if (
        !["QUEUED", "RUNNING"].includes(
          payload.assistant.trainingRuns[0]?.status
        )
      ) {
        setTraining(false);
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [assistant.id, training, trainingActive]);

  function patch(values: Partial<AssistantPayload>) {
    setAssistant((current) => ({ ...current, ...values }));
    setDirty(true);
    setNotice("");
  }

  function selectTab(nextTab: TabId) {
    setTab(nextTab);
    if (
      nextTab === "history" &&
      (revisionState === "idle" || revisionState === "error")
    ) {
      void loadRevisions();
    }
  }

  async function save() {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/assistants/${assistant.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: assistant.name,
          description: assistant.description,
          language: assistant.language,
          configYaml: assistant.configYaml,
          domainYaml: assistant.domainYaml,
          nluYaml: assistant.nluYaml,
          storiesYaml: assistant.storiesYaml,
          rulesYaml: assistant.rulesYaml,
          endpointsYaml: assistant.endpointsYaml,
          credentialsYaml: assistant.credentialsYaml
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Sauvegarde impossible.");
      setDirty(false);
      setNotice("Sources validées et sauvegardées.");
      if (revisionState === "loaded") await loadRevisions();
      router.refresh();
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Sauvegarde impossible."
      );
      return false;
    } finally {
      setPending(false);
    }
  }

  async function restoreRevision(revision: AssistantRevision) {
    const warning = dirty
      ? `Restaurer la version ${revision.version} ? Les modifications non sauvegardées seront perdues.`
      : `Restaurer la version ${revision.version} ? Une nouvelle révision de restauration sera créée.`;
    if (!window.confirm(warning)) return;

    setRestoringRevision(revision.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/assistants/${assistant.id}/revisions/${revision.id}/restore`,
        { method: "POST" }
      );
      const result = (await response.json()) as {
        assistant?: Partial<AssistantPayload>;
        error?: string;
      };
      if (!response.ok || !result.assistant) {
        throw new Error(result.error ?? "Restauration impossible.");
      }
      setAssistant((current) => ({ ...current, ...result.assistant }));
      setDirty(false);
      setNotice(
        `Version ${revision.version} restaurée. Une nouvelle révision a été créée.`
      );
      await loadRevisions();
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Restauration impossible."
      );
    } finally {
      setRestoringRevision("");
    }
  }

  async function train() {
    if (dirty && !(await save())) return;
    setTraining(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/assistants/${assistant.id}/train`, {
        method: "POST"
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Démarrage impossible.");
      setAssistant((current) => ({
        ...current,
        trainingRuns: [
          {
            ...result.run,
            createdAt: new Date(result.run.createdAt).toISOString()
          },
          ...current.trainingRuns
        ]
      }));
      setNotice("Entraînement placé dans la file d’exécution.");
    } catch (caught) {
      setTraining(false);
      setError(
        caught instanceof Error ? caught.message : "Démarrage impossible."
      );
    }
  }

  const rawEditor = useMemo(() => {
    const editors: Partial<
      Record<TabId, { key: keyof AssistantPayload; title: string; hint: string }>
    > = {
      domain: {
        key: "domainYaml",
        title: "Domaine Rasa",
        hint: "Intents, entités, slots, formulaires, actions et réponses."
      },
      stories: {
        key: "storiesYaml",
        title: "Parcours conversationnels",
        hint: "Stories utilisées par les politiques de dialogue."
      },
      rules: {
        key: "rulesYaml",
        title: "Règles déterministes",
        hint: "Comportements qui doivent toujours suivre le même chemin."
      },
      config: {
        key: "configYaml",
        title: "Pipeline NLU et politiques",
        hint: "Composants d’entraînement, hyperparamètres et policies."
      },
      endpoints: {
        key: "endpointsYaml",
        title: "Exports de connexion",
        hint:
          "Références pour l’action server, le tracker store et les canaux du runtime."
      }
    };
    return editors[tab];
  }, [tab]);

  return (
    <div className="workspace">
      <div className="workspace-head card">
        <div className="workspace-identity">
          <span className="assistant-orb large">
            <Bot />
          </span>
          <div>
            <div className="workspace-title-line">
              <input
                aria-label="Nom de l’assistant"
                className="workspace-name"
                onChange={(event) => patch({ name: event.target.value })}
                readOnly={!editable}
                value={assistant.name}
              />
              <span className="pill">{assistant.language}</span>
              {dirty ? <span className="pill warning">Non sauvegardé</span> : null}
            </div>
            <input
              aria-label="Description de l’assistant"
              className="workspace-description"
              onChange={(event) => patch({ description: event.target.value })}
              placeholder="Décrivez le rôle de cet assistant…"
              readOnly={!editable}
              value={assistant.description}
            />
          </div>
        </div>
        <div className="workspace-actions">
          {editable ? (
            <>
              <button
                className="button secondary"
                disabled={pending || !dirty}
                onClick={save}
                type="button"
              >
                {pending ? <LoaderCircle className="spin" /> : <Save />}
                Sauvegarder
              </button>
              <button
                className="button primary"
                disabled={training || trainingActive || pending}
                onClick={train}
                type="button"
              >
                {training || trainingActive ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <Play />
                )}
                {training || trainingActive ? "Entraînement…" : "Entraîner"}
              </button>
            </>
          ) : (
            <span className="pill">Lecture seule</span>
          )}
        </div>
      </div>

      <div className="workspace-status">
        {notice ? (
          <div className="success-banner">
            <Check /> {notice}
          </div>
        ) : null}
        {error ? (
          <div className="error-banner">
            <CircleAlert /> {error}
          </div>
        ) : null}
        {latestRun ? (
          <div
            className={`training-banner ${latestRun.status.toLowerCase()}`}
          >
            <span>
              {trainingActive ? (
                <LoaderCircle className="spin" />
              ) : latestRun.status === "SUCCEEDED" ? (
                <Sparkles />
              ) : (
                <CircleAlert />
              )}
            </span>
            <div>
              <strong>
                {trainingActive
                  ? "Entraînement en cours"
                  : latestRun.status === "SUCCEEDED"
                    ? "Dernier entraînement réussi"
                    : "Dernier entraînement en échec"}
              </strong>
              <small>
                {latestRun.modelName ?? latestRun.log.split("\n")[0]}
              </small>
            </div>
            <span className="pill">{latestRun.status}</span>
          </div>
        ) : null}
      </div>

      <div className="workspace-body">
        <nav className="workspace-tabs">
          {tabs.map((item) => (
            <button
              className={tab === item.id ? "active" : ""}
              key={item.id}
              onClick={() => selectTab(item.id)}
              type="button"
            >
              <item.icon />
              {item.label}
            </button>
          ))}
        </nav>

        <section className="workspace-panel card">
          {tab === "nlu" ? (
            <NluEditor
              editable={editable}
              onChange={(nluYaml) => patch({ nluYaml })}
              value={assistant.nluYaml}
            />
          ) : null}
          {rawEditor ? (
            <div className="yaml-editor">
              <div className="editor-intro">
                <div>
                  <p className="eyebrow">Mode avancé</p>
                  <h3>{rawEditor.title}</h3>
                  <p>{rawEditor.hint}</p>
                </div>
                <span className="pill">
                  <Code2 /> YAML
                </span>
              </div>
              {tab === "endpoints" ? (
                <div className="reference-banner">
                  <CircleAlert />
                  <div>
                    <strong>Exports de référence uniquement</strong>
                    <span>
                      endpoints.yml et credentials.yml sont conservés pour
                      export. L’entraînement ne les applique pas à Rasa :
                      déployez-les dans le runtime puis redémarrez le service.
                    </span>
                  </div>
                </div>
              ) : null}
              <textarea
                className="yaml-textarea mono"
                onChange={(event) =>
                  patch({ [rawEditor.key]: event.target.value })
                }
                readOnly={!editable}
                spellCheck={false}
                value={String(assistant[rawEditor.key] ?? "")}
              />
              {tab === "endpoints" ? (
                <details className="credentials-editor">
                  <summary>
                    credentials.yml · export de référence des canaux
                  </summary>
                  <textarea
                    className="yaml-textarea mono small"
                    onChange={(event) =>
                      patch({ credentialsYaml: event.target.value })
                    }
                    readOnly={!editable}
                    spellCheck={false}
                    value={assistant.credentialsYaml}
                  />
                </details>
              ) : null}
            </div>
          ) : null}
          {tab === "history" ? (
            <div className="revision-panel">
              <div className="editor-intro">
                <div>
                  <p className="eyebrow">Versioning</p>
                  <h3>Historique des sources</h3>
                  <p>
                    Chaque sauvegarde crée un instantané immuable. Restaurer
                    une version crée une nouvelle révision sans effacer
                    l’historique.
                  </p>
                </div>
                <button
                  className="button secondary compact"
                  disabled={revisionState === "loading"}
                  onClick={() => void loadRevisions()}
                  type="button"
                >
                  {revisionState === "loading" ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <History />
                  )}
                  Actualiser
                </button>
              </div>

              {revisionState === "loading" && !revisions.length ? (
                <div className="mini-empty revision-empty">
                  <LoaderCircle className="spin" />
                  Chargement de l’historique…
                </div>
              ) : revisions.length ? (
                <div className="revision-list">
                  {revisions.map((revision, index) => (
                    <article className="revision-row" key={revision.id}>
                      <span className="revision-marker">
                        <FileClock />
                      </span>
                      <div className="revision-copy">
                        <div className="revision-title">
                          <strong>Version {revision.version}</strong>
                          {index === 0 ? (
                            <span className="pill success">Actuelle</span>
                          ) : null}
                        </div>
                        <p>{revision.note || "Sauvegarde sans note"}</p>
                        <span>
                          {revision.createdBy.name} ·{" "}
                          {new Intl.DateTimeFormat("fr-FR", {
                            dateStyle: "medium",
                            timeStyle: "short"
                          }).format(new Date(revision.createdAt))}
                        </span>
                      </div>
                      <button
                        className="button secondary compact"
                        disabled={
                          !editable ||
                          index === 0 ||
                          Boolean(restoringRevision) ||
                          pending
                        }
                        onClick={() => void restoreRevision(revision)}
                        type="button"
                      >
                        {restoringRevision === revision.id ? (
                          <LoaderCircle className="spin" />
                        ) : (
                          <RotateCcw />
                        )}
                        Restaurer
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="mini-empty revision-empty">
                  <FileClock />
                  La première sauvegarde créera une révision.
                </div>
              )}
            </div>
          ) : null}
          {tab === "test" ? (
            <TestConsole assistantId={assistant.id} />
          ) : null}
        </section>
      </div>
    </div>
  );
}
