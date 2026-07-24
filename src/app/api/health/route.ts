import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      service: "pleiades-rasa-ui"
    });
  } catch {
    return NextResponse.json(
      { status: "error", service: "pleiades-rasa-ui" },
      { status: 503 }
    );
  }
}
