import { CheckCircle2, CircleAlert, ServerCog } from "lucide-react";

export function RasaStatusCard({
  overview
}: {
  overview: {
    connected: boolean;
    version: unknown;
    status: unknown;
    error: string | null;
  };
}) {
  const version =
    overview.version &&
    typeof overview.version === "object" &&
    "version" in overview.version
      ? String(overview.version.version)
      : "—";
  const status =
    overview.status &&
    typeof overview.status === "object" &&
    "model_file" in overview.status
      ? String(overview.status.model_file ?? "Aucun modèle")
      : "État protégé";

  return (
    <section className="card pad runtime-card">
      <div className="runtime-icon">
        <ServerCog />
      </div>
      <div className="runtime-copy">
        <div className="section-title">
          <div>
            <h2>Runtime Rasa</h2>
            <p>Connexion serveur et modèle actuellement chargé</p>
          </div>
          <span className={`pill ${overview.connected ? "success" : "danger"}`}>
            {overview.connected ? "Connecté" : "Indisponible"}
          </span>
        </div>
        <div className="runtime-details">
          <div>
            <span>Version</span>
            <strong>{version}</strong>
          </div>
          <div>
            <span>Modèle</span>
            <strong title={status}>{status.split("/").at(-1)}</strong>
          </div>
          <div>
            <span>API</span>
            <strong className={overview.connected ? "good" : "bad"}>
              {overview.connected ? <CheckCircle2 /> : <CircleAlert />}
              {overview.connected ? "Opérationnelle" : overview.error}
            </strong>
          </div>
        </div>
      </div>
    </section>
  );
}
