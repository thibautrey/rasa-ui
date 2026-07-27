import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  generateLiteLlmReply,
  liteLlmErrorCode,
  liteLlmModel,
  type GenerationMetadata
} from "@/lib/litellm";
import {
  parseMessage,
  RasaApiError,
  sendRestMessage,
  type RasaParseResult,
  type RasaReply
} from "@/lib/rasa";
import {
  coarsenRuntimeCoordinates,
  containsSensitiveRuntimeText,
  runtimePseudonym,
  safeRuntimeText
} from "@/lib/runtime-privacy";
import { runtimePolicyDecision } from "@/lib/runtime-policy";
import {
  executeStorefrontCapability,
  resolveStorefrontCapabilityRequest,
  storefrontCapabilitiesEnabled,
  storefrontCapabilityReply,
  StorefrontCapabilityError
} from "@/lib/storefront-capabilities";
import {
  acquireRuntimeExternalLease,
  RuntimeExternalLimitError,
  type RuntimeExternalLease
} from "@/lib/runtime-external-limit";

type RuntimeMessageInput = {
  assistantId: string;
  senderId: string;
  channel: "storefront" | "studio";
  storeBotId?: string;
  requestId: string;
  text: string;
  metadata: Record<string, unknown>;
};

type PreparedRuntimeMessageInput = Omit<
  RuntimeMessageInput,
  "metadata"
> & {
  privacyBlocked: boolean;
  publicRequestId: string;
};

type RuntimeEnvelope = {
  version: 1;
  state: "PROCESSING" | "COMPLETED" | "FAILED";
  replies?: RasaReply[];
  nlu?: RasaParseResult;
  generation?: GenerationMetadata;
  error?: {
    error: string;
    code: string;
    rasaStatus?: number;
  };
};

