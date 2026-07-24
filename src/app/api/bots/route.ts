import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { canEdit, getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin, normalizeOrigins } from "@/lib/security";
import { storeBotSchema } from "@/lib/validators";

export async function GET() {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const bots = await db.storeBot.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      assistant: { select: { id: true, name: true } },
      _count: { select: { conversations: true } }
    }
  });
  return NextResponse.json({ bots });
}

export async function POST(request: NextRequest) {
  const user = await getSession();
  if (!user || !canEdit(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    assertSameOrigin(request);
    const input = storeBotSchema.parse(await request.json());
    const bot = await db.storeBot.create({
      data: {
        ...input,
        avatarUrl: input.avatarUrl || null,
        allowedOrigins: normalizeOrigins(input.allowedOrigins),
        publicKey: `bot_${randomBytes(18).toString("base64url")}`
      }
    });
    await db.auditLog.create({
      data: {
        actorId: user.id,
        action: "store_bot.create",
        entityType: "store_bot",
        entityId: bot.id,
        metadata: { name: bot.name }
      }
    });
    return NextResponse.json({ bot }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request." },
      { status: 400 }
    );
  }
}
