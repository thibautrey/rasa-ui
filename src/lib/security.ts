import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { NextRequest } from "next/server";
import { getRedisClient } from "@/lib/redis";

const memoryRateLimits = new Map<
  string,
  { count: number; resetAt: number }
>();

const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

export class RateLimitUnavailableError extends Error {
  constructor() {
    super("Rate limiting is unavailable.");
    this.name = "RateLimitUnavailableError";
  }
}

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.");
    this.name = "RequestBodyTooLargeError";
  }
}

export class RequestOriginError extends Error {
  constructor() {
    super("Invalid request origin.");
    this.name = "RequestOriginError";
  }
}

export function storefrontWidgetEnabled() {
  return (
    process.env.STOREFRONT_WIDGET_ENABLED?.trim().toLowerCase() ===
    "true"
  );
}

export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new RequestOriginError();
  }
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const production = process.env.NODE_ENV === "production";
  if (production && !configured) {
    throw new Error("NEXT_PUBLIC_APP_URL is required.");
  }

  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(
      configured ?? request.nextUrl.origin
    ).origin;
  } catch {
    throw new Error("Invalid application origin configuration.");
  }

  let requestOrigin: string;
  try {
    requestOrigin = new URL(origin).origin;
  } catch {
    throw new RequestOriginError();
  }
  if (requestOrigin !== origin || requestOrigin !== expectedOrigin) {
    throw new RequestOriginError();
  }
}

function memoryFallbackEnabled() {
  return (
    ["development", "test"].includes(process.env.NODE_ENV ?? "") &&
    process.env.RATE_LIMIT_MEMORY_FALLBACK === "true"
  );
}

function takeMemoryRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  if (memoryRateLimits.size > 10_000) {
    for (const [storedKey, value] of memoryRateLimits) {
      if (value.resetAt <= now) {
        memoryRateLimits.delete(storedKey);
      }
    }
  }

  const current = memoryRateLimits.get(key);
  if (!current || current.resetAt <= now) {
    memoryRateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    };
  }

  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}

export async function takeRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; retryAfter: number }> {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const normalizedWindow = Math.max(1_000, Math.floor(windowMs));
  const redisKey = `rasa-ui:rate-limit:${createHash("sha256")
    .update(key)
    .digest("base64url")}`;

  try {
    const client = await getRedisClient();
    const result = await client.eval(RATE_LIMIT_SCRIPT, {
      keys: [redisKey],
      arguments: [String(normalizedWindow)]
    });
    if (
      !Array.isArray(result) ||
      result.length !== 2 ||
      typeof result[0] !== "number" ||
      typeof result[1] !== "number"
    ) {
      throw new RateLimitUnavailableError();
    }
    return {
      allowed: result[0] <= normalizedLimit,
      retryAfter:
        result[0] <= normalizedLimit
          ? 0
          : Math.max(1, Math.ceil(result[1] / 1_000))
    };
  } catch {
    if (memoryFallbackEnabled()) {
      return takeMemoryRateLimit(
        redisKey,
        normalizedLimit,
        normalizedWindow
      );
    }
    throw new RateLimitUnavailableError();
  }
}

export function clientIp(request: NextRequest) {
  const value = (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    ""
  ).trim();
  return isIP(value) ? value : "unknown";
}

export async function readBoundedJson(
  request: NextRequest,
  maxBytes: number,
  acceptedContentTypes = ["application/json"]
): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim();
  if (!contentType || !acceptedContentTypes.includes(contentType)) {
    throw new SyntaxError("Unexpected request content type.");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    if (!/^\d+$/.test(contentLength)) {
      throw new SyntaxError("Invalid Content-Length.");
    }
    if (Number(contentLength) > maxBytes) {
      throw new RequestBodyTooLargeError();
    }
  }
  if (!request.body) {
    throw new SyntaxError("Missing request body.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // The size decision is already final even if the stream cannot cancel.
      }
      throw new RequestBodyTooLargeError();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new SyntaxError("Request body is not valid UTF-8.");
  }
  return JSON.parse(decoded) as unknown;
}

export function normalizeOrigins(input: string[]) {
  return [
    ...new Set(
      input
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
          if (value === "*") {
            throw new Error("Wildcard origins are not supported.");
          }
          const url = new URL(value);
          if (!["http:", "https:"].includes(url.protocol)) {
            throw new Error("Only HTTP(S) origins are supported.");
          }
          if (url.hostname.includes("*")) {
            throw new Error("Wildcard origins are not supported.");
          }
          if (url.username || url.password) {
            throw new Error("Origins cannot contain credentials.");
          }
          const applicationUrl = process.env.NEXT_PUBLIC_APP_URL;
          if (
            applicationUrl &&
            new URL(applicationUrl).origin === url.origin
          ) {
            throw new Error(
              "The application origin cannot embed the storefront widget."
            );
          }
          return url.origin;
        })
    )
  ];
}

export function configuredOrigins(input: unknown) {
  if (!Array.isArray(input)) return [];
  try {
    return normalizeOrigins(
      input.filter(
        (origin): origin is string => typeof origin === "string"
      )
    );
  } catch {
    return [];
  }
}

export function isValidWidgetPublicKey(value: string) {
  return /^bot_[A-Za-z0-9_-]{20,80}$/.test(value);
}

export function isAllowedOrigin(
  requestOrigin: string | null,
  allowedOrigins: string[]
) {
  if (!requestOrigin) return false;
  try {
    const origin = new URL(requestOrigin).origin;
    if (origin !== requestOrigin) return false;
    return allowedOrigins.some((allowedOrigin) => {
      if (allowedOrigin === "*") return false;
      try {
        return new URL(allowedOrigin).origin === origin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
