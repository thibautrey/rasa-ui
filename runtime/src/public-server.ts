import { chmod, readFile, unlink } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import {
  exactOriginSchema,
  flowTurnRequestSchema,
  parseJsonEnvironment,
  runtimeBotConfigSchema,
  widgetTurnRequestSchema,
  type FlowTurnRequest,
  type RuntimeBotConfig,
} from "./contracts.js";
import {
  acquireSessionLease,
  consumeQuotas,
  consumeTurnBudget,
  createRuntimeRedis,
  createSession,
  environmentFlag,
  parseJsonBody,
  pingRedis,
  readRequestBody,
  readSession,
  releaseSessionLease,
  requireJsonContentType,
  requiredEnvironment,
  RuntimeError,
  singleHeader,
  type RuntimeRedisClient,
} from "./security.js";
import {
  loadFlowClientConfiguration,
  requestBrokerTurn,
  type FlowClientConfiguration,
} from "./upstreams.js";

const MAX_PUBLIC_BODY_BYTES = 2 * 1_024;
const PUBLIC_SOCKET_PATH = "/run/runtime-public/public.sock";

type PublicSettings = {
  enabled: boolean;
  publicOrigin: string;
  expectedHost: string;
  socketPath: string;
  bot: RuntimeBotConfig;
  flow: FlowClientConfiguration;
};

type PublicAssets = {
  loader: Buffer;
  frame: Buffer;
};

function loadSettings(): PublicSettings {
  const publicOrigin = exactOriginSchema.parse(
    requiredEnvironment("RUNTIME_PUBLIC_ORIGIN", 8, 256),
  );
  return {
    enabled: environmentFlag("STOREFRONT_WIDGET_ENABLED"),
    publicOrigin,
    expectedHost: new URL(publicOrigin).host.toLowerCase(),
    socketPath: PUBLIC_SOCKET_PATH,
    bot: parseJsonEnvironment(
      "RUNTIME_BOT_CONFIG_JSON",
      runtimeBotConfigSchema,
    ),
    flow: loadFlowClientConfiguration(),
  };
}

async function loadAssets(): Promise<PublicAssets> {
  const [loader, frame] = await Promise.all([
    readFile(new URL("../public/widget-loader-v1.js", import.meta.url)),
    readFile(new URL("../public/widget-frame.js", import.meta.url)),
  ]);
  return { loader, frame };
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
}

function writeJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  cors = false,
): void {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", String(body.length));
  if (cors) {
    response.setHeader("Access-Control-Allow-Origin", "null");
    response.setHeader("Vary", "Origin");
  }
  securityHeaders(response);
  response.end(body);
}

function writeNotFound(response: ServerResponse, cors = false): void {
  writeJson(
    response,
    404,
    { error: { code: "NOT_FOUND", message: "Not found" } },
    cors,
  );
}

function writeRuntimeError(
  response: ServerResponse,
  error: unknown,
  cors: boolean,
): void {
  if (error instanceof RuntimeError && error.status < 500) {
    if (error.status === 429) response.setHeader("Retry-After", "60");
    writeJson(
      response,
      error.status,
      { error: { code: error.code, message: error.message } },
      cors,
    );
    return;
  }
  const code = error instanceof RuntimeError ? error.code : "UNEXPECTED_ERROR";
  console.error("[public-runtime] Request failed", { code });
  writeJson(
    response,
    503,
    {
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Service temporarily unavailable",
      },
    },
    cors,
  );
}

function expectedHost(request: IncomingMessage, settings: PublicSettings): boolean {
  return (
    singleHeader(request.headers, "host").toLowerCase() === settings.expectedHost
  );
}

function framePathBotKey(pathname: string): string | null {
  const match = /^\/widget\/(bot_[A-Za-z0-9_-]{20,80})$/u.exec(pathname);
  return match?.[1] ?? null;
}

function parentOriginFromRequest(
  request: IncomingMessage,
  url: URL,
  settings: PublicSettings,
): string | null {
  const candidates = url.searchParams.getAll("parentOrigin");
  if (candidates.length !== 1) return null;
  const parsed = exactOriginSchema.safeParse(candidates[0]);
  if (
    !parsed.success ||
    !settings.bot.allowedOrigins.includes(parsed.data)
  ) {
    return null;
  }

  const referer = singleHeader(request.headers, "referer");
  let refererOrigin: string;
  try {
    refererOrigin = new URL(referer).origin;
  } catch {
    return null;
  }
  if (refererOrigin !== parsed.data) return null;

  const fetchDestination = singleHeader(request.headers, "sec-fetch-dest");
  if (fetchDestination && fetchDestination !== "iframe") return null;
  return parsed.data;
}

function safeBootstrapJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function frameHtml(
  settings: PublicSettings,
  parentOrigin: string,
  sessionToken: string,
): Buffer {
  const bootstrap = safeBootstrapJson({
    version: 1,
    botKey: settings.bot.botKey,
    parentOrigin,
    sessionToken,
    config: {
      name: settings.bot.name,
      locale: settings.bot.locale,
      primaryColor: settings.bot.primaryColor,
      position: settings.bot.position,
      locations: settings.bot.locations.map((location) => ({
        id: location.id,
        label: location.label,
      })),
    },
  });
  const html =
    `<!doctype html><html lang="${settings.bot.locale}"><head>` +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>Assistant</title></head><body>" +
    '<main id="pleiades-rasa-frame"></main>' +
    `<script id="pleiades-rasa-bootstrap" type="application/json">${bootstrap}</script>` +
    '<script src="/widget-frame.js" defer></script></body></html>';
  return Buffer.from(html, "utf8");
}

function writeAsset(
  response: ServerResponse,
  asset: Buffer,
  immutable: boolean,
): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/javascript; charset=utf-8");
  response.setHeader("Content-Length", String(asset.length));
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  response.setHeader(
    "Cache-Control",
    immutable
      ? "public, max-age=31536000, immutable"
      : "public, max-age=300",
  );
  securityHeaders(response);
  response.end(asset);
}

