import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { chmod, unlink } from "node:fs/promises";

import {
  capabilityNames,
  flowCredentialsSchema,
  flowTurnRequestSchema,
  parseJsonEnvironment,
  runtimeBotConfigSchema,
  type FlowCredential,
  type RuntimeBotConfig,
} from "./contracts.js";
import {
  authenticateFlowRequest,
  boundedIntegerEnvironment,
  createRuntimeRedis,
  environmentFlag,
  hmacHeaders,
  parseJsonBody,
  pingRedis,
  readRequestBody,
  requiredEnvironment,
  requiredSecretFile,
  requireJsonContentType,
  RuntimeError,
  type RuntimeRedisClient,
} from "./security.js";
import {
  loadCapabilityConfiguration,
  loadRasaConfiguration,
  requestStorefrontCapability,
  runRasaFlow,
  type CapabilityConfiguration,
  type RasaConfiguration,
} from "./upstreams.js";
import { RUNTIME_RELEASE } from "./release.js";

const FLOW_PATH = "/v1/turn";
const MAX_FLOW_BODY_BYTES = 2 * 1_024;
const FLOW_PROXY_SOCKET_PATH = "/run/runtime-broker/broker.sock";
const FLOW_PROXY_SECRET_PATH = "/run/secrets/flow-proxy-secret";

type ProxySettings = {
  enabled: boolean;
  socketPath: string;
  credentials: ReadonlyMap<string, FlowCredential>;
  rateLimitPerMinute: number;
  rasa: RasaConfiguration;
  capability: CapabilityConfiguration;
  bot: RuntimeBotConfig;
};

function loadSettings(): ProxySettings {
  const credentials = flowCredentialsSchema.parse([
    {
      keyId: requiredEnvironment("RASA_FLOW_PROXY_KEY_ID", 8, 80),
      secret: requiredSecretFile(FLOW_PROXY_SECRET_PATH, 32, 512),
      botId: requiredEnvironment("FLOW_PROXY_BOT_ID", 1, 120),
      capabilities: [...capabilityNames],
    },
  ]);
  return {
    enabled: environmentFlag("FLOW_PROXY_ENABLED"),
    socketPath: FLOW_PROXY_SOCKET_PATH,
    credentials: new Map(
      credentials.map((credential) => [credential.keyId, credential]),
    ),
    rateLimitPerMinute: boundedIntegerEnvironment(
      "FLOW_PROXY_RATE_LIMIT_PER_MINUTE",
      120,
      1,
      600,
    ),
    rasa: loadRasaConfiguration(),
    capability: loadCapabilityConfiguration(),
    bot: parseJsonEnvironment(
      "RUNTIME_BOT_CONFIG_JSON",
      runtimeBotConfigSchema,
    ),
  };
}

function writeJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", String(body.length));
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.end(body);
}

function writeNotFound(response: ServerResponse): void {
  writeJson(response, 404, {
    error: { code: "NOT_FOUND", message: "Not found" },
  });
}

function writeRuntimeError(response: ServerResponse, error: unknown): void {
  if (error instanceof RuntimeError && error.status < 500) {
    if (error.status === 429) response.setHeader("Retry-After", "60");
    writeJson(response, error.status, {
      error: { code: error.code, message: error.message },
    });
    return;
  }
  const code = error instanceof RuntimeError ? error.code : "UNEXPECTED_ERROR";
  console.error("[rasa-flow-proxy] Request failed", { code });
  writeJson(response, 503, {
    error: {
      code: "SERVICE_UNAVAILABLE",
      message: "Service temporarily unavailable",
    },
  });
}

async function handleTurn(
  request: IncomingMessage,
  response: ServerResponse,
  settings: ProxySettings,
  redis: RuntimeRedisClient,
): Promise<void> {
  if (!settings.enabled) {
    writeNotFound(response);
    return;
  }
  if (request.method !== "POST") {
    writeNotFound(response);
    return;
  }

  const body = await readRequestBody(request, MAX_FLOW_BODY_BYTES);
  const credential = await authenticateFlowRequest({
    body,
    credentials: settings.credentials,
    headers: hmacHeaders(request.headers, "x-storefront-flow"),
    path: FLOW_PATH,
    rateLimitPerMinute: settings.rateLimitPerMinute,
    redis,
  });
  requireJsonContentType(request.headers);

  const parsed = flowTurnRequestSchema.safeParse(parseJsonBody(body));
  if (!parsed.success) {
    throw new RuntimeError(400, "INVALID_REQUEST", "Invalid request");
  }
  if (!credential.capabilities.includes(parsed.data.operation)) {
    throw new RuntimeError(
      403,
      "CAPABILITY_FORBIDDEN",
      "Capability not enabled",
    );
  }

  const location = settings.bot.locations.find(
    (candidate) => candidate.id === parsed.data.locationId,
  );
  if (!location) {
    throw new RuntimeError(400, "INVALID_REQUEST", "Invalid request");
  }

  await runRasaFlow(parsed.data, credential, settings.rasa);
  const result = await requestStorefrontCapability(
    parsed.data.operation,
    location,
    parsed.data.operation === "sky.events" ? parsed.data.days : undefined,
    settings.capability,
  );
  writeJson(response, 200, {
    version: 1,
    turnId: parsed.data.turnId,
    result,
  });
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  settings: ProxySettings,
  redis: RuntimeRedisClient,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://rasa-flow-proxy");
  if (request.method === "GET" && url.pathname === "/healthz") {
    const redisHealthy = await pingRedis(redis);
    writeJson(response, redisHealthy ? 200 : 503, {
      status: redisHealthy ? "ok" : "unavailable",
      enabled: settings.enabled,
      release: RUNTIME_RELEASE,
    });
    return;
  }
  if (url.pathname === FLOW_PATH && !url.search) {
    await handleTurn(request, response, settings, redis);
    return;
  }
  writeNotFound(response);
}

async function main(): Promise<void> {
  const settings = loadSettings();
  const redis = createRuntimeRedis(
    "rasa-flow-proxy",
    "runtime_broker",
  );
  await redis.connect();
  const server = createServer(
    {
      insecureHTTPParser: false,
      maxHeaderSize: 8 * 1_024,
      requireHostHeader: true,
    },
    (request, response) => {
      void routeRequest(request, response, settings, redis).catch(
        (error: unknown) => {
          if (!response.headersSent) writeRuntimeError(response, error);
          else response.destroy();
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
  console.log("[rasa-flow-proxy] Listening", {
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

function startupErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("RUNTIME_BOT_CONFIG_JSON")) {
    return "BOT_CONFIG_INVALID";
  }
  if (message.includes("Rasa JWT private key file")) {
    return "RASA_KEY_INVALID";
  }
  if (message.includes("Required secret file")) {
    return "SECRET_FILE_INVALID";
  }
  if (message.includes("RASA_BASE_URL")) {
    return "RASA_URL_INVALID";
  }
  if (message.includes("STOREFRONT_CAPABILITIES_BASE_URL")) {
    return "CAPABILITY_URL_INVALID";
  }
  return "CONFIG_INVALID";
}

void main().catch((error: unknown) => {
  console.error("[rasa-flow-proxy] Startup failed", {
    code: startupErrorCode(error),
    errorType: error instanceof Error ? error.name : "unknown",
  });
  process.exit(1);
});
