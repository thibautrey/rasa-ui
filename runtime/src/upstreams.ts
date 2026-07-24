import {
  createPrivateKey,
  randomBytes,
  sign,
  type KeyObject,
} from "node:crypto";
import {
  request as httpRequest,
  type IncomingMessage,
} from "node:http";
import { z } from "zod";

import {
  backendCapabilityRequest,
  flowTurnResponseSchema,
  storefrontCapabilityResponseSchema,
  type ConfiguredLocation,
  type FlowCredential,
  type FlowDecisionResponse,
  type FlowTurnResponse,
  type FlowTurnRequest,
  type StorefrontCapabilityResponse,
} from "./contracts.js";
import {
  boundedIntegerEnvironment,
  requiredEnvironment,
  requiredSecretFile,
  RuntimeError,
  signedHeaders,
} from "./security.js";

const FLOW_PATH = "/v1/turn";
const CAPABILITY_PATH = "/api/storefront-assistant/capabilities/execute";
const FLOW_PROXY_SOCKET_PATH = "/run/runtime-broker/broker.sock";
const FLOW_PROXY_SECRET_PATH = "/run/secrets/flow-proxy-secret";
const RASA_JWT_PRIVATE_KEY_PATH = "/run/secrets/rasa-jwt-private-key.pem";
const STOREFRONT_CAPABILITIES_SECRET_PATH =
  "/run/secrets/storefront-capabilities-secret";

export type FlowClientConfiguration = {
  socketPath: string;
  keyId: string;
  secret: string;
  timeoutMs: number;
};

export type CapabilityConfiguration = {
  baseUrl: URL;
  keyId: string;
  secret: string;
  timeoutMs: number;
};

export type RasaConfiguration = {
  baseUrl: URL;
  privateKey: KeyObject;
  timeoutMs: number;
};

function exactBaseUrl(
  name: string,
  options: { allowHttp: boolean },
): URL {
  const raw = requiredEnvironment(name, 8, 512);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} is invalid`);
  }
  if (
    (url.protocol !== "https:" &&
      !(options.allowHttp && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} is invalid`);
  }
  url.pathname = "/";
  return url;
}

function hmacKeyId(name: string): string {
  const value = requiredEnvironment(name, 8, 80);
  if (!/^[A-Za-z0-9._-]{8,80}$/u.test(value)) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

export function loadFlowClientConfiguration(): FlowClientConfiguration {
  return {
    socketPath: FLOW_PROXY_SOCKET_PATH,
    keyId: hmacKeyId("RASA_FLOW_PROXY_KEY_ID"),
    secret: requiredSecretFile(FLOW_PROXY_SECRET_PATH, 32, 512),
    timeoutMs: boundedIntegerEnvironment(
      "RASA_FLOW_PROXY_TIMEOUT_MS",
      25_000,
      1_000,
      40_000,
    ),
  };
}

export function loadCapabilityConfiguration(): CapabilityConfiguration {
  return {
    baseUrl: exactBaseUrl("STOREFRONT_CAPABILITIES_BASE_URL", {
      allowHttp: false,
    }),
    keyId: hmacKeyId("STOREFRONT_CAPABILITIES_KEY_ID"),
    secret: requiredSecretFile(
      STOREFRONT_CAPABILITIES_SECRET_PATH,
      32,
      512,
    ),
    timeoutMs: boundedIntegerEnvironment(
      "STOREFRONT_CAPABILITIES_TIMEOUT_MS",
      10_000,
      1_000,
      20_000,
    ),
  };
}

export function loadRasaConfiguration(): RasaConfiguration {
  const encodedPrivateKey = requiredSecretFile(
    RASA_JWT_PRIVATE_KEY_PATH,
    800,
    24_000,
  );
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(encodedPrivateKey);
  } catch {
    throw new Error("Rasa JWT private key file is invalid");
  }
  if (
    privateKey.type !== "private" ||
    privateKey.asymmetricKeyType !== "rsa" ||
    (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2_048
  ) {
    throw new Error("Rasa JWT private key file is invalid");
  }
  return {
    baseUrl: exactBaseUrl("RASA_BASE_URL", { allowHttp: false }),
    privateKey,
    timeoutMs: boundedIntegerEnvironment(
      "RASA_REQUEST_TIMEOUT_MS",
      3_000,
      500,
      10_000,
    ),
  };
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const rawLength = response.headers.get("content-length");
  if (
    rawLength &&
    (!/^[0-9]+$/u.test(rawLength) || Number(rawLength) > maximumBytes)
  ) {
    await response.body?.cancel();
    throw new RuntimeError(
      502,
      "UPSTREAM_INVALID_RESPONSE",
      "Upstream response is invalid",
    );
  }
  const mediaType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json" || !response.body) {
    await response.body?.cancel();
    throw new RuntimeError(
      502,
      "UPSTREAM_INVALID_RESPONSE",
      "Upstream response is invalid",
    );
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new RuntimeError(
        502,
        "UPSTREAM_INVALID_RESPONSE",
        "Upstream response is invalid",
      );
    }
    chunks.push(Buffer.from(chunk.value));
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, size),
    );
    return JSON.parse(text) as unknown;
  } catch {
    throw new RuntimeError(
      502,
      "UPSTREAM_INVALID_RESPONSE",
      "Upstream response is invalid",
    );
  }
}

