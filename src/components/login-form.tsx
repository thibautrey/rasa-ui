"use client";

import { ArrowRight, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Connexion impossible.");
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Connexion impossible."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="email">Adresse e-mail</label>
        <div className="login-input-wrap">
          <Mail />
          <input
            autoComplete="email"
            className="input"
            id="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="admin@pleiades.solutions"
            required
            type="email"
            value={email}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="password">Mot de passe</label>
        <div className="login-input-wrap">
          <LockKeyhole />
          <input
            autoComplete="current-password"
            className="input"
            id="password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••••••"
            required
            type="password"
            value={password}
          />
        </div>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      <button className="button primary login-submit" disabled={pending}>
        {pending ? <LoaderCircle className="spin" /> : <ArrowRight />}
        {pending ? "Connexion…" : "Accéder au workspace"}
      </button>
    </form>
  );
}
