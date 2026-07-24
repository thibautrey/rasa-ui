import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { createClient } from "redis";
import { z } from "zod";

import type { FlowCredential } from "./contracts.js";

const SIGNATURE_VERSION = "v1";
const MAX_CLOCK_SKEW_SECONDS = 120;
const NONCE_TTL_SECONDS = MAX_CLOCK_SKEW_SECONDS * 2 + 60;
const SESSION_TTL_SECONDS = 30 * 60;
const REQUEST_REPLAY_TTL_SECONDS = 10 * 60;
const FAKE_SECRET =
  "unknown-flow-credential-timing-padding-000000000000000000000000";

const quotaScript = `
for index, key in ipairs(KEYS) do
  local current = redis.call("INCR", key)
  if current == 1 then
    redis.call("EXPIRE", key, ARGV[1])
  end
  if current > tonumber(ARGV[index + 1]) then
    return 0
  end
end
return 1
`;

const turnBudgetScript = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  return -1
end
for index = 2, #KEYS do
  local current = redis.call("INCR", KEYS[index])
  if current == 1 then
    redis.call("EXPIRE", KEYS[index], ARGV[1])
  end
  if current > tonumber(ARGV[index + 1]) then
    return 0
  end
end
local stored = redis.call("SET", KEYS[1], "1", "EX", ARGV[2], "NX")
if not stored then
  return -1
end
return 1
`;

const authorizationBudgetScript = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  return -1
end
local current = redis.call("INCR", KEYS[2])
if current == 1 then
  redis.call("EXPIRE", KEYS[2], ARGV[1])
end
if current > tonumber(ARGV[2]) then
  return 0
end
local stored = redis.call("SET", KEYS[1], "1", "EX", ARGV[3], "NX")
if not stored then
  return -1
end
return 1
`;

const releaseLeaseScript = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

const sessionRecordSchema = z
  .object({
    version: z.literal(1),
    sessionId: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/),
    botKey: z.string().min(24).max(84),
    parentOrigin: z.string().min(8).max(256),
  })
  .strict();

export type SessionRecord = z.infer<typeof sessionRecordSchema>;
export type RuntimeRedisClient = ReturnType<typeof createClient>;

export type HmacHeaders = {
  keyId: string;
  nonce: string;
  signature: string;
  timestamp: string;
};

const RUNTIME_REDIS_SOCKET_PATH = "/run/runtime-redis/redis.sock";
export const RUNTIME_PUBLIC_REDIS_PASSWORD_PATH =
  "/run/secrets/runtime-public-redis-password";
export const RUNTIME_BROKER_REDIS_PASSWORD_PATH =
  "/run/secrets/runtime-broker-redis-password";

export class RuntimeError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

export function environmentFlag(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === "true";
}