async function fetchJson(
  url: URL,
  init: RequestInit,
  options: {
    maximumBytes: number;
    timeoutMs: number;
  },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch {
    throw new RuntimeError(
      502,
      "UPSTREAM_UNAVAILABLE",
      "Upstream unavailable",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 429) {
      throw new RuntimeError(429, "RATE_LIMITED", "Request rate exceeded");
    }
    throw new RuntimeError(
      502,
      "UPSTREAM_REJECTED",
      "Upstream rejected the request",
    );
  }
  return readBoundedJson(response, options.maximumBytes);
}

async function readBoundedNodeJson(
  response: IncomingMessage,
  maximumBytes: number,
): Promise<unknown> {
  const rawLength = response.headers["content-length"];
  if (
    (typeof rawLength === "string" &&
      (!/^[0-9]+$/u.test(rawLength) || Number(rawLength) > maximumBytes)) ||
    Array.isArray(rawLength)
  ) {
    response.destroy();
    throw new RuntimeError(
      502,
      "UPSTREAM_INVALID_RESPONSE",
      "Upstream response is invalid",
    );
  }
  const rawContentType = response.headers["content-type"];
  const contentType = Array.isArray(rawContentType)
    ? ""
    : rawContentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    response.destroy();
    throw new RuntimeError(
      502,
      "UPSTREAM_INVALID_RESPONSE",
      "Upstream response is invalid",
    );
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const rawChunk of response) {
    const chunk = Buffer.isBuffer(rawChunk)
      ? rawChunk
      : Buffer.from(rawChunk as Uint8Array);
    size += chunk.byteLength;
    if (size > maximumBytes) {
      response.destroy();
      throw new RuntimeError(
        502,
        "UPSTREAM_INVALID_RESPONSE",
        "Upstream response is invalid",
      );
    }
    chunks.push(chunk);
  }
  if (typeof rawLength === "string" && size !== Number(rawLength)) {
    throw new RuntimeError(
      502,
      "UPSTREAM_INVALID_RESPONSE",
      "Upstream response is invalid",
    );
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, size),
    );
    return JSON.parse(text) as unknown;
  } catch {
    throw new RuntimeError(
      502,
      "UPSTREAM_INVALID_RESPONSE",
      "Upstream response is invalid",
    );
  }
}

