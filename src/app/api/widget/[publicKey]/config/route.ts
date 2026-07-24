import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAllowedOrigin } from "@/lib/security";

type Context = { params: Promise<{ publicKey: string }> };

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "null",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin"
  };
}

export async function OPTIONS(request: NextRequest, context: Context) {
  const origin = request.headers.get("origin");
  const { publicKey } = await context.params;
  const bot = await db.storeBot.findUnique({
    where: { publicKey },
    select: { enabled: true, allowedOrigins: true }
  });
  if (!bot || !bot.enabled) {
    return new NextResponse(null, {
      status: 404,
      headers: { Vary: "Origin" }
    });
  }
  if (!isAllowedOrigin(origin, bot.allowedOrigins as string[])) {
    return new NextResponse(null, {
      status: 403,
      headers: { Vary: "Origin" }
    });
  }
  return new NextResponse(null, { status: 204, headers: cors(origin) });
}

export async function GET(request: NextRequest, context: Context) {
  const { publicKey } = await context.params;
  const bot = await db.storeBot.findUnique({
    where: { publicKey },
    include: { assistant: { select: { name: true } } }
  });
  if (!bot || !bot.enabled) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const origin = request.headers.get("origin");
  const allowedOrigins = bot.allowedOrigins as string[];
  if (!isAllowedOrigin(origin, allowedOrigins)) {
    return NextResponse.json(
      { error: "Origin not allowed" },
      { status: 403, headers: { Vary: "Origin" } }
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
}
