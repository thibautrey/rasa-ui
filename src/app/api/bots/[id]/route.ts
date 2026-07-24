import { NextRequest, NextResponse } from "next/server";
import { canEdit, getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin, normalizeOrigins } from "@/lib/security";
import { storeBotSchema } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: Context) {
  const user = await getSession();
  if (!user || !canEdit(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const input = storeBotSchema.parse(await request.json());
    const bot = await db.$transaction(async (tx) => {
      const updated = await tx.storeBot.update({
        where: { id },
        data: {
          ...input,
          avatarUrl: input.avatarUrl || null,
          allowedOrigins: normalizeOrigins(input.allowedOrigins)
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "store_bot.update",
          entityType: "store_bot",
          entityId: id,
          metadata: { enabled: updated.enabled, assistantId: updated.assistantId }
        }
      });
      return updated;
    });
    return NextResponse.json({ bot });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const user = await getSession();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    await db.$transaction(async (tx) => {
      const bot = await tx.storeBot.delete({
        where: { id },
        select: { name: true, publicKey: true }
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "store_bot.delete",
          entityType: "store_bot",
          entityId: id,
          metadata: { name: bot.name, publicKey: bot.publicKey }
        }
      });
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to delete." }, { status: 400 });
  }
}
