import { NextRequest, NextResponse } from "next/server";
import { canEdit, getSession } from "@/lib/auth";
import { activateModelArtifact } from "@/lib/models";
import {
  publicRasaError,
  publicRasaHttpStatus
} from "@/lib/rasa";
import { assertSameOrigin } from "@/lib/security";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const user = await getSession();
  if (!user || !canEdit(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const result = await activateModelArtifact(id, user.id);
    return NextResponse.json({
      ok: true,
      activeModel: result.status.model_file,
      modelId: result.status.model_id
    });
  } catch (error) {
    return NextResponse.json(publicRasaError(error), {
      status: publicRasaHttpStatus(error)
    });
  }
}
