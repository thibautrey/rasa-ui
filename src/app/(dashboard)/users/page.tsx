import { redirect } from "next/navigation";
import { UserManager } from "@/components/user-manager";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Utilisateurs" };

export default async function UsersPage() {
  const current = await requireUser();
  if (current.role !== "ADMIN") redirect("/");
  const users = await db.user.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true
    }
  });

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Accès</p>
          <h1 className="page-title">Utilisateurs & rôles</h1>
          <p className="page-subtitle">
            Contrôlez les administrateurs, éditeurs et lecteurs autorisés à
            accéder à la console.
          </p>
        </div>
      </div>
      <UserManager
        currentUserId={current.id}
        initialUsers={users.map((user) => ({
          ...user,
          createdAt: user.createdAt.toISOString()
        }))}
      />
    </>
  );
}
