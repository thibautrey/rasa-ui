import { Store } from "lucide-react";
import Link from "next/link";
import { BotWizard } from "@/components/bot-wizard";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Widgets boutiques" };

export default async function IntegrationsPage() {
  const user = await requireUser();
  const [assistants, bots] = await Promise.all([
    db.assistant.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true }
    }),
    db.storeBot.findMany({
      orderBy: { updatedAt: "desc" },
      include: { assistant: { select: { name: true } } }
    })
  ]);

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://rasa-studio.pleiades.solutions";

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Storefront</p>
          <h1 className="page-title">Wizard boutique</h1>
          <p className="page-subtitle">
            Configurez un conseiller Rasa, sécurisez ses domaines autorisés et
            obtenez le snippet à intégrer dans Shopify ou tout autre storefront.
          </p>
        </div>
      </div>

      {assistants.length ? (
        <BotWizard
          appUrl={appUrl}
          assistants={assistants}
          canDeleteBots={user.role === "ADMIN"}
          canEditBots={user.role === "ADMIN" || user.role === "EDITOR"}
          existingBots={bots.map((bot) => ({
            ...bot,
            createdAt: bot.createdAt.toISOString(),
            updatedAt: bot.updatedAt.toISOString()
          }))}
        />
      ) : (
        <div className="card empty-state">
          <div>
            <span className="empty-state-icon">
              <Store />
            </span>
            <h3>Créez d’abord un assistant</h3>
            <p>
              Le wizard associe chaque widget boutique à un projet Rasa.
            </p>
            <Link className="button primary" href="/assistants">
              Créer un assistant
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
