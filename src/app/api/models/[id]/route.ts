import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  const user = await getSession();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const artifact = await db.modelArtifact.findUniqueOrThrow({
      where: { id },
      select: { active: true, filename: true }
    });
    if (artifact.active) {
      return NextResponse.json(
        { error: "Le modèle actif ne peut pas être supprimé." },
        { status: 409 }
      );
    }
    await db.modelArtifact.delete({ where: { id } });
    await db.auditLog.create({
      data: {
        actorId: user.id,
        action: "model.delete",
        entityType: "model_artifact",
        entityId: id,
        metadata: { filename: artifact.filename }
      }
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to delete." },
      { status: 400 }
    );
  }
}
