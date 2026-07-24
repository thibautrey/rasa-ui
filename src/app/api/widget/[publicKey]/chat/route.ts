import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireDeployedAssistant } from "@/lib/models";
import {
  executeRuntimeMessage,
  RuntimeMessageError
} from "@/lib/runtime-messages";
import { publicRasaError, publicRasaHttpStatus } from "@/lib/rasa";
import {
  clientIp,
  isAllowedOrigin,
  takeRateLimit
} from "@/lib/security";

const schema = z.object({
  sender: z.string().trim().min(12).max(120),
  message: z.string().trim().min(1).max(4_000),
  requestId: z.string().trim().min(16).max(128)
});

type Context = { params: Promise<{ publicKey: string }> };

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "null",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin"
  };
}

export async function OPTIONS(request: NextRequest, context: Context) {
  const origin = request.headers.get("origin");
  const { publicKey } = await context.params;
  const bot = await db.storeBot.findUnique({
    where: { publicKey },
    select: { enabled: true, allowedOrigins: true }
  });
  if (!bot || !bot.enabled) {
    return new NextResponse(null, {
      status: 404,
      headers: { Vary: "Origin" }
    });
  }
  if (!isAllowedOrigin(origin, bot.allowedOrigins as string[])) {
    return new NextResponse(null, {
      status: 403,
      headers: { Vary: "Origin" }
    });
  }
  return new NextResponse(null, { status: 204, headers: cors(origin) });
}

export async function POST(request: NextRequest, context: Context) {
  const origin = request.headers.get("origin");
  const { publicKey } = await context.params;
  const bot = await db.storeBot.findUnique({ where: { publicKey } });
  if (!bot || !bot.enabled) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isAllowedOrigin(origin, bot.allowedOrigins as string[])) {
    return NextResponse.json(
      { error: "Origin not allowed" },
      { status: 403, headers: { Vary: "Origin" } }
    );
  }

  const rateLimit = takeRateLimit(
    `widget:${publicKey}:${clientIp(request)}`,
    40,
    60_000
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many messages" },
      {
        status: 429,
        headers: {
          ...cors(origin),
          "Retry-After": String(rateLimit.retryAfter)
        }
      }
    );
  }

  try {
    const input = schema.parse(await request.json());
    await requireDeployedAssistant(bot.assistantId);
    const sender = `${publicKey}:${input.sender}`;
    const result = await executeRuntimeMessage({
      assistantId: bot.assistantId,
      senderId: sender,
      channel: "storefront",
      storeBotId: bot.id,
      requestId: input.requestId,
      text: input.message,
      metadata: {
        source: "storefront-widget",
        botId: bot.id,
        origin
      }
    });
    return NextResponse.json(
      {
        requestId: result.requestId,
        replies: result.replies,
        latencyMs: result.latencyMs,
        cached: result.cached
      },
      { headers: cors(origin) }
    );
  } catch (error) {
    if (error instanceof RuntimeMessageError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: cors(origin) }
      );
    }
    return NextResponse.json(
      publicRasaError(error),
      { status: publicRasaHttpStatus(error), headers: cors(origin) }
    );
  }
}