export function requiredEnvironment(
  name: string,
  minimumLength = 1,
  maximumLength = 2_048,
): string {
  const value = process.env[name];
  if (
    !value ||
    value.length < minimumLength ||
    value.length > maximumLength
  ) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export function requiredSecretFile(
  path: string,
  minimumLength = 1,
  maximumLength = 2_048,
): string {
  let size: number;
  try {
    const metadata = statSync(path, { throwIfNoEntry: true });
    if (!metadata.isFile()) throw new Error("Not a regular file");
    size = metadata.size;
  } catch {
    throw new Error("Required secret file is not configured");
  }
  if (size < minimumLength || size > maximumLength + 2) {
    throw new Error("Required secret file is not configured");
  }
  let value: string;
  try {
    value = readFileSync(path, "utf8").replace(/\r?\n$/u, "");
  } catch {
    throw new Error("Required secret file is not configured");
  }
  if (
    value.length < minimumLength ||
    value.length > maximumLength ||
    value.includes("\u0000")
  ) {
    throw new Error("Required secret file is not configured");
  }
  return value;
}

export function boundedIntegerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^[0-9]+$/u.test(raw)) {
    throw new Error(`${name} is invalid`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

export function createRuntimeRedis(
  role: string,
  username: "runtime_public" | "runtime_broker",
): RuntimeRedisClient {
  const passwordPath =
    username === "runtime_public"
      ? RUNTIME_PUBLIC_REDIS_PASSWORD_PATH
      : RUNTIME_BROKER_REDIS_PASSWORD_PATH;
  const password = requiredSecretFile(passwordPath, 32, 128);
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(password)) {
    throw new Error("Redis credential file is invalid");
  }
  const client = createClient({
    disableOfflineQueue: true,
    password,
    username,
    socket: {
      path: RUNTIME_REDIS_SOCKET_PATH,
      connectTimeout: 3_000,
      reconnectStrategy: (retries) =>
        Math.min(100 * 2 ** Math.min(retries, 5), 3_000),
    },
  });
  client.on("error", (error: Error) => {
    console.error(`[${role}] Redis connection error`, {
      errorType: error.name,
    });
  });
  return client;
}

export async function pingRedis(
  redis: RuntimeRedisClient,
): Promise<boolean> {
  if (!redis.isReady) return false;
  let timeout: NodeJS.Timeout | undefined;
  try {
    const outcome = await Promise.race([
      redis.ping(),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), 1_000);
      }),
    ]);
    return outcome === "PONG";
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function singleHeader(
  headers: IncomingHttpHeaders,
  name: string,
): string {
  const value = headers[name.toLowerCase()];
  return typeof value === "string" ? value.trim() : "";
}

export function hmacHeaders(
  headers: IncomingHttpHeaders,
  prefix: "x-storefront-flow" | "x-storefront-assistant",
): HmacHeaders {
  return {
    keyId: singleHeader(headers, `${prefix}-key-id`),
    timestamp: singleHeader(headers, `${prefix}-timestamp`),
    nonce: singleHeader(headers, `${prefix}-nonce`),
    signature: singleHeader(headers, `${prefix}-signature`),
  };
}

export function signedHeaders(
  body: string,
  keyId: string,
  secret: string,
  path: string,
  prefix: "x-storefront-flow" | "x-storefront-assistant",
): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const nonce = randomBytes(24).toString("base64url");
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  const signature = createHmac("sha256", secret)
    .update(
      [
        SIGNATURE_VERSION,
        keyId,
        "POST",
        path,
        timestamp,
        nonce,
        bodyHash,
      ].join("\n"),
      "utf8",
    )
    .digest("hex");
  return {
    [`${prefix}-key-id`]: keyId,
    [`${prefix}-timestamp`]: timestamp,
    [`${prefix}-nonce`]: nonce,
    [`${prefix}-signature`]: signature,
  };
}

function validTimestamp(timestamp: string): boolean {
  if (!/^[0-9]{10,13}$/u.test(timestamp)) return false;
  const numeric = Number(timestamp);
  if (!Number.isSafeInteger(numeric)) return false;
  const seconds = timestamp.length === 13 ? Math.floor(numeric / 1_000) : numeric;
  return (
    Math.abs(Math.floor(Date.now() / 1_000) - seconds) <=
    MAX_CLOCK_SKEW_SECONDS
  );
}

function validHmacHeaders(headers: HmacHeaders): boolean {
  return (
    /^[A-Za-z0-9._-]{8,80}$/u.test(headers.keyId) &&
    /^[A-Za-z0-9_-]{16,96}$/u.test(headers.nonce) &&
    /^[a-f0-9]{64}$/iu.test(headers.signature) &&
    validTimestamp(headers.timestamp)
  );
}

function signaturePayload(
  body: Buffer,
  headers: HmacHeaders,
  path: string,
): string {
  return [
    SIGNATURE_VERSION,
    headers.keyId,
    "POST",
    path,
    headers.timestamp,
    headers.nonce,
    createHash("sha256").update(body).digest("hex"),
  ].join("\n");
}

