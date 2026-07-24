import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { canEdit, getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  DEFAULT_CONFIG_YAML,
  DEFAULT_CREDENTIALS_YAML,
  DEFAULT_DOMAIN_YAML,
  DEFAULT_ENDPOINTS_YAML,
  DEFAULT_NLU_YAML,
  DEFAULT_RULES_YAML,
  DEFAULT_STORIES_YAML
} from "@/lib/defaults";
import { assertSameOrigin } from "@/lib/security";
import { assistantCreateSchema } from "@/lib/validators";

export async function GET() {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const assistants = await db.assistant.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { storeBots: true, conversations: true } },
      trainingRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, createdAt: true, modelName: true }
      }
    }
  });
  return NextResponse.json({ assistants });
}

export async function POST(request: NextRequest) {
  const user = await getSession();
  if (!user || !canEdit(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    assertSameOrigin(request);
    const input = assistantCreateSchema.parse(await request.json());
    const baseSlug = input.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 50);
    const slug = `${baseSlug || "assistant"}-${randomUUID().slice(0, 6)}`;

    const configYaml = DEFAULT_CONFIG_YAML.replace(
      "assistant_id: change-me",
      `assistant_id: ${slug}`
    ).replace("language: fr", `language: ${input.language}`);
    const documents = {
      configYaml,
      domainYaml: DEFAULT_DOMAIN_YAML,
      nluYaml: DEFAULT_NLU_YAML,
      storiesYaml: DEFAULT_STORIES_YAML,
      rulesYaml: DEFAULT_RULES_YAML,
      endpointsYaml: DEFAULT_ENDPOINTS_YAML,
      credentialsYaml: DEFAULT_CREDENTIALS_YAML
    };
    const assistant = await db.assistant.create({
      data: {
        ...input,
        slug,
        createdById: user.id,
        ...documents,
        revisions: {
          create: {
            version: 1,
            documents,
            note: "Création de l’assistant",
            createdById: user.id
          }
        }
      }
    });

    await db.auditLog.create({
      data: {
        actorId: user.id,
        action: "assistant.create",
        entityType: "assistant",
        entityId: assistant.id,
        metadata: { name: assistant.name }
      }
    });

    return NextResponse.json({ assistant }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request." },
      { status: 400 }
    );
  }
}
