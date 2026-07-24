import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security";
import { userUpdateSchema } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: Context) {
  const actor = await getSession();
  if (!actor || actor.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const input = userUpdateSchema.parse(await request.json());
    const current = await db.user.findUniqueOrThrow({ where: { id } });

    const removesAdmin =
      current.role === "ADMIN" &&
      (input.role && input.role !== "ADMIN" || input.isActive === false);
    if (removesAdmin) {
      const activeAdmins = await db.user.count({
        where: { role: "ADMIN", isActive: true }
      });
      if (activeAdmins <= 1) {
        return NextResponse.json(
          { error: "Le dernier administrateur actif doit être conservé." },
          { status: 409 }
        );
      }
    }
    if (id === actor.id && input.isActive === false) {
      return NextResponse.json(
        { error: "Vous ne pouvez pas désactiver votre propre compte." },
        { status: 409 }
      );
    }

    const { password, ...values } = input;
    const updated = await db.user.update({
      where: { id },
      data: {
        ...values,
        ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {})
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true
      }
    });
    await db.auditLog.create({
      data: {
        actorId: actor.id,
        action: password ? "user.password_reset" : "user.update",
        entityType: "user",
        entityId: id,
        metadata: {
          role: updated.role,
          isActive: updated.isActive,
          passwordChanged: Boolean(password)
        }
      }
    });
    return NextResponse.json({ user: updated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid user." },
      { status: 400 }
    );
  }
}