export async function authenticateFlowRequest(input: {
  body: Buffer;
  credentials: ReadonlyMap<string, FlowCredential>;
  headers: HmacHeaders;
  path: string;
  rateLimitPerMinute: number;
  redis: RuntimeRedisClient;
}): Promise<FlowCredential> {
  const credential = input.credentials.get(input.headers.keyId);
  const expected = createHmac(
    "sha256",
    credential?.secret ?? FAKE_SECRET,
  )
    .update(signaturePayload(input.body, input.headers, input.path), "utf8")
    .digest();
  const provided = Buffer.from(input.headers.signature, "hex");
  const matches =
    expected.length === provided.length && timingSafeEqual(expected, provided);
  if (!credential || !matches || !validHmacHeaders(input.headers)) {
    throw new RuntimeError(401, "UNAUTHORIZED", "Unauthorized");
  }

  const credentialScope = digestKey(
    `${credential.keyId}\n${credential.botId}`,
  );
  const nonceScope = digestKey(`${credential.keyId}\n${input.headers.nonce}`);
  const minuteBucket = Math.floor(Date.now() / 60_000);
  try {
    const result = await input.redis.eval(authorizationBudgetScript, {
      keys: [
        `runtime:flow:nonce:${nonceScope}`,
        `runtime:flow:rate:${credentialScope}:${minuteBucket}`,
      ],
      arguments: [
        "90",
        String(input.rateLimitPerMinute),
        String(NONCE_TTL_SECONDS),
      ],
    });
    if (result === -1) {
      throw new RuntimeError(401, "UNAUTHORIZED", "Unauthorized");
    }
    if (result !== 1) {
      throw new RuntimeError(429, "RATE_LIMITED", "Request rate exceeded");
    }
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    throw new RuntimeError(
      503,
      "DEPENDENCY_UNAVAILABLE",
      "Dependency unavailable",
    );
  }
  return credential;
}

export async function readRequestBody(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<Buffer> {
  if (singleHeader(request.headers, "transfer-encoding")) {
    request.resume();
    throw new RuntimeError(413, "PAYLOAD_TOO_LARGE", "Payload too large");
  }
  const contentLength = singleHeader(request.headers, "content-length");
  if (contentLength) {
    if (!/^[0-9]+$/u.test(contentLength)) {
      request.resume();
      throw new RuntimeError(400, "INVALID_REQUEST", "Invalid request");
    }
    if (Number(contentLength) > maximumBytes) {
      request.resume();
      throw new RuntimeError(413, "PAYLOAD_TOO_LARGE", "Payload too large");
    }
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk)
      ? rawChunk
      : Buffer.from(rawChunk as Uint8Array);
    size += chunk.byteLength;
    if (size > maximumBytes) {
      throw new RuntimeError(413, "PAYLOAD_TOO_LARGE", "Payload too large");
    }
    chunks.push(chunk);
  }
  if (contentLength && size !== Number(contentLength)) {
    throw new RuntimeError(400, "INVALID_REQUEST", "Invalid request");
  }
  return Buffer.concat(chunks, size);
}

export function parseJsonBody(body: Buffer): unknown {
  if (body.length === 0) {
    throw new RuntimeError(400, "INVALID_REQUEST", "Invalid JSON request");
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    ) as unknown;
  } catch {
    throw new RuntimeError(400, "INVALID_REQUEST", "Invalid JSON request");
  }
}

export function requireJsonContentType(headers: IncomingHttpHeaders): void {
  const mediaType = singleHeader(headers, "content-type")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new RuntimeError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Expected application/json",
    );
  }
}

function digestKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function minuteKey(scope: string): string {
  return `${digestKey(scope)}:${Math.floor(Date.now() / 60_000)}`;
}

export async function consumeQuotas(
  redis: RuntimeRedisClient,
  quotas: ReadonlyArray<{ limit: number; scope: string }>,
): Promise<void> {
  try {
    const result = await redis.eval(quotaScript, {
      keys: quotas.map(
        (quota) => `runtime:quota:${minuteKey(quota.scope)}`,
      ),
      arguments: ["90", ...quotas.map((quota) => String(quota.limit))],
    });
    if (result !== 1) {
      throw new RuntimeError(429, "RATE_LIMITED", "Request rate exceeded");
    }
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    throw new RuntimeError(
      503,
      "DEPENDENCY_UNAVAILABLE",
      "Dependency unavailable",
    );
  }
}

