import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
}
