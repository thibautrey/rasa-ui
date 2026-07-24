import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  clientIp,
  configuredOrigins,
  isAllowedOrigin,
  isValidWidgetPublicKey,
  storefrontWidgetEnabled,
  takeRateLimit
} from "@/lib/security";

type Context = { params: Promise<{ publicKey: string }> };
const NO_STORE = { "Cache-Control": "no-store" };

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "null",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...NO_STORE,
    Vary: "Origin"
  };
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
      "widget-route:config",
      1_200,
      60_000
    );
    const ipRateLimit = await takeRateLimit(
      `widget-config:${clientIp(request)}`,
      120,
      60_000
    );
    if (!routeRateLimit.allowed || !ipRateLimit.allowed) {
      return new NextResponse(null, {
        status: 429,
        headers: NO_STORE
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

export async function GET(request: NextRequest, context: Context) {
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
      "widget-route:config",
      1_200,
      60_000
    );
    const ipRateLimit = await takeRateLimit(
      `widget-config:${clientIp(request)}`,
      120,
      60_000
    );
    if (!routeRateLimit.allowed || !ipRateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: NO_STORE }
      );
    }
    const bot = await db.storeBot.findUnique({
      where: { publicKey },
      include: { assistant: { select: { name: true } } }
    });
    if (!bot || !bot.enabled) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: NO_STORE }
      );
    }

    const origin = request.headers.get("origin");
    const allowedOrigins = configuredOrigins(bot.allowedOrigins);
    if (!isAllowedOrigin(origin, allowedOrigins)) {
      return NextResponse.json(
        { error: "Request rejected" },
        {
          status: 403,
          headers: { ...NO_STORE, Vary: "Origin" }
        }
      );
    }

    return NextResponse.json(
      {
        id: bot.publicKey,
        name: bot.name,
        assistantName: bot.assistant.name,
        primaryColor: bot.primaryColor,
        accentColor: bot.accentColor,
        position: bot.position,
        welcomeMessage: bot.welcomeMessage,
        placeholder: bot.placeholder,
        launcherLabel: bot.launcherLabel,
        avatarUrl: bot.avatarUrl,
        locale: bot.locale
      },
      { headers: cors(origin) }
    );
  } catch {
    return NextResponse.json(
      { error: "Service temporarily unavailable" },
      { status: 503, headers: NO_STORE }
    );
  }
}
