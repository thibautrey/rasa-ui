"use client";

import {
  Activity,
  BarChart3,
  Bot,
  Boxes,
  LogOut,
  MessageSquareText,
  Orbit,
  Settings2,
  Store,
  UsersRound
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/auth";

const navigation = [
  { href: "/", label: "Vue d’ensemble", icon: Activity },
  { href: "/assistants", label: "Assistants", icon: Bot },
  { href: "/conversations", label: "Conversations", icon: MessageSquareText },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/integrations", label: "Widgets boutiques", icon: Store }
];

const operations = [
  { href: "/models", label: "Modèles & entraînements", icon: Boxes },
  { href: "/settings", label: "Connexion Rasa", icon: Settings2 }
];

export function Sidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const operationLinks =
    user.role === "ADMIN"
      ? [
          ...operations,
          { href: "/users", label: "Utilisateurs", icon: UsersRound }
        ]
      : operations;

  const active = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Orbit size={20} />
        </div>
        <div className="brand-copy">
          <strong>Pleiades</strong>
          <span>Rasa Control</span>
        </div>
      </div>

      <p className="sidebar-label">Workspace</p>
      <nav className="nav-group">
        {navigation.map((item) => (
          <Link
            className={`nav-link ${active(item.href) ? "active" : ""}`}
            href={item.href}
            key={item.href}
          >
            <item.icon />
            {item.label}
          </Link>
        ))}
      </nav>

      <p className="sidebar-label">Opérations</p>
      <nav className="nav-group">
        {operationLinks.map((item) => (
          <Link
            className={`nav-link ${active(item.href) ? "active" : ""}`}
            href={item.href}
            key={item.href}
          >
            <item.icon />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="user-card">
          <div className="avatar">
            {user.name
              .split(" ")
              .slice(0, 2)
              .map((part) => part[0])
              .join("")
              .toUpperCase()}
          </div>
          <div className="user-copy">
            <strong>{user.name}</strong>
            <span>{user.role.toLowerCase()}</span>
          </div>
          <button
            aria-label="Se déconnecter"
            className="icon-button"
            onClick={logout}
            type="button"
          >
            <LogOut />
          </button>
        </div>
      </div>
    </aside>
  );
}