function sessionKey(token: string): string {
  return `runtime:session:${digestKey(token)}`;
}

export async function createSession(
  redis: RuntimeRedisClient,
  botKey: string,
  parentOrigin: string,
): Promise<{ record: SessionRecord; token: string }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomBytes(32).toString("base64url");
    const record: SessionRecord = {
      version: 1,
      sessionId: randomBytes(32).toString("base64url"),
      botKey,
      parentOrigin,
    };
    try {
      const stored = await redis.set(sessionKey(token), JSON.stringify(record), {
        EX: SESSION_TTL_SECONDS,
        NX: true,
      });
      if (stored === "OK") return { record, token };
    } catch {
      throw new RuntimeError(
        503,
        "DEPENDENCY_UNAVAILABLE",
        "Dependency unavailable",
      );
    }
  }
  throw new RuntimeError(
    503,
    "DEPENDENCY_UNAVAILABLE",
    "Dependency unavailable",
  );
}

export async function readSession(
  redis: RuntimeRedisClient,
  token: string,
): Promise<SessionRecord> {
  let raw: string | null;
  try {
    raw = await redis.get(sessionKey(token));
  } catch {
    throw new RuntimeError(
      503,
      "DEPENDENCY_UNAVAILABLE",
      "Dependency unavailable",
    );
  }
  if (!raw) {
    throw new RuntimeError(401, "SESSION_EXPIRED", "Session expired");
  }
  try {
    const parsed = sessionRecordSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) throw new Error("Invalid session");
    return parsed.data;
  } catch {
    throw new RuntimeError(401, "SESSION_EXPIRED", "Session expired");
  }
}

export async function consumeTurnBudget(
  redis: RuntimeRedisClient,
  session: SessionRecord,
  requestId: string,
): Promise<void> {
  const bucket = Math.floor(Date.now() / 60_000);
  const requestScope = digestKey(`${session.sessionId}\n${requestId}`);
  try {
    const result = await redis.eval(turnBudgetScript, {
      keys: [
        `runtime:request:${requestScope}`,
        `runtime:turn:global:${bucket}`,
        `runtime:turn:bot:${digestKey(session.botKey)}:${bucket}`,
        `runtime:turn:session:${digestKey(session.sessionId)}:${bucket}`,
      ],
      arguments: [
        "90",
        String(REQUEST_REPLAY_TTL_SECONDS),
        "600",
        "120",
        "20",
      ],
    });
    if (result === -1) {
      throw new RuntimeError(409, "REQUEST_REPLAYED", "Duplicate request");
    }
    if (result !== 1) {
      throw new RuntimeError(429, "RATE_LIMITED", "Request rate exceeded");
    }
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    throw new RuntimeError(
      503,
      "DEPENDENCY_UNAVAILABLE",
      "Dependency unavailable",
    );
  }
}

export async function acquireSessionLease(
  redis: RuntimeRedisClient,
  sessionId: string,
): Promise<{ key: string; value: string }> {
  const key = `runtime:lease:${digestKey(sessionId)}`;
  const value = randomBytes(24).toString("base64url");
  try {
    const acquired = await redis.set(key, value, { EX: 30, NX: true });
    if (acquired !== "OK") {
      throw new RuntimeError(
        429,
        "SESSION_BUSY",
        "A request is already in progress",
      );
    }
    return { key, value };
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    throw new RuntimeError(
      503,
      "DEPENDENCY_UNAVAILABLE",
      "Dependency unavailable",
    );
  }
}

export async function releaseSessionLease(
  redis: RuntimeRedisClient,
  lease: { key: string; value: string },
): Promise<void> {
  try {
    await redis.eval(releaseLeaseScript, {
      keys: [lease.key],
      arguments: [lease.value],
    });
  } catch {
    // The lease has a short TTL. Do not turn a completed response into a failure.
  }
}
