import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireDeployedAssistant } from "@/lib/models";
import {
  executeRuntimeMessage,
  RuntimeMessageError
} from "@/lib/runtime-messages";
import { publicRasaError, publicRasaHttpStatus } from "@/lib/rasa";
import { assertSameOrigin } from "@/lib/security";

const schema = z.object({
  sender: z.string().trim().min(8).max(120),
  message: z.string().trim().min(1).max(10_000),
  requestId: z.string().trim().min(16).max(128)
});

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    await requireDeployedAssistant(id);
    const configuredBotId =
      process.env.STOREFRONT_CAPABILITIES_BOT_ID?.trim();
    const capabilityBot = configuredBotId
      ? await db.storeBot.findFirst({
          where: {
            id: configuredBotId,
            assistantId: id,
            enabled: true
          },
          select: { id: true }
        })
      : null;
    const result = await executeRuntimeMessage({
      assistantId: id,
      senderId: input.sender,
      channel: "studio",
      ...(capabilityBot ? { storeBotId: capabilityBot.id } : {}),
      requestId: input.requestId,
      text: input.message,
      metadata: {
        source: "pleiades-rasa-ui",
        assistantId: id
      }
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RuntimeMessageError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    return NextResponse.json(
      publicRasaError(error),
      { status: publicRasaHttpStatus(error) }
    );
  }
}
