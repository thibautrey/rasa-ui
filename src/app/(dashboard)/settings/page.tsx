import {
  CheckCircle2,
  CircleAlert,
  KeyRound,
  RefreshCw,
  Server,
  ShieldCheck
} from "lucide-react";
import Link from "next/link";
import { getRasaOverview } from "@/lib/rasa";

export const metadata = { title: "Connexion Rasa" };
export const dynamic = "force-dynamic";

function safeEndpoint(value: string | undefined) {
  if (!value) return "Non configurée";
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "Configuration invalide";
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return "Configuration invalide";
  }
}

function objectString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) return null;
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "string" ? entry : null;
}

function safeModelName(status: unknown) {
  const filename = objectString(status, "model_file");
  if (!filename) return "Aucun modèle chargé";
  return filename.split(/[\\/]/).pop() || "Modèle chargé";
}

function StateIcon({ enabled }: { enabled: boolean }) {
  return enabled ? <CheckCircle2 /> : <CircleAlert />;
}

export default async function SettingsPage() {
  const overview = await getRasaOverview();
  const endpoint = safeEndpoint(process.env.RASA_BASE_URL);
  const tokenConfigured = Boolean(process.env.RASA_API_TOKEN);
  const version = objectString(overview.version, "version") ?? "Indisponible";
  const model = safeModelName(overview.status);

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Runtime</p>
          <h1 className="page-title">Connexion Rasa</h1>
          <p className="page-subtitle">
            État de la liaison serveur à serveur. Les secrets restent dans
            l’environnement du déploiement et ne sont jamais envoyés au
            navigateur.
          </p>
        </div>
        <Link className="button secondary" href="/settings">
          <RefreshCw />
          Actualiser
        </Link>
      </div>

      <section className="grid metrics">
        <article className="card metric-card">
          <div className="metric-head">
            Configuration
            <span className="metric-icon">
              <Server />
            </span>
          </div>
          <div className="metric-value metric-state">
            {process.env.RASA_BASE_URL ? "Définie" : "Absente"}
          </div>
          <div className="metric-note">RASA_BASE_URL côté serveur</div>
        </article>
        <article className="card metric-card">
          <div className="metric-head">
            Réseau
            <span className="metric-icon">
              <StateIcon enabled={overview.reachable} />
            </span>
          </div>
          <div className="metric-value metric-state">
            {overview.reachable ? "Joignable" : "Indisponible"}
          </div>
          <div className="metric-note">réponse HTTP du runtime</div>
        </article>
        <article className="card metric-card">
          <div className="metric-head">
            API protégée
            <span className="metric-icon">
              <KeyRound />
            </span>
          </div>
          <div className="metric-value metric-state">
            {overview.authenticated ? "Autorisée" : "Refusée"}
          </div>
          <div className="metric-note">
            jeton {tokenConfigured ? "configuré" : "non configuré"}
          </div>
        </article>
        <article className="card metric-card">
          <div className="metric-head">
            Disponibilité
            <span className="metric-icon">
              <StateIcon enabled={overview.ready} />
            </span>
          </div>
          <div className="metric-value metric-state">
            {overview.ready ? "Prêt" : "À vérifier"}
          </div>
          <div className="metric-note">modèle actif et API accessible</div>
        </article>
      </section>

      <div className="settings-grid">
        <section className="card pad">
          <div className="section-title">
            <div>
              <h2>Détails assainis</h2>
              <p>Aucune valeur de secret n’est affichée.</p>
            </div>
            <span
              className={`pill ${
                overview.connected ? "success" : "danger"
              }`}
            >
              {overview.connected ? "Connecté" : "Déconnecté"}
            </span>
          </div>
          <dl className="connection-details">
            <div>
              <dt>Origine Rasa</dt>
              <dd className="mono">{endpoint}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{version}</dd>
            </div>
            <div>
              <dt>Modèle actif</dt>
              <dd>{model}</dd>
            </div>
            <div>
              <dt>Authentification</dt>
              <dd>
                {tokenConfigured
                  ? "Jeton présent dans l’environnement"
                  : "Aucun jeton configuré"}
              </dd>
            </div>
          </dl>
          {overview.error ? (
            <div className="error-banner connection-error">
              <CircleAlert />
              <span>{overview.error}</span>
            </div>
          ) : (
            <div className="success-banner connection-error">
              <CheckCircle2 />
              <span>Le runtime répond avec un état authentifié.</span>
            </div>
          )}
        </section>

        <section className="card pad">
          <div className="settings-security-icon">
            <ShieldCheck />
          </div>
          <h2>Configuration hors navigateur</h2>
          <p>
            Modifiez l’URL et le jeton depuis les variables du service dans
            Coolify. Redémarrez ensuite cette interface pour recharger la
            configuration.
          </p>
          <ul className="settings-checklist">
            <li>Le jeton Rasa n’est jamais sérialisé dans cette page.</li>
            <li>Les appels passent par le serveur de l’interface.</li>
            <li>Seule l’origine assainie du runtime est affichée.</li>
          </ul>
        </section>
      </div>
    </>
  );
}
