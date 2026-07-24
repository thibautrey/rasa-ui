import { NextRequest, NextResponse } from "next/server";
import { canEdit, getSession } from "@/lib/auth";
import { validateAssistantDocuments } from "@/lib/assistant-documents";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security";
import { assistantUpdateSchema } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Context) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const assistant = await db.assistant.findUnique({
    where: { id },
    include: {
      trainingRuns: { orderBy: { createdAt: "desc" }, take: 20 },
      storeBots: { orderBy: { createdAt: "desc" } },
      revisions: {
        orderBy: { version: "desc" },
        take: 20,
        select: {
          id: true,
          version: true,
          note: true,
          createdAt: true,
          createdBy: { select: { name: true } }
        }
      }
    }
  });
  if (!assistant) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ assistant });
}

export async function PUT(request: NextRequest, context: Context) {
  const user = await getSession();
  if (!user || !canEdit(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const input = assistantUpdateSchema.parse(await request.json());
    validateAssistantDocuments(input);
    const { changeNote, ...values } = input;
    const documents = {
      llmEnabled: values.llmEnabled,
      llmSystemPrompt: values.llmSystemPrompt,
      configYaml: values.configYaml,
      domainYaml: values.domainYaml,
      nluYaml: values.nluYaml,
      storiesYaml: values.storiesYaml,
      rulesYaml: values.rulesYaml,
      endpointsYaml: values.endpointsYaml,
      credentialsYaml: values.credentialsYaml
    };

    const assistant = await db.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT TRUE AS "locked"
        FROM pg_advisory_xact_lock(hashtext(${id}))
      `;
      const latest = await tx.assistantRevision.aggregate({
        where: { assistantId: id },
        _max: { version: true }
      });
      const updated = await tx.assistant.update({
        where: { id },
        data: values
      });
      const revision = await tx.assistantRevision.create({
        data: {
          assistantId: id,
          version: (latest._max.version ?? 0) + 1,
          documents,
          note: changeNote || "Sauvegarde manuelle",
          createdById: user.id
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "assistant.update",
          entityType: "assistant",
          entityId: id,
          metadata: { revisionId: revision.id, version: revision.version }
        }
      });
      return updated;
    });
    return NextResponse.json({ assistant });
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
    await db.assistant.delete({ where: { id } });
    await db.auditLog.create({
      data: {
        actorId: user.id,
        action: "assistant.delete",
        entityType: "assistant",
        entityId: id
      }
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to delete." }, { status: 400 });
  }
}