async function requestUnixJson(input: {
  body: string;
  headers: Record<string, string>;
  maximumBytes: number;
  path: string;
  socketPath: string;
  timeoutMs: number;
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = (value: unknown): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(
        error instanceof RuntimeError
          ? error
          : new RuntimeError(
              502,
              "UPSTREAM_UNAVAILABLE",
              "Upstream unavailable",
            ),
      );
    };
    const request = httpRequest(
      {
        socketPath: input.socketPath,
        path: input.path,
        method: "POST",
        headers: {
          ...input.headers,
          "Content-Length": String(Buffer.byteLength(input.body, "utf8")),
        },
      },
      (response) => {
        if (
          !response.statusCode ||
          response.statusCode < 200 ||
          response.statusCode >= 300
        ) {
          const status = response.statusCode;
          response.resume();
          fail(
            status === 429
              ? new RuntimeError(
                  429,
                  "RATE_LIMITED",
                  "Request rate exceeded",
                )
              : new RuntimeError(
                  502,
                  "UPSTREAM_REJECTED",
                  "Upstream rejected the request",
                ),
          );
          return;
        }
        void readBoundedNodeJson(response, input.maximumBytes).then(
          succeed,
          fail,
        );
      },
    );
    request.setTimeout(input.timeoutMs, () => {
      request.destroy();
      fail(
        new RuntimeError(
          502,
          "UPSTREAM_UNAVAILABLE",
          "Upstream unavailable",
        ),
      );
    });
    request.once("error", fail);
    request.end(input.body, "utf8");
  });
}

export async function requestBrokerTurn(
  request: FlowTurnRequest,
  configuration: FlowClientConfiguration,
): Promise<FlowTurnResponse> {
  const body = JSON.stringify(request);
  const decoded = await requestUnixJson({
    socketPath: configuration.socketPath,
    path: FLOW_PATH,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...signedHeaders(
        body,
        configuration.keyId,
        configuration.secret,
        FLOW_PATH,
        "x-storefront-flow",
      ),
    },
    body,
    maximumBytes: 64 * 1_024,
    timeoutMs: configuration.timeoutMs,
  });
  const parsed = flowTurnResponseSchema.safeParse(decoded);
  if (
    !parsed.success ||
    parsed.data.turnId !== request.turnId ||
    parsed.data.result.capability !== request.operation
  ) {
    throw new RuntimeError(
      502,
      "FLOW_DECISION_REJECTED",
      "The requested action was not approved",
    );
  }
  return parsed.data;
}

export async function requestStorefrontCapability(
  operation: FlowTurnRequest["operation"],
  location: ConfiguredLocation,
  days: 1 | 3 | 7 | undefined,
  configuration: CapabilityConfiguration,
): Promise<StorefrontCapabilityResponse> {
  const request = backendCapabilityRequest(operation, location, days);
  const body = JSON.stringify(request);
  const decoded = await fetchJson(
    new URL(CAPABILITY_PATH, configuration.baseUrl),
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...signedHeaders(
          body,
          configuration.keyId,
          configuration.secret,
          CAPABILITY_PATH,
          "x-storefront-assistant",
        ),
      },
      body,
    },
    { maximumBytes: 64 * 1_024, timeoutMs: configuration.timeoutMs },
  );
  const parsed = storefrontCapabilityResponseSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.capability !== operation) {
    throw new RuntimeError(
      502,
      "CAPABILITY_INVALID_RESPONSE",
      "Capability response is invalid",
    );
  }
  return parsed.data;
}

const predictionSchema = z
  .object({
    scores: z
      .array(
        z
          .object({
            action: z.string().min(1).max(160),
            score: z.number().finite().min(0).max(1),
          })
          .passthrough(),
      )
      .min(1)
      .max(128),
  })
  .passthrough();

const customMessageSchema = z
  .object({
    recipient_id: z.string().min(1).max(160).optional(),
    custom: z
      .object({
        type: z.literal("storefront_capability"),
        capability: z.enum(["sky.forecast", "sky.events"]),
      })
      .strict(),
  })
  .strict();

const executedUtteranceSchema = z
  .object({
    messages: z.array(customMessageSchema).length(1),
  })
  .passthrough();

