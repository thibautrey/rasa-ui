import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireDeployedAssistant } from "@/lib/models";
import {
  executeRuntimeMessage,
  RuntimeMessageError
} from "@/lib/runtime-messages";
import {
  clientIp,
  configuredOrigins,
  isAllowedOrigin,
  isValidWidgetPublicKey,
  RateLimitUnavailableError,
  readBoundedJson,
  RequestBodyTooLargeError,
  storefrontWidgetEnabled,
  takeRateLimit
} from "@/lib/security";
import {
  verifyWidgetSession,
  WidgetSessionUnavailableError
} from "@/lib/widget-session";
import type { RasaReply } from "@/lib/rasa";

const schema = z
  .object({
    sessionToken: z.string().min(64).max(4_096),
    message: z.string().trim().min(1).max(4_000),
    requestId: z.string().trim().min(16).max(128)
  })
  .strict();

type Context = { params: Promise<{ publicKey: string }> };
const NO_STORE = { "Cache-Control": "no-store" };

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "null",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    Vary: "Origin"
  };
}

function isApplicationOrigin(request: NextRequest, origin: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const candidates = configured
    ? [configured]
    : process.env.NODE_ENV === "production"
      ? []
      : [request.nextUrl.origin];
  return candidates.some((candidate) => {
    if (!candidate) return false;
    try {
      return new URL(candidate).origin === origin;
    } catch {
      return false;
    }
  });
}

function publicReplies(replies: RasaReply[]) {
  return replies.slice(0, 12).flatMap((reply) => {
    const text =
      typeof reply.text === "string" ? reply.text.trim().slice(0, 8_000) : "";
    const buttons = Array.isArray(reply.buttons)
      ? reply.buttons
          .slice(0, 8)
          .flatMap((button) => {
            if (
              typeof button?.title !== "string" ||
              typeof button?.payload !== "string"
            ) {
              return [];
            }
            const title = button.title.trim().slice(0, 120);
            const payload = button.payload.trim().slice(0, 500);
            return title && payload ? [{ title, payload }] : [];
          })
      : [];
    return text || buttons.length ? [{ text, buttons }] : [];
  });
}

export async function OPTIONS(request: NextRequest, context: Context) {
  try {
    if (!storefrontWidgetEnabled()) {
      return new NextResponse(null, {
        status: 404,
        headers: NO_STORE
      });
    }
    const origin = request.headers.get("origin");
    const { publicKey } = await context.params;
    if (!isValidWidgetPublicKey(publicKey)) {
      return new NextResponse(null, {
        status: 404,
        headers: NO_STORE
      });
    }
    const routeRateLimit = await takeRateLimit(
      "widget-route:chat-options",
      1_200,
      60_000
    );
    const ipRateLimit = await takeRateLimit(
      `widget-chat-options:${clientIp(request)}`,
      120,
      60_000
    );
    if (!routeRateLimit.allowed || !ipRateLimit.allowed) {
      return new NextResponse(null, {
        status: 429,
        headers: {
          ...NO_STORE,
          "Retry-After": String(
            Math.max(
              routeRateLimit.retryAfter,
              ipRateLimit.retryAfter
            )
          )
        }
      });
    }
    const bot = await db.storeBot.findUnique({
      where: { publicKey },
      select: { enabled: true, allowedOrigins: true }
    });
    if (!bot || !bot.enabled) {
      return new NextResponse(null, {
        status: 404,
        headers: { ...NO_STORE, Vary: "Origin" }
      });
    }
    const allowedOrigins = configuredOrigins(bot.allowedOrigins);
    if (!isAllowedOrigin(origin, allowedOrigins)) {
      return new NextResponse(null, {
        status: 403,
        headers: { ...NO_STORE, Vary: "Origin" }
      });
    }
    return new NextResponse(null, {
      status: 204,
      headers: cors(origin)
    });
  } catch {
    return new NextResponse(null, {
      status: 503,
      headers: NO_STORE
    });
  }
}

