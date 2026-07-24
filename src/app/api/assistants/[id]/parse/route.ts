import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requireDeployedAssistant } from "@/lib/models";
import {
  parseMessage,
  publicRasaError,
  publicRasaHttpStatus
} from "@/lib/rasa";
import { assertSameOrigin } from "@/lib/security";

const schema = z.object({ text: z.string().trim().min(1).max(10_000) });
type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    await requireDeployedAssistant(id);
    const { text } = schema.parse(await request.json());
    return NextResponse.json({ result: await parseMessage(text) });
  } catch (error) {
    return NextResponse.json(
      publicRasaError(error),
      { status: publicRasaHttpStatus(error) }
    );
  }
}
