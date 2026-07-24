import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  clientIp,
  configuredOrigins,
  isAllowedOrigin,
  isValidWidgetPublicKey,
  RateLimitUnavailableError,
  storefrontWidgetEnabled,
  takeRateLimit
} from "@/lib/security";
import {
  createWidgetSession,
  WidgetSessionUnavailableError
} from "@/lib/widget-session";

type Context = { params: Promise<{ publicKey: string }> };
const ERROR_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff"
};

function htmlJson(value: unknown) {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

function securityHeaders(
  allowedOrigins: string[],
  applicationOrigin: string
) {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy": [
      "default-src 'none'",
      "base-uri 'none'",
      `connect-src ${applicationOrigin}`,
      `frame-ancestors ${allowedOrigins.join(" ")}`,
      "form-action 'none'",
      "img-src https: data:",
      "object-src 'none'",
      `script-src ${applicationOrigin}`,
      "style-src 'unsafe-inline'"
    ].join("; "),
    "Content-Type": "text/html; charset=utf-8",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
}

export async function GET(request: NextRequest, context: Context) {
  try {
    if (!storefrontWidgetEnabled()) {
      return new NextResponse("Not found", {
        status: 404,
        headers: ERROR_HEADERS
      });
    }
    const { publicKey } = await context.params;
    if (!isValidWidgetPublicKey(publicKey)) {
      return new NextResponse("Not found", {
        status: 404,
        headers: ERROR_HEADERS
      });
    }
    const parentOrigin =
      request.nextUrl.searchParams.get("parentOrigin");
    const configuredApplicationUrl =
      process.env.NEXT_PUBLIC_APP_URL;
    if (
      process.env.NODE_ENV === "production" &&
      !configuredApplicationUrl
    ) {
      throw new Error("NEXT_PUBLIC_APP_URL is required.");
    }
    const applicationOrigin = new URL(
      configuredApplicationUrl ?? request.nextUrl.origin
    ).origin;
    const routeRateLimit = await takeRateLimit(
      "widget-route:bootstrap",
      600,
      60_000
    );
    if (!routeRateLimit.allowed) {
      return new NextResponse("Too many requests", {
        status: 429,
        headers: {
          ...ERROR_HEADERS,
          "Retry-After": String(routeRateLimit.retryAfter)
        }
      });
    }
    const ipRateLimit = await takeRateLimit(
      `widget-bootstrap:${clientIp(request)}`,
      40,
      60_000
    );
    if (!ipRateLimit.allowed) {
      return new NextResponse("Too many requests", {
        status: 429,
        headers: {
          ...ERROR_HEADERS,
          "Retry-After": String(ipRateLimit.retryAfter)
        }
      });
    }

    const bot = await db.storeBot.findUnique({
      where: { publicKey },
      include: { assistant: { select: { name: true } } }
    });
    if (!bot || !bot.enabled) {
      return new NextResponse("Not found", {
        status: 404,
        headers: ERROR_HEADERS
      });
    }

    const allowedOrigins = configuredOrigins(bot.allowedOrigins);
    if (
      !parentOrigin ||
      !isAllowedOrigin(parentOrigin, allowedOrigins)
    ) {
      return new NextResponse("Not found", {
        status: 404,
        headers: ERROR_HEADERS
      });
    }

    const botRateLimit = await takeRateLimit(
      `widget-bootstrap-bot:${publicKey}`,
      120,
      60_000
    );
    if (!botRateLimit.allowed) {
      return new NextResponse("Too many requests", {
        status: 429,
        headers: {
          ...ERROR_HEADERS,
          "Retry-After": String(botRateLimit.retryAfter)
        }
      });
    }

    const session = await createWidgetSession({
      botId: bot.id,
      publicKey: bot.publicKey,
      origin: parentOrigin
    });
    const bootstrap = htmlJson({
      botKey: bot.publicKey,
      parentOrigin,
      sessionToken: session.token,
      sessionExpiresIn: session.expiresIn,
      config: {
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
      }
    });

    return new NextResponse(
      `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Assistance</title>
  </head>
  <body>
    <div id="pleiades-rasa-frame"></div>
    <script id="pleiades-rasa-bootstrap" type="application/json">${bootstrap}</script>
    <script src="/widget-frame.js" defer></script>
  </body>
</html>`,
      {
        status: 200,
        headers: securityHeaders(
          allowedOrigins,
          applicationOrigin
        )
      }
    );
  } catch (error) {
    if (
      error instanceof RateLimitUnavailableError ||
      error instanceof WidgetSessionUnavailableError
    ) {
      return new NextResponse("Service unavailable", {
        status: 503,
        headers: { ...ERROR_HEADERS, "Retry-After": "5" }
      });
    }
    return new NextResponse("Service unavailable", {
      status: 503,
      headers: ERROR_HEADERS
    });
  }
}
