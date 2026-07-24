import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  assertSameOrigin,
  clientIp,
  RateLimitUnavailableError,
  readBoundedJson,
  RequestBodyTooLargeError,
  takeRateLimit
} from "@/lib/security";

const credentialsSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(200)
});

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const rateLimit = await takeRateLimit(
      `login:${clientIp(request)}`,
      10,
      15 * 60 * 1000
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Trop de tentatives. Réessayez plus tard." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfter) }
        }
      );
    }

    const credentials = credentialsSchema.parse(
      await readBoundedJson(request, 2_048)
    );
    const user = await db.user.findUnique({
      where: { email: credentials.email }
    });
    const valid =
      user &&
      (await bcrypt.compare(credentials.password, user.passwordHash));

    if (!user || !user.isActive || !valid) {
      return NextResponse.json(
        { error: "Identifiants incorrects." },
        { status: 401 }
      );
    }

    await createSession({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    });
    await db.auditLog.create({
      data: {
        actorId: user.id,
        action: "auth.login",
        entityType: "user",
        entityId: user.id
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) {
      return NextResponse.json(
        { error: "Service temporairement indisponible." },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: "Requête trop volumineuse." },
        { status: 413 }
      );
    }
    return NextResponse.json(
      { error: "La connexion a échoué." },
      { status: 400 }
    );
  }
}
