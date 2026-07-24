import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Context) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const revisions = await db.assistantRevision.findMany({
    where: { assistantId: id },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      note: true,
      documents: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true, email: true } }
    }
  });
  return NextResponse.json({ revisions });
}
