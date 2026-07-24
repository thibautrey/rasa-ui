import { Orbit, ShieldCheck, Sparkles } from "lucide-react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getSession } from "@/lib/auth";
import "./login.css";

export default async function LoginPage() {
  if (await getSession()) redirect("/");

  return (
    <main className="login-page">
      <section className="login-visual">
        <div className="login-brand">
          <div className="brand-mark">
            <Orbit size={20} />
          </div>
          <div className="brand-copy">
            <strong>Pleiades</strong>
            <span>Rasa Control</span>
          </div>
        </div>
        <div className="login-message">
          <p className="eyebrow">Open control plane</p>
          <h1>
            Construisez des conversations
            <span> qui restent sous votre contrôle.</span>
          </h1>
          <p>
            Authoring, entraînement, analyse et déploiement de widgets boutiques,
            sans exposer votre serveur Rasa ni ses secrets.
          </p>
        </div>
        <div className="login-benefits">
          <span>
            <ShieldCheck /> Authentification interne
          </span>
          <span>
            <Sparkles /> Interface indépendante
          </span>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="login-card-head">
            <p className="eyebrow">Bienvenue</p>
            <h2>Connexion au workspace</h2>
            <p>Utilisez le compte administrateur configuré dans Coolify.</p>
          </div>
          <LoginForm />
          <p className="login-security">
            Session chiffrée · Le jeton Rasa reste exclusivement côté serveur
          </p>
        </div>
      </section>
    </main>
  );
}