async function handleWidgetFrame(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  settings: PublicSettings,
  redis: RuntimeRedisClient,
): Promise<void> {
  if (!settings.enabled) {
    writeNotFound(response);
    return;
  }
  const botKey = framePathBotKey(url.pathname);
  const parentOrigin = parentOriginFromRequest(request, url, settings);
  if (
    request.method !== "GET" ||
    botKey !== settings.bot.botKey ||
    !parentOrigin
  ) {
    writeNotFound(response);
    return;
  }

  await consumeQuotas(redis, [
    { scope: "bootstrap:global", limit: 120 },
    { scope: `bootstrap:bot:${botKey}`, limit: 60 },
    { scope: `bootstrap:origin:${parentOrigin}`, limit: 30 },
  ]);
  const session = await createSession(redis, botKey, parentOrigin);
  const html = frameHtml(settings, parentOrigin, session.token);
  response.statusCode = 200;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Content-Length", String(html.length));
  response.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; base-uri 'none'; connect-src 'self'; frame-ancestors ${parentOrigin}; ` +
      "form-action 'none'; img-src 'none'; object-src 'none'; script-src 'self'; style-src 'unsafe-inline'",
  );
  response.setHeader("Cross-Origin-Opener-Policy", "unsafe-none");
  response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  securityHeaders(response);
  response.end(html);
}

function validPreflight(request: IncomingMessage): boolean {
  if (
    singleHeader(request.headers, "origin") !== "null" ||
    singleHeader(request.headers, "access-control-request-method") !== "POST"
  ) {
    return false;
  }
  const requestedHeaders = singleHeader(
    request.headers,
    "access-control-request-headers",
  )
    .toLowerCase()
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return (
    requestedHeaders.length === 1 && requestedHeaders[0] === "content-type"
  );
}

function writePreflight(response: ServerResponse): void {
  response.statusCode = 204;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Access-Control-Allow-Origin", "null");
  response.setHeader("Access-Control-Allow-Methods", "POST");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Max-Age", "600");
  response.setHeader("Vary", "Origin");
  securityHeaders(response);
  response.end();
}

async function handleTurn(
  request: IncomingMessage,
  response: ServerResponse,
  routeBotKey: string,
  settings: PublicSettings,
  redis: RuntimeRedisClient,
): Promise<void> {
  const cors = singleHeader(request.headers, "origin") === "null";
  if (!settings.enabled) {
    writeNotFound(response, cors);
    return;
  }
  if (routeBotKey !== settings.bot.botKey) {
    writeNotFound(response, cors);
    return;
  }
  if (request.method === "OPTIONS") {
    if (validPreflight(request)) writePreflight(response);
    else writeNotFound(response, cors);
    return;
  }
  if (
    request.method !== "POST" ||
    !cors
  ) {
    writeNotFound(response, cors);
    return;
  }

  requireJsonContentType(request.headers);
  await consumeQuotas(redis, [{ scope: "turn:ingress", limit: 600 }]);
  const body = await readRequestBody(request, MAX_PUBLIC_BODY_BYTES);
  const parsed = widgetTurnRequestSchema.safeParse(parseJsonBody(body));
  if (!parsed.success) {
    throw new RuntimeError(400, "INVALID_REQUEST", "Invalid request");
  }

  const session = await readSession(redis, parsed.data.sessionToken);
  if (session.botKey !== settings.bot.botKey) {
    throw new RuntimeError(401, "SESSION_EXPIRED", "Session expired");
  }
  await consumeTurnBudget(redis, session, parsed.data.requestId);

  const location = settings.bot.locations.find(
    (candidate) => candidate.id === parsed.data.locationId,
  );
  if (!location) {
    throw new RuntimeError(400, "INVALID_REQUEST", "Invalid request");
  }

  const flowRequest: FlowTurnRequest =
    parsed.data.operation === "sky.events"
      ? {
          version: 1,
          sessionId: session.sessionId,
          turnId: parsed.data.requestId,
          operation: parsed.data.operation,
          locationId: parsed.data.locationId,
          days: parsed.data.days,
        }
      : {
          version: 1,
          sessionId: session.sessionId,
          turnId: parsed.data.requestId,
          operation: parsed.data.operation,
          locationId: parsed.data.locationId,
        };
  const validatedFlowRequest = flowTurnRequestSchema.parse(flowRequest);
  const lease = await acquireSessionLease(redis, session.sessionId);
  try {
    const brokerResponse = await requestBrokerTurn(
      validatedFlowRequest,
      settings.flow,
    );
    writeJson(
      response,
      200,
      {
        requestId: validatedFlowRequest.turnId,
        ...brokerResponse.result,
      },
      true,
    );
  } finally {
    await releaseSessionLease(redis, lease);
  }
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  settings: PublicSettings,
  assets: PublicAssets,
  redis: RuntimeRedisClient,
): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", settings.publicOrigin);
  if (request.method === "GET" && requestUrl.pathname === "/healthz") {
    const redisHealthy = await pingRedis(redis);
    writeJson(
      response,
      redisHealthy ? 200 : 503,
      {
        status: redisHealthy ? "ok" : "unavailable",
        enabled: settings.enabled,
      },
    );
    return;
  }
  if (!expectedHost(request, settings)) {
    writeNotFound(response);
    return;
  }
  if (
    request.method === "GET" &&
    requestUrl.pathname === "/widget-loader-v1.js"
  ) {
    writeAsset(response, assets.loader, true);
    return;
  }
  if (request.method === "GET" && requestUrl.pathname === "/widget-frame.js") {
    writeAsset(response, assets.frame, false);
    return;
  }
  if (requestUrl.pathname.startsWith("/widget/")) {
    await handleWidgetFrame(request, response, requestUrl, settings, redis);
    return;
  }
  const turnMatch =
    /^\/api\/widget\/(bot_[A-Za-z0-9_-]{20,80})\/turn$/u.exec(
      requestUrl.pathname,
    );
  if (turnMatch?.[1]) {
    await handleTurn(request, response, turnMatch[1], settings, redis);
    return;
  }
  writeNotFound(response);
}

async function main(): Promise<void> {
  const settings = loadSettings();
  const assets = await loadAssets();
  const redis = createRuntimeRedis(
    "public-runtime",
    "runtime_public",
  );
  await redis.connect();
  const server = createServer(
    {
      insecureHTTPParser: false,
      maxHeaderSize: 8 * 1_024,
      requireHostHeader: true,
    },
    (request, response) => {
      void routeRequest(request, response, settings, assets, redis).catch(
        (error: unknown) => {
          if (!response.headersSent) {
            const cors = singleHeader(request.headers, "origin") === "null";
            writeRuntimeError(response, error, cors);
          } else {
            response.destroy();
          }
        },
      );
    },
  );
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  await unlink(settings.socketPath).catch((error: unknown) => {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) {
      throw error;
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(settings.socketPath, () => resolve());
  });
  await chmod(settings.socketPath, 0o666);
  console.log("[public-runtime] Listening", {
    enabled: settings.enabled,
    transport: "unix",
  });

  const shutdown = (): void => {
    server.close(() => {
      void Promise.allSettled([
        redis.quit(),
        unlink(settings.socketPath),
      ]).finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void main().catch((error: unknown) => {
  console.error("[public-runtime] Startup failed", {
    errorType: error instanceof Error ? error.name : "unknown",
  });
  process.exit(1);
});