export async function POST(request: NextRequest, context: Context) {
  const requestOrigin = request.headers.get("origin");
  try {
    if (!storefrontWidgetEnabled()) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: NO_STORE }
      );
    }
    const { publicKey } = await context.params;
    if (!isValidWidgetPublicKey(publicKey)) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: NO_STORE }
      );
    }
    const routeRateLimit = await takeRateLimit(
      "widget-route:chat",
      3_000,
      60_000
    );
    if (!routeRateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            ...NO_STORE,
            "Retry-After": String(routeRateLimit.retryAfter)
          }
        }
      );
    }
    const ipRateLimit = await takeRateLimit(
      `widget-pre-auth:${clientIp(request)}`,
      40,
      60_000
    );
    if (!ipRateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            ...NO_STORE,
            "Retry-After": String(ipRateLimit.retryAfter)
          }
        }
      );
    }

    const bot = await db.storeBot.findUnique({ where: { publicKey } });
    if (!bot || !bot.enabled) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: NO_STORE }
      );
    }
    const allowedOrigins = configuredOrigins(bot.allowedOrigins);
    if (!allowedOrigins.length) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: NO_STORE }
      );
    }

    const input = schema.parse(
      await readBoundedJson(request, 8_192, [
        "application/json",
        "text/plain"
      ])
    );
    let session: Awaited<ReturnType<typeof verifyWidgetSession>>;
    try {
      session = await verifyWidgetSession(input.sessionToken, {
        botId: bot.id,
        publicKey
      });
    } catch (error) {
      if (error instanceof WidgetSessionUnavailableError) {
        throw error;
      }
      return NextResponse.json(
        { error: "Request rejected" },
        { status: 401, headers: NO_STORE }
      );
    }

    if (
      !isAllowedOrigin(session.origin, allowedOrigins) ||
      (requestOrigin &&
        requestOrigin !== "null" &&
        requestOrigin !== session.origin &&
        !isApplicationOrigin(request, requestOrigin))
    ) {
      return NextResponse.json(
        { error: "Request rejected" },
        {
          status: 403,
          headers: { ...NO_STORE, Vary: "Origin" }
        }
      );
    }

    const botRateLimit = await takeRateLimit(
      `widget-bot:${publicKey}`,
      600,
      60_000
    );
    if (!botRateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many messages" },
        {
          status: 429,
          headers: {
            ...NO_STORE,
            "Retry-After": String(botRateLimit.retryAfter)
          }
        }
      );
    }

    const sessionRateLimit = await takeRateLimit(
      `widget-session:${publicKey}:${session.senderId}`,
      40,
      60_000
    );
    const responseHeaders =
      requestOrigin === session.origin || requestOrigin === "null"
        ? cors(requestOrigin)
        : NO_STORE;
    if (!sessionRateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many messages" },
        {
          status: 429,
          headers: {
            ...responseHeaders,
            "Retry-After": String(sessionRateLimit.retryAfter)
          }
        }
      );
    }

    await requireDeployedAssistant(bot.assistantId);
    const result = await executeRuntimeMessage({
      assistantId: bot.assistantId,
      senderId: `${publicKey}:${session.senderId}`,
      channel: "storefront",
      storeBotId: bot.id,
      requestId: input.requestId,
      text: input.message,
      metadata: {
        source: "storefront-widget",
        botId: bot.id,
        origin: session.origin
      }
    });
    return NextResponse.json(
      {
        requestId: result.requestId,
        replies: publicReplies(result.replies)
      },
      { headers: responseHeaders }
    );
  } catch (error) {
    if (
      error instanceof RateLimitUnavailableError ||
      error instanceof WidgetSessionUnavailableError
    ) {
      return NextResponse.json(
        { error: "Service temporarily unavailable" },
        {
          status: 503,
          headers: { ...NO_STORE, "Retry-After": "5" }
        }
      );
    }
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: "Request rejected" },
        { status: 413, headers: NO_STORE }
      );
    }
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError
    ) {
      return NextResponse.json(
        { error: "Request rejected" },
        { status: 400, headers: NO_STORE }
      );
    }
    if (error instanceof RuntimeMessageError) {
      const status = [409, 429, 503, 504].includes(error.status)
        ? error.status
        : 503;
      return NextResponse.json(
        {
          error:
            status < 500
              ? "Request rejected"
              : "Service temporarily unavailable"
        },
        { status, headers: NO_STORE }
      );
    }
    return NextResponse.json(
      { error: "Service temporarily unavailable" },
      { status: 503, headers: NO_STORE }
    );
  }
}
