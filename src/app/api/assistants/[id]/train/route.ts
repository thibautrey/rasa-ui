import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildTrainingYaml } from "@/lib/assistant-documents";
import { canEdit, getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security";
import { kickTrainingWorker } from "@/lib/training-worker";

type Context = { params: Promise<{ id: string }> };

const requestSchema = z.object({
  activate: z.boolean().default(true)
});

export async function POST(request: NextRequest, context: Context) {
  const user = await getSession();
  if (!user || !canEdit(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const input = requestSchema.parse(body);
    const assistant = await db.assistant.findUniqueOrThrow({ where: { id } });
    const sourceSnapshot = {
      configYaml: assistant.configYaml,
      domainYaml: assistant.domainYaml,
      nluYaml: assistant.nluYaml,
      storiesYaml: assistant.storiesYaml,
      rulesYaml: assistant.rulesYaml,
      endpointsYaml: assistant.endpointsYaml,
      credentialsYaml: assistant.credentialsYaml
    };
    const trainingYaml = buildTrainingYaml(sourceSnapshot);
    const sourceHash = createHash("sha256")
      .update(trainingYaml)
      .digest("hex");

    const run = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const running = await tx.trainingRun.findFirst({
        where: {
          assistantId: id,
          status: { in: ["QUEUED", "RUNNING"] }
        }
      });
      if (running) return running;

      const created = await tx.trainingRun.create({
        data: {
          assistantId: id,
          status: "QUEUED",
          sourceSnapshot,
          sourceHash,
          deployAfterTraining: input.activate,
          log: "En attente d’un worker d’entraînement…\n"
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "training.start",
          entityType: "assistant",
          entityId: id,
          metadata: {
            runId: created.id,
            sourceHash,
            activate: input.activate
          }
        }
      });
      return created;
    });

    if (run.status !== "QUEUED") {
      return NextResponse.json(
        { error: "Un entraînement est déjà en cours.", run },
        { status: 409 }
      );
    }
    kickTrainingWorker();
    return NextResponse.json({ run }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to train." },
      { status: 400 }
    );
  }
}
