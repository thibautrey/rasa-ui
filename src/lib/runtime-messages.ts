import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  parseMessage,
  publicRasaError,
  sendRestMessage,
  type RasaParseResult,
  type RasaReply
} from "@/lib/rasa";

type RuntimeMessageInput = {
  assistantId: string;
  senderId: string;
  channel: string;
  storeBotId?: string;
  requestId: string;
  text: string;
  metadata: Record<string, unknown>;
};

type RuntimeEnvelope = {
  version: 1;
  state: "PROCESSING" | "COMPLETED" | "FAILED";
  replies?: RasaReply[];
  nlu?: RasaParseResult;
  error?: {
    error: string;
    code: string;
    rasaStatus?: number;
    details?: unknown;
  };
};

export type RuntimeMessageResult = {
  requestId: string;
  conversationId: string;
  replies: RasaReply[];
  nlu: RasaParseResult;
  latencyMs: number;
  cached: boolean;
};

export class RuntimeMessageError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
    this.name = "RuntimeMessageError";
  }
}

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readEnvelope(payload: unknown): RuntimeEnvelope | null {
  const runtime = record(record(payload)?.runtime);
  if (
    !runtime ||
    runtime.version !== 1 ||
    !["PROCESSING", "COMPLETED", "FAILED"].includes(String(runtime.state))
  ) {
    return null;
  }
  return runtime as RuntimeEnvelope;
}

function payload(runtime: RuntimeEnvelope) {
  return json({ runtime });
}

function nluSummary(nlu: RasaParseResult) {
  const intent =
    typeof nlu.intent?.name === "string" ? nlu.intent.name : undefined;
  const rawConfidence = nlu.intent?.confidence;
  const confidence =
    typeof rawConfidence === "number" && Number.isFinite(rawConfidence)
      ? Math.min(1, Math.max(0, rawConfidence))
      : undefined;
  return {
    intent,
    confidence,
    isFallback: intent === "nlu_fallback"
  };
}

async function findRequest(requestId: string) {
  return db.message.findUnique({
    where: { requestId },
    select: {
      id: true,
      conversationId: true,
      direction: true,
      text: true,
      payload: true,
      latencyMs: true,
      conversation: {
        select: {
          assistantId: true,
          senderId: true
        }
      }
    }
  });
}

function assertMatchingRequest(
  existing: NonNullable<Awaited<ReturnType<typeof findRequest>>>,
  input: RuntimeMessageInput
) {
  if (
    existing.direction !== "INBOUND" ||
    existing.conversation.assistantId !== input.assistantId ||
    existing.conversation.senderId !== input.senderId ||
    existing.text !== input.text
  ) {
    throw new RuntimeMessageError(
      "Ce requestId est déjà associé à un autre message.",
      409,
      "REQUEST_ID_CONFLICT"
    );
  }
}

function cachedResult(
  existing: NonNullable<Awaited<ReturnType<typeof findRequest>>>,
  input: RuntimeMessageInput
): RuntimeMessageResult {
  assertMatchingRequest(existing, input);
  const runtime = readEnvelope(existing.payload);
  if (runtime?.state === "PROCESSING") {
    throw new RuntimeMessageError(
      "Ce message est déjà en cours de traitement.",
      409,
      "REQUEST_IN_PROGRESS"
    );
  }
  if (runtime?.state === "FAILED") {
    throw new RuntimeMessageError(
      runtime.error?.error ?? "Le traitement précédent de ce message a échoué.",
      502,
      runtime.error?.code ?? "REQUEST_FAILED"
    );
  }
  const cachedNlu = runtime?.nlu;
  if (
    runtime?.state !== "COMPLETED" ||
    !Array.isArray(runtime.replies) ||
    !cachedNlu ||
    !record(cachedNlu)
  ) {
    throw new RuntimeMessageError(
      "Ce message existe sans résultat réutilisable.",
      409,
      "REQUEST_RESULT_UNAVAILABLE"
    );
  }
  return {
    requestId: input.requestId,
    conversationId: existing.conversationId,
    replies: runtime.replies,
    nlu: cachedNlu,
    latencyMs: existing.latencyMs ?? 0,
    cached: true
  };
}

async function createInbound(input: RuntimeMessageInput) {
  const existing = await findRequest(input.requestId);
  if (existing) return { existing, message: null };

  const conversation = await db.conversation.upsert({
    where: {
      assistantId_senderId: {
        assistantId: input.assistantId,
        senderId: input.senderId
      }
    },
    create: {
      assistantId: input.assistantId,
      storeBotId: input.storeBotId,
      senderId: input.senderId,
      channel: input.channel
    },
    update: {
      lastMessageAt: new Date(),
      ...(input.storeBotId ? { storeBotId: input.storeBotId } : {})
    }
  });

  try {
    const message = await db.message.create({
      data: {
        conversationId: conversation.id,
        direction: "INBOUND",
        text: input.text,
        requestId: input.requestId,
        payload: payload({
          version: 1,
          state: "PROCESSING"
        })
      }
    });
    return { existing: null, message };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const raced = await findRequest(input.requestId);
      if (raced) return { existing: raced, message: null };
    }
    throw error;
  }
}

export async function executeRuntimeMessage(
  input: RuntimeMessageInput
): Promise<RuntimeMessageResult> {
  const startedAt = Date.now();
  const { existing, message } = await createInbound(input);
  if (existing) return cachedResult(existing, input);
  if (!message) {
    throw new RuntimeMessageError(
      "Le message n’a pas pu être créé.",
      500,
      "MESSAGE_CREATE_FAILED"
    );
  }

  try {
    const [replies, nlu] = await Promise.all([
      sendRestMessage(input.senderId, input.text, {
        ...input.metadata,
        requestId: input.requestId
      }),
      parseMessage(input.text)
    ]);
    const latencyMs = Date.now() - startedAt;
    const summary = nluSummary(nlu);

    await db.$transaction([
      db.message.update({
        where: { id: message.id },
        data: {
          intent: summary.intent,
          confidence: summary.confidence,
          latencyMs,
          isFallback: summary.isFallback,
          payload: payload({
            version: 1,
            state: "COMPLETED",
            replies,
            nlu
          })
        }
      }),
      ...(replies.length
        ? [
            db.message.createMany({
              data: replies.map((reply) => ({
                conversationId: message.conversationId,
                direction: "OUTBOUND" as const,
                text: reply.text ?? "Réponse enrichie",
                payload: json(reply)
              }))
            })
          ]
        : []),
      db.conversation.update({
        where: { id: message.conversationId },
        data: { lastMessageAt: new Date() }
      })
    ]);

    return {
      requestId: input.requestId,
      conversationId: message.conversationId,
      replies,
      nlu,
      latencyMs,
      cached: false
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const publicError = publicRasaError(error);
    await db.message.update({
      where: { id: message.id },
      data: {
        latencyMs,
        payload: payload({
          version: 1,
          state: "FAILED",
          error: publicError
        })
      }
    });
    throw error;
  }
}