function rasaUrl(configuration: RasaConfiguration, path: string): URL {
  return new URL(path, configuration.baseUrl);
}

function rasaUserJwt(configuration: RasaConfiguration, sender: string): string {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
    "utf8",
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      user: {
        username: sender,
        role: "user",
      },
      iat: issuedAt,
      nbf: issuedAt - 2,
      exp: issuedAt + 30,
      jti: randomBytes(16).toString("base64url"),
    }),
    "utf8",
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(signingInput, "ascii"),
    configuration.privateKey,
  ).toString("base64url");
  return `${signingInput}.${signature}`;
}

async function rasaJson(
  configuration: RasaConfiguration,
  sender: string,
  path: string,
  body: string | undefined,
  maximumBytes: number,
): Promise<unknown> {
  return fetchJson(
    rasaUrl(configuration, path),
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${rasaUserJwt(configuration, sender)}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body } : {}),
    },
    { maximumBytes, timeoutMs: configuration.timeoutMs },
  );
}

function requirePredictedAction(
  decoded: unknown,
  expectedAction: string,
): void {
  const parsed = predictionSchema.safeParse(decoded);
  const top = parsed.success ? parsed.data.scores[0] : undefined;
  if (!top || top.action !== expectedAction || top.score < 0.5) {
    throw new RuntimeError(
      502,
      "RASA_FLOW_REJECTED",
      "Rasa rejected the structured action",
    );
  }
}

const rasaFlow = {
  "sky.forecast": {
    intent: "ask_sky_forecast",
    utterance: "utter_storefront_sky_forecast",
  },
  "sky.events": {
    intent: "ask_sky_events",
    utterance: "utter_storefront_sky_events",
  },
} as const;

export async function runRasaFlow(
  request: FlowTurnRequest,
  credential: FlowCredential,
  configuration: RasaConfiguration,
): Promise<FlowDecisionResponse> {
  const selected = rasaFlow[request.operation];
  const senderDigest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${credential.botId}\n${request.sessionId}`),
  );
  const sender = `storefront_${Buffer.from(senderDigest).toString("hex")}`;
  const conversationPath = `/conversations/${encodeURIComponent(sender)}`;
  const constantText = `/${selected.intent}`;

  await rasaJson(
    configuration,
    sender,
    `${conversationPath}/messages?include_events=NONE`,
    JSON.stringify({
      sender: "user",
      text: constantText,
      parse_data: {
        text: constantText,
        intent: {
          name: selected.intent,
          confidence: 1,
        },
        entities: [],
      },
    }),
    32 * 1_024,
  );

  const firstPrediction = await rasaJson(
    configuration,
    sender,
    `${conversationPath}/predict`,
    undefined,
    16 * 1_024,
  );
  requirePredictedAction(firstPrediction, selected.utterance);

  const execution = await rasaJson(
    configuration,
    sender,
    `${conversationPath}/execute?include_events=NONE`,
    JSON.stringify({ name: selected.utterance }),
    32 * 1_024,
  );
  const parsedExecution = executedUtteranceSchema.safeParse(execution);
  const directive = parsedExecution.success
    ? parsedExecution.data.messages[0]?.custom
    : undefined;
  if (!directive || directive.capability !== request.operation) {
    throw new RuntimeError(
      502,
      "RASA_FLOW_REJECTED",
      "Rasa returned an invalid structured action",
    );
  }

  const nextPrediction = await rasaJson(
    configuration,
    sender,
    `${conversationPath}/predict`,
    undefined,
    16 * 1_024,
  );
  requirePredictedAction(nextPrediction, "action_listen");
  await rasaJson(
    configuration,
    sender,
    `${conversationPath}/execute?include_events=NONE`,
    JSON.stringify({ name: "action_listen" }),
    32 * 1_024,
  );

  return {
    version: 1,
    turnId: request.turnId,
    decision: {
      type: "execute",
      capability: request.operation,
    },
  };
}
