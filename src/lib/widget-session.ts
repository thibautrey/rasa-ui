import "server-only";
import { randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { getRedisClient } from "@/lib/redis";

const SESSION_AUDIENCE = "rasa-storefront-widget";
const SESSION_ISSUER = "rasa-ui";
const SESSION_DURATION_SECONDS = 60 * 60;

type WidgetSessionInput = {
  botId: string;
  publicKey: string;
  origin: string;
};

export type WidgetSession = WidgetSessionInput & {
  senderId: string;
};

export class WidgetSessionInvalidError extends Error {
  constructor() {
    super("Invalid or expired widget session.");
    this.name = "WidgetSessionInvalidError";
  }
}

export class WidgetSessionUnavailableError extends Error {
  constructor() {
    super("Widget sessions are unavailable.");
    this.name = "WidgetSessionUnavailableError";
  }
}

function secret() {
  const value = process.env.WIDGET_SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "WIDGET_SESSION_SECRET must contain at least 32 characters."
    );
  }
  return new TextEncoder().encode(value);
}

export async function createWidgetSession(input: WidgetSessionInput) {
  const senderId = randomBytes(24).toString("base64url");
  const sessionId = randomBytes(16).toString("base64url");
  const token = await new SignJWT({
    botId: input.botId,
    publicKey: input.publicKey,
    origin: input.origin
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setSubject(senderId)
    .setJti(sessionId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(secret());

  try {
    const client = await getRedisClient();
    const stored = await client.set(
      `rasa-ui:widget-session:${sessionId}`,
      JSON.stringify({
        ...input,
        senderId
      }),
      {
        EX: SESSION_DURATION_SECONDS,
        NX: true
      }
    );
    if (stored !== "OK") {
      throw new WidgetSessionUnavailableError();
    }
  } catch {
    throw new WidgetSessionUnavailableError();
  }

  return {
    token,
    expiresIn: SESSION_DURATION_SECONDS
  };
}

export async function verifyWidgetSession(
  token: string,
  expected: { botId: string; publicKey: string }
): Promise<WidgetSession> {
  let signingSecret: Uint8Array;
  try {
    signingSecret = secret();
  } catch {
    throw new WidgetSessionUnavailableError();
  }

  async function verifiedToken() {
    return jwtVerify(token, signingSecret, {
      algorithms: ["HS256"],
      audience: SESSION_AUDIENCE,
      issuer: SESSION_ISSUER
    });
  }

  let verified: Awaited<ReturnType<typeof verifiedToken>>;
  try {
    verified = await verifiedToken();
  } catch {
    throw new WidgetSessionInvalidError();
  }
  const { payload, protectedHeader } = verified;
  if (
    protectedHeader.typ !== "JWT" ||
    !payload.sub ||
    !payload.jti ||
    payload.botId !== expected.botId ||
    payload.publicKey !== expected.publicKey ||
    typeof payload.origin !== "string"
  ) {
    throw new WidgetSessionInvalidError();
  }

  let origin: string;
  try {
    origin = new URL(payload.origin).origin;
  } catch {
    throw new WidgetSessionInvalidError();
  }
  if (origin !== payload.origin) {
    throw new WidgetSessionInvalidError();
  }

  let storedValue: string | null;
  try {
    const client = await getRedisClient();
    storedValue = await client.get(
      `rasa-ui:widget-session:${payload.jti}`
    );
  } catch {
    throw new WidgetSessionUnavailableError();
  }
  let stored: unknown;
  try {
    stored = storedValue
      ? (JSON.parse(storedValue) as unknown)
      : null;
  } catch {
    throw new WidgetSessionInvalidError();
  }
  if (
    !stored ||
    typeof stored !== "object" ||
    Array.isArray(stored)
  ) {
    throw new WidgetSessionInvalidError();
  }
  const record = stored as Record<string, unknown>;
  if (
    record.botId !== expected.botId ||
    record.publicKey !== expected.publicKey ||
    record.origin !== origin ||
    record.senderId !== payload.sub
  ) {
    throw new WidgetSessionInvalidError();
  }

  return {
    botId: expected.botId,
    publicKey: expected.publicKey,
    origin,
    senderId: payload.sub
  };
}
