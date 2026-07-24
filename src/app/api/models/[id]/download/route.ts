import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Context) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const artifact = await db.modelArtifact.findUnique({
    where: { id },
    select: { filename: true, sha256: true, archive: true }
  });
  if (!artifact) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(artifact.archive), {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${artifact.filename}"`,
      "Content-Length": String(artifact.archive.length),
      ETag: `"${artifact.sha256}"`,
      "Cache-Control": "private, no-store"
    }
  });
}
