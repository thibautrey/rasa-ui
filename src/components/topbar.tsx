import { Bell, Command } from "lucide-react";

export function Topbar() {
  return (
    <header className="topbar">
      <div className="breadcrumb">
        Pleiades Solutions&nbsp;&nbsp;/&nbsp;&nbsp;
        <strong>Rasa UI</strong>
      </div>
      <div className="topbar-actions">
        <div className="status-chip">
          <span className="status-dot online" />
          Control plane actif
        </div>
        <button aria-label="Commandes" className="icon-button" type="button">
          <Command />
        </button>
        <button aria-label="Notifications" className="icon-button" type="button">
          <Bell />
        </button>
      </div>
    </header>
  );
}
