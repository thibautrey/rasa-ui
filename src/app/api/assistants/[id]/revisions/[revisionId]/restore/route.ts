import { NextRequest, NextResponse } from "next/server";
import { canEdit, getSession } from "@/lib/auth";
import { validateAssistantDocuments } from "@/lib/assistant-documents";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security";

type Context = {
  params: Promise<{ id: string; revisionId: string }>;
};

type Documents = {
  llmEnabled: boolean;
  llmSystemPrompt: string;
  configYaml: string;
  domainYaml: string;
  nluYaml: string;
  storiesYaml: string;
  rulesYaml: string;
  endpointsYaml: string;
  credentialsYaml: string;
};

type GenerationSettings = Pick<Documents, "llmEnabled" | "llmSystemPrompt">;

function documentsFrom(
  value: unknown,
  current: GenerationSettings
): Documents {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid revision snapshot.");
  }
  const source = value as Record<string, unknown>;
  const fields = [
    "configYaml",
    "domainYaml",
    "nluYaml",
    "storiesYaml",
    "rulesYaml",
    "endpointsYaml",
    "credentialsYaml"
  ] as const;
  const yaml = Object.fromEntries(
    fields.map((field) => {
      const entry = source[field];
      if (typeof entry !== "string") {
        throw new Error(`Revision is missing ${field}.`);
      }
      return [field, entry];
    })
  ) as Omit<Documents, keyof GenerationSettings>;
  return {
    ...yaml,
    llmEnabled:
      typeof source.llmEnabled === "boolean"
        ? source.llmEnabled
        : current.llmEnabled,
    llmSystemPrompt:
      typeof source.llmSystemPrompt === "string"
        ? source.llmSystemPrompt
        : current.llmSystemPrompt
  };
}

export async function POST(request: NextRequest, context: Context) {
  const user = await getSession();
  if (!user || !canEdit(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    assertSameOrigin(request);
    const { id, revisionId } = await context.params;
    const [revision, current] = await Promise.all([
      db.assistantRevision.findFirstOrThrow({
        where: { id: revisionId, assistantId: id }
      }),
      db.assistant.findUniqueOrThrow({
        where: { id },
        select: { llmEnabled: true, llmSystemPrompt: true }
      })
    ]);
    const documents = documentsFrom(revision.documents, current);
    validateAssistantDocuments(documents);

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
        data: documents
      });
      const restored = await tx.assistantRevision.create({
        data: {
          assistantId: id,
          version: (latest._max.version ?? 0) + 1,
          documents,
          note: `Restauration de la version ${revision.version}`,
          createdById: user.id
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "assistant.revision.restore",
          entityType: "assistant",
          entityId: id,
          metadata: {
            sourceRevisionId: revision.id,
            sourceVersion: revision.version,
            revisionId: restored.id,
            version: restored.version
          }
        }
      });
      return updated;
    });
    return NextResponse.json({ assistant });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Restore failed." },
      { status: 400 }
    );
  }
}
