import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { storefrontWidgetEnabled } from "@/lib/security";
import packageJson from "../../../../package.json";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      service: "pleiades-rasa-ui",
      release: packageJson.version,
      storefrontWidgetEnabled: storefrontWidgetEnabled()
    });
  } catch {
    return NextResponse.json(
      {
        status: "error",
        service: "pleiades-rasa-ui",
        release: packageJson.version,
        storefrontWidgetEnabled: storefrontWidgetEnabled()
      },
      { status: 503 }
    );
  }
}
