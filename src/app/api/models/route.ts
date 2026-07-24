import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const artifacts = await db.modelArtifact.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      filename: true,
      sha256: true,
      sizeBytes: true,
      active: true,
      activatedAt: true,
      createdAt: true,
      rasaModelId: true,
      rasaModelFile: true,
      assistant: { select: { id: true, name: true } },
      trainingRun: {
        select: { id: true, sourceHash: true, deploymentError: true }
      }
    }
  });
  return NextResponse.json({
    artifacts: artifacts.map((artifact) => ({
      ...artifact,
      sizeBytes: artifact.sizeBytes.toString()
    }))
  });
}
