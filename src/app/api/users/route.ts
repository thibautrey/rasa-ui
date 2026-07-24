import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security";
import { userCreateSchema } from "@/lib/validators";

export async function GET() {
  const user = await getSession();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const users = await db.user.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
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
  return NextResponse.json({ users });
}

export async function POST(request: NextRequest) {
  const user = await getSession();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    assertSameOrigin(request);
    const input = userCreateSchema.parse(await request.json());
    const passwordHash = await bcrypt.hash(input.password, 12);
    const created = await db.user.create({
      data: {
        email: input.email,
        name: input.name,
        role: input.role,
        passwordHash
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
        actorId: user.id,
        action: "user.create",
        entityType: "user",
        entityId: created.id,
        metadata: { email: created.email, role: created.role }
      }
    });
    return NextResponse.json({ user: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid user." },
      { status: 400 }
    );
  }
}
