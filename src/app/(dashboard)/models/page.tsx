import { Box, CheckCircle2, Clock3, Database, RotateCcw } from "lucide-react";
import { ModelActions } from "@/components/model-actions";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Modèles & entraînements" };

function formatBytes(value: bigint) {
  const bytes = Number(value);
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

function dateLabel(value: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(value);
}

export default async function ModelsPage() {
  const user = await requireUser();
  const [artifacts, runs] = await Promise.all([
    db.modelArtifact.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        filename: true,
        sha256: true,
        sizeBytes: true,
        active: true,
        activatedAt: true,
        createdAt: true,
        rasaModelFile: true,
        assistant: { select: { name: true } },
        trainingRun: {
          select: { sourceHash: true, deploymentError: true }
        }
      }
    }),
    db.trainingRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { assistant: { select: { name: true } } }
    })
  ]);

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Runtime</p>
          <h1 className="page-title">Modèles & entraînements</h1>
          <p className="page-subtitle">
            Archives immuables, promotion du modèle actif et rollback vers une
            version antérieure.
          </p>
        </div>
      </div>

      <section className="grid metrics">
        <article className="card metric-card">
          <div className="metric-head">Archives <span className="metric-icon"><Database /></span></div>
          <div className="metric-value">{artifacts.length}</div>
          <div className="metric-note">modèles persistés</div>
        </article>
        <article className="card metric-card">
          <div className="metric-head">Modèle actif <span className="metric-icon"><CheckCircle2 /></span></div>
          <div className="metric-value">{artifacts.some((item) => item.active) ? "1" : "0"}</div>
          <div className="metric-note">runtime Rasa global</div>
        </article>
        <article className="card metric-card">
          <div className="metric-head">En attente <span className="metric-icon"><Clock3 /></span></div>
          <div className="metric-value">{runs.filter((run) => ["QUEUED", "RUNNING"].includes(run.status)).length}</div>
          <div className="metric-note">jobs durables</div>
        </article>
        <article className="card metric-card">
          <div className="metric-head">Rollback <span className="metric-icon"><RotateCcw /></span></div>
          <div className="metric-value">{Math.max(0, artifacts.length - 1)}</div>
          <div className="metric-note">versions disponibles</div>
        </article>
      </section>

      <div className="dashboard-stack">
        <section className="card">
          <div className="section-title section-pad">
            <div>
              <h2>Archives de modèles</h2>
              <p>Une promotion recharge Rasa depuis l’archive choisie.</p>
            </div>
          </div>
          {artifacts.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Assistant</th>
                    <th>Archive</th>
                    <th>Taille</th>
                    <th>Créée</th>
                    <th>État</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {artifacts.map((artifact) => (
                    <tr key={artifact.id}>
                      <td><strong>{artifact.assistant.name}</strong></td>
                      <td>
                        <span className="mono model-filename">{artifact.filename}</span>
                        <small className="hash-label">{artifact.sha256.slice(0, 12)}</small>
                      </td>
                      <td>{formatBytes(artifact.sizeBytes)}</td>
                      <td>{dateLabel(artifact.createdAt)}</td>
                      <td>
                        {artifact.trainingRun.deploymentError ? (
                          <span className="pill warning">Activation à relancer</span>
                        ) : artifact.active ? (
                          <span className="pill success">Déployé</span>
                        ) : (
                          <span className="pill">Disponible</span>
                        )}
                      </td>
                      <td>
                        <ModelActions
                          active={artifact.active}
                          canActivate={
                            user.role === "ADMIN" || user.role === "EDITOR"
                          }
                          canDelete={user.role === "ADMIN"}
                          id={artifact.id}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mini-empty model-empty">
              <Box />
              Entraînez un assistant pour créer sa première archive.
            </div>
          )}
        </section>

        <section className="card">
          <div className="section-title section-pad">
            <div>
              <h2>Historique des jobs</h2>
              <p>Les jobs interrompus sont repris automatiquement.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Assistant</th>
                  <th>État</th>
                  <th>Tentatives</th>
                  <th>Source</th>
                  <th>Démarré</th>
                  <th>Journal</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{run.assistant.name}</td>
                    <td>
                      <span className={`pill ${
                        run.status === "SUCCEEDED"
                          ? "success"
                          : run.status === "FAILED"
                            ? "danger"
                            : "warning"
                      }`}>{run.status}</span>
                    </td>
                    <td>{run.attempts}/{3}</td>
                    <td className="mono">{run.sourceHash.slice(0, 12)}</td>
                    <td>{dateLabel(run.createdAt)}</td>
                    <td><span title={run.log}>{run.log.split("\n")[0] || "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
