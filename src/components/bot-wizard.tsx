"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clipboard,
  Code2,
  LoaderCircle,
  MessageCircle,
  Pause,
  Palette,
  Pencil,
  Play,
  ShieldCheck,
  Store,
  Trash2,
  WandSparkles
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

type AssistantOption = { id: string; name: string };
type ExistingBot = {
  id: string;
  assistantId: string;
  name: string;
  publicKey: string;
  enabled: boolean;
  assistant: { name: string };
  allowedOrigins: unknown;
  primaryColor: string;
  accentColor: string;
  position: string;
  welcomeMessage: string;
  placeholder: string;
  launcherLabel: string;
  avatarUrl: string | null;
  locale: string;
};

const steps = [
  { label: "Assistant", icon: WandSparkles },
  { label: "Apparence", icon: Palette },
  { label: "Sécurité", icon: ShieldCheck },
  { label: "Installation", icon: Code2 }
];

export function BotWizard({
  assistants,
  existingBots,
  appUrl,
  canEditBots,
  canDeleteBots
}: {
  assistants: AssistantOption[];
  existingBots: ExistingBot[];
  appUrl: string;
  canEditBots: boolean;
  canDeleteBots: boolean;
}) {
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [createdKey, setCreatedKey] = useState("");
  const [copiedKey, setCopiedKey] = useState("");
  const [editingId, setEditingId] = useState("");
  const [bots, setBots] = useState(existingBots);
  const [form, setForm] = useState({
    assistantId: assistants[0]?.id ?? "",
    name: "Conseiller Pleiades",
    primaryColor: "#8b6cff",
    accentColor: "#31d6bd",
    position: "right" as "left" | "right",
    welcomeMessage: "Bonjour ! Comment puis-je vous aider ?",
    placeholder: "Écrivez votre message…",
    launcherLabel: "Besoin d'aide ?",
    avatarUrl: "",
    locale: "fr",
    allowedOrigins: "",
    enabled: true
  });

  const snippet = useMemo(
    () => (createdKey ? installSnippet(appUrl, createdKey) : ""),
    [appUrl, createdKey]
  );

  function patch(values: Partial<typeof form>) {
    setForm((current) => ({ ...current, ...values }));
    setError("");
  }

  function validateCurrent() {
    if (!form.assistantId || !form.name.trim()) {
      setError("Sélectionnez un assistant et indiquez un nom.");
      return false;
    }
    if (step === 2 && !form.allowedOrigins.trim()) {
      setError("Ajoutez au moins un domaine boutique autorisé.");
      return false;
    }
    return true;
  }

  async function next() {
    if (!validateCurrent()) return;
    if (step < 2) {
      setStep((current) => current + 1);
      return;
    }

    setPending(true);
    try {
      const response = await fetch(
        editingId ? `/api/bots/${editingId}` : "/api/bots",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            allowedOrigins: form.allowedOrigins
              .split(/[\n,]/)
              .map((origin) => origin.trim())
              .filter(Boolean)
          })
        }
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(
          result.error ??
            (editingId ? "Modification impossible." : "Création impossible.")
        );
      }
      const assistantName =
        assistants.find((assistant) => assistant.id === result.bot.assistantId)
          ?.name ?? "Assistant";
      const savedBot = {
        ...result.bot,
        assistant: { name: assistantName }
      } as ExistingBot;
      setBots((current) =>
        editingId
          ? current.map((bot) => (bot.id === editingId ? savedBot : bot))
          : [savedBot, ...current]
      );
      setCreatedKey(result.bot.publicKey);
      setStep(3);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Création impossible."
      );
    } finally {
      setPending(false);
    }
  }

  async function copySnippet() {
    await navigator.clipboard.writeText(snippet);
    setCopiedKey(createdKey);
    window.setTimeout(() => setCopiedKey(""), 1800);
  }

  function editBot(bot: ExistingBot) {
    const allowedOrigins = Array.isArray(bot.allowedOrigins)
      ? bot.allowedOrigins.filter(
          (origin): origin is string => typeof origin === "string"
        )
      : [];
    setForm({
      assistantId: bot.assistantId,
      name: bot.name,
      primaryColor: bot.primaryColor,
      accentColor: bot.accentColor,
      position: bot.position === "left" ? "left" : "right",
      welcomeMessage: bot.welcomeMessage,
      placeholder: bot.placeholder,
      launcherLabel: bot.launcherLabel,
      avatarUrl: bot.avatarUrl ?? "",
      locale: bot.locale,
      allowedOrigins: allowedOrigins.join("\n"),
      enabled: bot.enabled
    });
    setEditingId(bot.id);
    setCreatedKey("");
    setStep(0);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveBotState(bot: ExistingBot, enabled: boolean) {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/bots/${bot.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistantId: bot.assistantId,
          name: bot.name,
          allowedOrigins: Array.isArray(bot.allowedOrigins)
            ? bot.allowedOrigins.filter(
                (origin): origin is string => typeof origin === "string"
              )
            : [],
          primaryColor: bot.primaryColor,
          accentColor: bot.accentColor,
          position: bot.position === "left" ? "left" : "right",
          welcomeMessage: bot.welcomeMessage,
          placeholder: bot.placeholder,
          launcherLabel: bot.launcherLabel,
          avatarUrl: bot.avatarUrl ?? "",
          locale: bot.locale,
          enabled
        })
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Mise à jour impossible.");
      }
      setBots((current) =>
        current.map((entry) =>
          entry.id === bot.id
            ? { ...entry, ...result.bot, assistant: entry.assistant }
            : entry
        )
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Mise à jour impossible."
      );
    } finally {
      setPending(false);
    }
  }

  async function deleteBot(bot: ExistingBot) {
    if (
      !window.confirm(
        `Supprimer définitivement le widget « ${bot.name} » et sa clé publique ?`
      )
    ) {
      return;
    }
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/bots/${bot.id}`, {
        method: "DELETE"
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Suppression impossible.");
      }
      setBots((current) => current.filter((entry) => entry.id !== bot.id));
      if (editingId === bot.id) {
        setEditingId("");
        setStep(0);
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Suppression impossible."
      );
    } finally {
      setPending(false);
    }
  }

  async function copyExistingSnippet(bot: ExistingBot) {
    await navigator.clipboard.writeText(installSnippet(appUrl, bot.publicKey));
    setCopiedKey(bot.publicKey);
    window.setTimeout(() => setCopiedKey(""), 1800);
  }

  return (
    <div className="integration-layout">
      <section className="card wizard">
        <div className="wizard-progress">
          {steps.map((item, index) => (
            <div
              className={`${index === step ? "active" : ""} ${
                index < step ? "done" : ""
              }`}
              key={item.label}
            >
              <span>{index < step ? <Check /> : <item.icon />}</span>
              <small>{item.label}</small>
            </div>
          ))}
        </div>

        <div className="wizard-content">
          {step === 0 ? (
            <div className="wizard-step">
              <div className="wizard-title">
                <p className="eyebrow">Étape 1</p>
                <h2>
                  {editingId ? "Modifier le widget" : "Choisir l’assistant"}
                </h2>
                <p>
                  Ce widget enverra les messages au modèle Rasa actif et les
                  conversations seront rattachées à ce projet.
                </p>
              </div>
              <div className="field">
                <label htmlFor="bot-assistant">Assistant source</label>
                <select
                  className="select"
                  id="bot-assistant"
                  onChange={(event) =>
                    patch({ assistantId: event.target.value })
                  }
                  value={form.assistantId}
                >
                  <option disabled value="">
                    Sélectionner…
                  </option>
                  {assistants.map((assistant) => (
                    <option key={assistant.id} value={assistant.id}>
                      {assistant.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="bot-name">Nom affiché</label>
                  <input
                    className="input"
                    id="bot-name"
                    onChange={(event) => patch({ name: event.target.value })}
                    value={form.name}
                  />
                </div>
                <div className="field">
                  <label htmlFor="bot-locale">Langue</label>
                  <select
                    className="select"
                    id="bot-locale"
                    onChange={(event) => patch({ locale: event.target.value })}
                    value={form.locale}
                  >
                    <option value="fr">Français</option>
                    <option value="en">English</option>
                    <option value="es">Español</option>
                    <option value="de">Deutsch</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="welcome-message">Message d’accueil</label>
                <textarea
                  className="textarea"
                  id="welcome-message"
                  onChange={(event) =>
                    patch({ welcomeMessage: event.target.value })
                  }
                  value={form.welcomeMessage}
                />
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="wizard-step">
              <div className="wizard-title">
                <p className="eyebrow">Étape 2</p>
                <h2>Personnaliser l’expérience</h2>
                <p>
                  Le widget est isolé dans un Shadow DOM et ne modifie pas les
                  styles du thème de la boutique.
                </p>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="primary-color">Couleur principale</label>
                  <div className="color-input">
                    <input
                      id="primary-color"
                      onChange={(event) =>
                        patch({ primaryColor: event.target.value })
                      }
                      type="color"
                      value={form.primaryColor}
                    />
                    <input
                      className="input mono"
                      onChange={(event) =>
                        patch({ primaryColor: event.target.value })
                      }
                      value={form.primaryColor}
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="accent-color">Couleur d’accent</label>
                  <div className="color-input">
                    <input
                      id="accent-color"
                      onChange={(event) =>
                        patch({ accentColor: event.target.value })
                      }
                      type="color"
                      value={form.accentColor}
                    />
                    <input
                      className="input mono"
                      onChange={(event) =>
                        patch({ accentColor: event.target.value })
                      }
                      value={form.accentColor}
                    />
                  </div>
                </div>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="launcher-label">Texte du bouton</label>
                  <input
                    className="input"
                    id="launcher-label"
                    onChange={(event) =>
                      patch({ launcherLabel: event.target.value })
                    }
                    value={form.launcherLabel}
                  />
                </div>
                <div className="field">
                  <label htmlFor="position">Position</label>
                  <select
                    className="select"
                    id="position"
                    onChange={(event) =>
                      patch({
                        position: event.target.value as "left" | "right"
                      })
                    }
                    value={form.position}
                  >
                    <option value="right">En bas à droite</option>
                    <option value="left">En bas à gauche</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="placeholder">Placeholder de saisie</label>
                <input
                  className="input"
                  id="placeholder"
                  onChange={(event) =>
                    patch({ placeholder: event.target.value })
                  }
                  value={form.placeholder}
                />
              </div>
              <div className="field">
                <label htmlFor="avatar">URL de l’avatar (facultatif)</label>
                <input
                  className="input"
                  id="avatar"
                  onChange={(event) => patch({ avatarUrl: event.target.value })}
                  placeholder="https://…"
                  type="url"
                  value={form.avatarUrl}
                />
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="wizard-step">
              <div className="wizard-title">
                <p className="eyebrow">Étape 3</p>
                <h2>Autoriser les boutiques</h2>
                <p>
                  Seuls ces domaines pourront charger la configuration et
                  envoyer des messages. Le jeton Rasa ne quitte jamais le
                  serveur.
                </p>
              </div>
              <div className="security-callout">
                <ShieldCheck />
                <div>
                  <strong>Passerelle sécurisée</strong>
                  <span>
                    Origin allowlist, quotas Redis et session serveur signée,
                    isolée dans une iframe.
                  </span>
                </div>
              </div>
              <div className="field">
                <label htmlFor="allowed-origins">
                  Domaines autorisés · un par ligne
                </label>
                <textarea
                  className="textarea mono origins-input"
                  id="allowed-origins"
                  onChange={(event) =>
                    patch({ allowedOrigins: event.target.value })
                  }
                  placeholder={
                    "https://www.astronomy-store.com\nhttps://astronomy-store.myshopify.com"
                  }
                  value={form.allowedOrigins}
                />
              </div>
              <div className="shopify-note">
                <Store />
                <div>
                  <strong>Shopify</strong>
                  <span>
                    Ajoutez le domaine public et le domaine
                    <span className="mono"> .myshopify.com</span> avant de
                    copier le snippet dans un bloc Custom Liquid.
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="wizard-step">
              <div className="wizard-title">
                <p className="eyebrow">Prêt à installer</p>
                <h2>Ajouter le widget à la boutique</h2>
                <p>
                  Le script charge une iframe sandboxée. Les messages utilisent
                  une session serveur signée et expirante.
                </p>
              </div>
              <div className="success-banner install-success">
                <Check />
                Widget créé et clé publique générée.
              </div>
              <div className="code-block">
                <div className="code-block-head">
                  <span>Snippet universel</span>
                  <button
                    className="button secondary compact"
                    onClick={copySnippet}
                    type="button"
                  >
                    {copiedKey === createdKey ? <Check /> : <Clipboard />}
                    {copiedKey === createdKey ? "Copié" : "Copier"}
                  </button>
                </div>
                <pre>{snippet}</pre>
              </div>
              <ol className="install-steps">
                <li>
                  Dans Shopify, ouvrez <strong>Boutique en ligne → Thèmes</strong>.
                </li>
                <li>
                  Ajoutez un bloc <strong>Custom Liquid</strong> dans le footer
                  ou le layout global.
                </li>
                <li>Collez le snippet, enregistrez puis ouvrez la boutique.</li>
              </ol>
            </div>
          ) : null}

          {error ? <div className="error-banner">{error}</div> : null}

          <div className="wizard-actions">
            <button
              className="button secondary"
              disabled={step === 0 || pending}
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              type="button"
            >
              <ArrowLeft />
              Retour
            </button>
            {step < 3 ? (
              <button
                className="button primary"
                disabled={pending || !assistants.length || !canEditBots}
                onClick={next}
                type="button"
              >
                {pending ? <LoaderCircle className="spin" /> : <ArrowRight />}
                {step === 2 ? "Créer le widget" : "Continuer"}
              </button>
            ) : (
              <Link className="button primary" href="/integrations">
                <Check />
                Terminer
              </Link>
            )}
          </div>
        </div>
      </section>

      <aside className="integration-preview">
        <p className="sidebar-label">Aperçu en direct</p>
        <div className="store-preview">
          <div className="store-preview-nav">
            <span className="store-preview-logo" />
            <span />
            <span />
            <span />
          </div>
          <div className="store-preview-hero">
            <div>
              <small>Nouvelle collection</small>
              <strong>Explorez plus loin.</strong>
              <i />
            </div>
          </div>
          <div className="store-preview-products">
            <span />
            <span />
            <span />
          </div>
          <div
            className={`widget-preview ${form.position}`}
            style={{ "--widget-primary": form.primaryColor } as React.CSSProperties}
          >
            <div className="widget-preview-window">
              <div className="widget-preview-head">
                <span>
                  {form.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" src={form.avatarUrl} />
                  ) : (
                    <MessageCircle />
                  )}
                </span>
                <div>
                  <strong>{form.name}</strong>
                  <small>En ligne</small>
                </div>
              </div>
              <p>{form.welcomeMessage}</p>
              <div className="widget-preview-input">{form.placeholder}</div>
            </div>
            <button type="button">
              <MessageCircle />
              {form.launcherLabel}
            </button>
          </div>
        </div>

        {bots.length ? (
          <div className="existing-bots card">
            <div className="section-title">
              <div>
                <h2>Widgets existants</h2>
                <p>{bots.length} configuration(s)</p>
              </div>
            </div>
            {bots.map((bot) => (
              <div className="existing-bot" key={bot.id}>
                <span style={{ background: bot.primaryColor }} />
                <div>
                  <strong>{bot.name}</strong>
                  <small>{bot.assistant.name}</small>
                </div>
                <div className="existing-bot-actions">
                  <button
                    className="button secondary compact"
                    onClick={() => copyExistingSnippet(bot)}
                    type="button"
                  >
                    {copiedKey === bot.publicKey ? <Check /> : <Clipboard />}
                    {copiedKey === bot.publicKey ? "Copié" : "Snippet"}
                  </button>
                  {canEditBots ? (
                    <>
                      <button
                        className="button secondary compact"
                        onClick={() => editBot(bot)}
                        type="button"
                      >
                        <Pencil />
                        Modifier
                      </button>
                      <button
                        className="button secondary compact"
                        disabled={pending}
                        onClick={() => saveBotState(bot, !bot.enabled)}
                        type="button"
                      >
                        {bot.enabled ? <Pause /> : <Play />}
                        {bot.enabled ? "Pause" : "Activer"}
                      </button>
                    </>
                  ) : (
                    <span className={`pill ${bot.enabled ? "success" : ""}`}>
                      {bot.enabled ? "Actif" : "Pause"}
                    </span>
                  )}
                  {canDeleteBots ? (
                    <button
                      aria-label={`Supprimer ${bot.name}`}
                      className="button danger compact"
                      disabled={pending}
                      onClick={() => deleteBot(bot)}
                      type="button"
                    >
                      <Trash2 />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function installSnippet(appUrl: string, publicKey: string) {
  const baseUrl = appUrl.replace(/\/+$/, "");
  return `<script\n  src="${baseUrl}/widget-loader-v1.js"\n  data-bot-key="${publicKey}"\n  integrity="sha384-qgpggMbGTbw3QV/jjircJdGptUt/NjBRiicREJN5ncFyBjHk8H0XGjun+kLE7HFf"\n  crossorigin="anonymous"\n  referrerpolicy="no-referrer"\n  async\n></script>`;
}
