import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireDeployedAssistant } from "@/lib/models";
import {
  getTracker,
  publicRasaError,
  publicRasaHttpStatus
} from "@/lib/rasa";

type Context = { params: Promise<{ id: string; sender: string }> };

export async function GET(_request: NextRequest, context: Context) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { id, sender } = await context.params;
    await requireDeployedAssistant(id);
    const conversation = await db.conversation.findUnique({
      where: {
        assistantId_senderId: {
          assistantId: id,
          senderId: sender
        }
      },
      select: { id: true }
    });
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ tracker: await getTracker(sender) });
  } catch (error) {
    return NextResponse.json(
      publicRasaError(error),
      { status: publicRasaHttpStatus(error) }
    );
  }
}
