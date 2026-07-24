"use client";

import { LoaderCircle, Plus, Save, ShieldCheck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type ManagedUser = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "EDITOR" | "VIEWER";
  isActive: boolean;
  createdAt: string;
};

export function UserManager({
  currentUserId,
  initialUsers
}: {
  currentUserId: string;
  initialUsers: ManagedUser[];
}) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "EDITOR" as ManagedUser["role"]
  });

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    setPending("create");
    setError("");
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    const result = await response.json();
    setPending("");
    if (!response.ok) {
      setError(result.error ?? "Création impossible.");
      return;
    }
    setUsers((current) => [...current, result.user]);
    setForm({ name: "", email: "", password: "", role: "EDITOR" });
    router.refresh();
  }

  async function updateUser(
    id: string,
    values: Partial<Pick<ManagedUser, "role" | "isActive">>
  ) {
    setPending(id);
    setError("");
    const response = await fetch(`/api/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    const result = await response.json();
    setPending("");
    if (!response.ok) {
      setError(result.error ?? "Modification impossible.");
      return;
    }
    setUsers((current) =>
      current.map((user) => (user.id === id ? result.user : user))
    );
    router.refresh();
  }

  async function resetPassword(id: string) {
    const password = window.prompt(
      "Nouveau mot de passe (12 caractères, majuscule, minuscule et chiffre) :"
    );
    if (!password) return;
    setPending(id);
    setError("");
    const response = await fetch(`/api/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    const result = await response.json();
    setPending("");
    if (!response.ok) setError(result.error ?? "Réinitialisation impossible.");
  }

  return (
    <div className="users-layout">
      <section className="card pad">
        <div className="section-title">
          <div>
            <h2>Ajouter un utilisateur</h2>
            <p>L’inscription publique est désactivée.</p>
          </div>
          <span className="metric-icon"><UserRound /></span>
        </div>
        <form className="user-create-form" onSubmit={createUser}>
          <label className="field">
            <span>Nom</span>
            <input
              className="input"
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              required
              value={form.name}
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              className="input"
              onChange={(event) =>
                setForm((current) => ({ ...current, email: event.target.value }))
              }
              required
              type="email"
              value={form.email}
            />
          </label>
          <label className="field">
            <span>Mot de passe initial</span>
            <input
              className="input"
              minLength={12}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  password: event.target.value
                }))
              }
              required
              type="password"
              value={form.password}
            />
          </label>
          <label className="field">
            <span>Rôle</span>
            <select
              className="select"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  role: event.target.value as ManagedUser["role"]
                }))
              }
              value={form.role}
            >
              <option value="EDITOR">Éditeur</option>
              <option value="VIEWER">Lecteur</option>
              <option value="ADMIN">Administrateur</option>
            </select>
          </label>
          <button className="button primary" disabled={pending === "create"}>
            {pending === "create" ? <LoaderCircle className="spin" /> : <Plus />}
            Créer le compte
          </button>
        </form>
      </section>

      <section className="card">
        <div className="section-title section-pad">
          <div>
            <h2>Équipe</h2>
            <p>{users.filter((user) => user.isActive).length} compte(s) actif(s)</p>
          </div>
          <span className="metric-icon"><ShieldCheck /></span>
        </div>
        {error ? <div className="error-banner users-error">{error}</div> : null}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>Rôle</th>
                <th>État</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.name}</strong>
                    <small className="table-subtitle">{user.email}</small>
                  </td>
                  <td>
                    <select
                      className="select compact-select"
                      disabled={pending === user.id}
                      onChange={(event) =>
                        updateUser(user.id, {
                          role: event.target.value as ManagedUser["role"]
                        })
                      }
                      value={user.role}
                    >
                      <option value="ADMIN">Administrateur</option>
                      <option value="EDITOR">Éditeur</option>
                      <option value="VIEWER">Lecteur</option>
                    </select>
                  </td>
                  <td>
                    <span className={`pill ${user.isActive ? "success" : "danger"}`}>
                      {user.isActive ? "Actif" : "Désactivé"}
                    </span>
                  </td>
                  <td>
                    <div className="model-actions">
                      <button
                        className="button secondary compact"
                        disabled={pending === user.id}
                        onClick={() => resetPassword(user.id)}
                        type="button"
                      >
                        <Save />
                        Mot de passe
                      </button>
                      <button
                        className={`button compact ${
                          user.isActive ? "danger" : "secondary"
                        }`}
                        disabled={
                          pending === user.id ||
                          (user.id === currentUserId && user.isActive)
                        }
                        onClick={() =>
                          updateUser(user.id, { isActive: !user.isActive })
                        }
                        type="button"
                      >
                        {pending === user.id ? (
                          <LoaderCircle className="spin" />
                        ) : null}
                        {user.isActive ? "Désactiver" : "Réactiver"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
