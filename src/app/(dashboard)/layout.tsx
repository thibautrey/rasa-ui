import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  return (
    <div className="app-shell">
      <Sidebar user={user} />
      <main className="app-main">
        <Topbar />
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