export type RuntimeMessageResult = {
  requestId: string;
  conversationId: string;
  replies: RasaReply[];
  nlu: RasaParseResult;
  latencyMs: number;
  cached: boolean;
  generation?: GenerationMetadata;
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

const PRIVACY_BLOCKED_REPLY =
  "Pour protéger vos données, ce message n’a été transmis ni à Rasa ni à un modèle d’IA. Utilisez l’espace client sécurisé pour toute demande contenant des coordonnées personnelles ou une référence de commande.";
const UNSAFE_RESPONSE_REPLACEMENT =
  "Je ne peux pas afficher cette réponse ici car elle pourrait contenir une donnée sensible.";
const STOREFRONT_RASA_TIMEOUT_MS = 8_000;
const STOREFRONT_RASA_MAX_RESPONSE_BYTES = 64 * 1024;
const STOREFRONT_LITELLM_TIMEOUT_MS = 8_000;
const STOREFRONT_LITELLM_MAX_RESPONSE_BYTES = 64 * 1024;

function prepareRuntimeInput(
  input: RuntimeMessageInput
): PreparedRuntimeMessageInput {
  const publicText = coarsenRuntimeCoordinates(input.text);
  const privacyBlocked = containsSensitiveRuntimeText(publicText);
  const messageFingerprint = runtimePseudonym(
    "message",
    `${input.assistantId}\0${input.text}`
  ).slice(-16);

  return {
    assistantId: input.assistantId,
    senderId: runtimePseudonym(
      "sender",
      `${input.assistantId}\0${input.senderId}`
    ),
    channel: input.channel,
    storeBotId: input.storeBotId,
    requestId: runtimePseudonym(
      "request",
      `${input.assistantId}\0${input.requestId}`
    ),
    text: privacyBlocked
      ? `[MESSAGE_SENSIBLE_MASQUE:${messageFingerprint}]`
      : publicText,
    privacyBlocked,
    publicRequestId: input.requestId
  };
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
  const candidateIntent =
    typeof nlu.intent?.name === "string" ? nlu.intent.name : "";
  const intent = /^[A-Za-z0-9_.:-]{1,120}$/.test(candidateIntent)
    ? candidateIntent
    : undefined;
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

function publicNlu(nlu: RasaParseResult): RasaParseResult {
  const summary = nluSummary(nlu);
  return {
    ...(summary.intent
      ? {
          intent: {
            name: summary.intent,
            ...(summary.confidence !== undefined
              ? { confidence: summary.confidence }
              : {})
          }
        }
      : {}),
    entities: []
  };
}

function safeReplyText(value: unknown) {
  if (typeof value !== "string") return "";
  const text = value.trim().slice(0, 8_000);
  return text
    ? safeRuntimeText(text, UNSAFE_RESPONSE_REPLACEMENT)
    : "";
}

function safeRasaReplies(replies: RasaReply[]): RasaReply[] {
  const safeReplies = replies.slice(0, 12).flatMap((reply) => {
    const text = safeReplyText(reply.text);
    const buttons = Array.isArray(reply.buttons)
      ? reply.buttons.slice(0, 8).flatMap((button) => {
          const title = safeReplyText(button?.title).slice(0, 120);
          const buttonPayload =
            typeof button?.payload === "string"
              ? button.payload.trim()
              : "";
          const payload = /^\/[A-Za-z][A-Za-z0-9_]{0,119}$/.test(
            buttonPayload
          )
            ? buttonPayload
            : "";
          return title && payload ? [{ title, payload }] : [];
        })
      : [];
    return text || buttons.length ? [{ text, buttons }] : [];
  });

  return safeReplies.length
    ? safeReplies
    : [{ text: "Je n’ai pas de réponse sûre à afficher pour cette demande." }];
}

function safeRuntimeFailure(error: unknown) {
  if (error instanceof RuntimeMessageError) return error;
  if (error instanceof RuntimeExternalLimitError) {
    const rateLimited =
      error.code === "RUNTIME_EXTERNAL_RATE_LIMIT" ||
      error.code === "RUNTIME_EXTERNAL_CONCURRENCY_LIMIT";
    return new RuntimeMessageError(
      rateLimited
        ? "Le service reçoit trop de demandes. Réessayez dans un instant."
        : "Le service est temporairement indisponible.",
      rateLimited ? 429 : 503,
      error.code
    );
  }
  if (error instanceof StorefrontCapabilityError) {
    const status =
      error.status === 400 || error.status === 403
        ? error.status
        : error.status === 504
          ? 504
          : 503;
    return new RuntimeMessageError(
      "Le service d’information public est temporairement indisponible.",
      status,
      error.code
    );
  }
  if (error instanceof RasaApiError) {
    const status =
      error.code === "RASA_TIMEOUT"
        ? 504
        : error.code === "RASA_UNREACHABLE"
          ? 503
          : 502;
    return new RuntimeMessageError(
      "Le moteur conversationnel est temporairement indisponible.",
      status,
      error.code
    );
  }
  return new RuntimeMessageError(
    "Le message n’a pas pu être traité.",
    500,
    "RUNTIME_MESSAGE_FAILED"
  );
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
  input: PreparedRuntimeMessageInput
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
  input: PreparedRuntimeMessageInput
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
    const code = runtime.error?.code ?? "REQUEST_FAILED";
    const status =
      code === "RUNTIME_EXTERNAL_RATE_LIMIT" ||
      code === "RUNTIME_EXTERNAL_CONCURRENCY_LIMIT"
        ? 429
        : code.includes("TIMEOUT")
          ? 504
          : code.includes("UNAVAILABLE") ||
              code.includes("NOT_CONFIGURED")
            ? 503
            : 502;
    throw new RuntimeMessageError(
      runtime.error?.error ?? "Le traitement précédent de ce message a échoué.",
      status,
      code
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
    requestId: input.publicRequestId,
    conversationId: existing.conversationId,
    replies: runtime.replies,
    nlu: cachedNlu,
    latencyMs: existing.latencyMs ?? 0,
    cached: true,
    generation: runtime.generation
  };
}

async function createInbound(input: PreparedRuntimeMessageInput) {
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

async function generationContext(
  assistantId: string,
  conversationId: string,
  messageId: string
) {
  const [assistant, history] = await Promise.all([
    db.assistant.findUniqueOrThrow({
      where: { id: assistantId },
      select: {
        name: true,
        description: true,
        language: true,
        llmEnabled: true,
        llmSystemPrompt: true
      }
    }),
    db.message.findMany({
      where: {
        conversationId,
        id: { not: messageId }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 12,
      select: {
        direction: true,
        text: true
      }
    })
  ]);

  return {
    assistant,
    history: history.reverse()
  };
}

function withGeneratedText(replies: RasaReply[], text: string): RasaReply[] {
  const textReplyIndex = replies.findIndex(
    (reply) => typeof reply.text === "string"
  );
  if (textReplyIndex === -1) return [{ text }, ...replies];
  return replies.map((reply, index) =>
    index === textReplyIndex ? { ...reply, text } : reply
  );
}

async function completeMessage(input: {
  message: { id: string; conversationId: string };
  replies: RasaReply[];
  nlu: RasaParseResult;
  generation: GenerationMetadata;
  latencyMs: number;
}) {
  const summary = nluSummary(input.nlu);
  await db.$transaction([
    db.message.update({
      where: { id: input.message.id },
      data: {
        intent: summary.intent,
        confidence: summary.confidence,
        latencyMs: input.latencyMs,
        isFallback: summary.isFallback,
        payload: payload({
          version: 1,
          state: "COMPLETED",
          replies: input.replies,
          nlu: input.nlu,
          generation: input.generation
        })
      }
    }),
    ...(input.replies.length
      ? [
          db.message.createMany({
            data: input.replies.map((reply) => ({
              conversationId: input.message.conversationId,
              direction: "OUTBOUND" as const,
              text: reply.text ?? "Réponse sécurisée",
              payload: json({ ...reply, generation: input.generation })
            }))
          })
        ]
      : []),
    db.conversation.update({
      where: { id: input.message.conversationId },
      data: { lastMessageAt: new Date() }
    })
  ]);
}

export async function executeRuntimeMessage(
  unsafeInput: RuntimeMessageInput
): Promise<RuntimeMessageResult> {
  const startedAt = Date.now();
  const input = prepareRuntimeInput(unsafeInput);
  let inbound: Awaited<ReturnType<typeof createInbound>>;
  try {
    inbound = await createInbound(input);
  } catch {
    throw new RuntimeMessageError(
      "Le message n’a pas pu être enregistré.",
      500,
      "RUNTIME_STORAGE_FAILED"
    );
  }
  const { existing, message } = inbound;
  if (existing) return cachedResult(existing, input);
  if (!message) {
    throw new RuntimeMessageError(
      "Le message n’a pas pu être créé.",
      500,
      "MESSAGE_CREATE_FAILED"
    );
  }

  let externalLease: RuntimeExternalLease | null = null;
  let storefrontBotId: string | null = null;
  try {
    const disabledGeneration: GenerationMetadata = {
      provider: "litellm",
      model: liteLlmModel(),
      status: "DISABLED"
    };

    if (input.privacyBlocked) {
      const replies: RasaReply[] = [{ text: PRIVACY_BLOCKED_REPLY }];
      const nlu: RasaParseResult = {
        intent: { name: "privacy_sensitive_input", confidence: 1 },
        entities: []
      };
      const latencyMs = Date.now() - startedAt;
      await completeMessage({
        message,
        replies,
        nlu,
        generation: disabledGeneration,
        latencyMs
      });
      return {
        requestId: input.publicRequestId,
        conversationId: message.conversationId,
        replies,
        nlu,
        latencyMs,
        cached: false,
        generation: disabledGeneration
      };
    }

    if (
      input.channel === "storefront" ||
      (input.storeBotId && storefrontCapabilitiesEnabled())
    ) {
      if (!input.storeBotId) {
        throw new RuntimeMessageError(
          "Le bot storefront n’est pas configuré.",
          503,
          "RUNTIME_STOREFRONT_BOT_NOT_CONFIGURED"
        );
      }
      storefrontBotId = input.storeBotId;
      externalLease = await acquireRuntimeExternalLease(storefrontBotId);
    }
    const rasaOptions =
      input.channel === "storefront"
        ? {
            timeoutMs: STOREFRONT_RASA_TIMEOUT_MS,
            maxResponseBytes: STOREFRONT_RASA_MAX_RESPONSE_BYTES
          }
        : undefined;
    const [rawRasaReplies, rawNlu, context] = await Promise.all([
      sendRestMessage(input.senderId, input.text, {
        source:
          input.channel === "storefront"
            ? "storefront-runtime"
            : "studio-runtime",
        requestId: input.requestId
      }, rasaOptions),
      parseMessage(input.text, rasaOptions),
      generationContext(input.assistantId, message.conversationId, message.id)
    ]);
    let nlu = publicNlu(rawNlu);
    let replies = safeRasaReplies(rawRasaReplies);
    let generation = disabledGeneration;
    const policyDecision = runtimePolicyDecision(input.text);
    const capabilityRequest =
      !policyDecision &&
      input.storeBotId &&
      storefrontCapabilitiesEnabled()
        ? resolveStorefrontCapabilityRequest(rawNlu, rawRasaReplies)
        : null;

    if (policyDecision) {
      replies = [{ text: policyDecision.reply }];
      nlu = {
        intent: {
          name: policyDecision.intent,
          confidence: 1
        },
        entities: []
      };
    } else {
      if (capabilityRequest) {
        if (!storefrontBotId) {
          throw new RuntimeMessageError(
            "Le bot storefront n’est pas configuré.",
            503,
            "RUNTIME_STOREFRONT_BOT_NOT_CONFIGURED"
          );
        }
        const result = await executeStorefrontCapability(
          storefrontBotId,
          capabilityRequest
        );
        replies = safeRasaReplies([
          storefrontCapabilityReply(result)
        ]);
      }

      if (context.assistant.llmEnabled) {
        try {
          const result = await generateLiteLlmReply({
            assistant: {
              name: context.assistant.name,
              description: context.assistant.description,
              language: context.assistant.language,
              systemPrompt: context.assistant.llmSystemPrompt
            },
            message: input.text,
            history: context.history.map((historyMessage) => ({
              ...historyMessage,
              text: safeRuntimeText(historyMessage.text)
            })),
            nlu,
            rasaReplies: replies,
            ...(input.channel === "storefront"
              ? {
                  timeoutMs: STOREFRONT_LITELLM_TIMEOUT_MS,
                  maxResponseBytes:
                    STOREFRONT_LITELLM_MAX_RESPONSE_BYTES
                }
              : {})
          });
          replies = withGeneratedText(
            replies,
            safeRuntimeText(result.text, UNSAFE_RESPONSE_REPLACEMENT)
          );
          generation = result.metadata;
        } catch (error) {
          generation = {
            provider: "litellm",
            model: liteLlmModel(),
            status: "RASA_FALLBACK",
            errorCode: liteLlmErrorCode(error)
          };
          console.warn("LiteLLM generation fell back to Rasa.", {
            requestId: input.requestId,
            errorCode: generation.errorCode
          });
        }
      }
    }

    const latencyMs = Date.now() - startedAt;
    await completeMessage({
      message,
      replies,
      nlu,
      generation,
      latencyMs
    });

    return {
      requestId: input.publicRequestId,
      conversationId: message.conversationId,
      replies,
      nlu,
      latencyMs,
      cached: false,
      generation
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const failure = safeRuntimeFailure(error);
    try {
      await db.message.update({
        where: { id: message.id },
        data: {
          latencyMs,
          payload: payload({
            version: 1,
            state: "FAILED",
            error: {
              error: failure.message,
              code: failure.code
            }
          })
        }
      });
    } catch {
      throw new RuntimeMessageError(
        "Le résultat n’a pas pu être enregistré.",
        500,
        "RUNTIME_STORAGE_FAILED"
      );
    }
    throw failure;
  } finally {
    await externalLease?.release();
  }
}
