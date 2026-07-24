import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getRasaOverview } from "@/lib/rasa";

export async function GET() {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await getRasaOverview());
}
