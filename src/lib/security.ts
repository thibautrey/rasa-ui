import { NextRequest } from "next/server";

const rateLimits = new Map<string, { count: number; resetAt: number }>();

export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const forwardedHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const candidates = new Set([
    request.nextUrl.origin,
    configured,
    forwardedHost ? `${forwardedProto}://${forwardedHost}` : undefined
  ]);

  if (![...candidates].filter(Boolean).includes(origin)) {
    throw new Error("Invalid request origin.");
  }
}

export function takeRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
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

export function clientIp(request: NextRequest) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export function normalizeOrigins(input: string[]) {
  return [
    ...new Set(
      input
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
          const url = new URL(value);
          if (!["http:", "https:"].includes(url.protocol)) {
            throw new Error("Only HTTP(S) origins are supported.");
          }
          return url.origin;
        })
    )
  ];
}

export function isAllowedOrigin(
  requestOrigin: string | null,
  allowedOrigins: string[]
) {
  if (allowedOrigins.includes("*")) return true;
  if (!requestOrigin) return false;
  try {
    return allowedOrigins.includes(new URL(requestOrigin).origin);
  } catch {
    return false;
  }
}
