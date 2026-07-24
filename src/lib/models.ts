import "server-only";
import { db } from "@/lib/db";
import { activateRasaArtifact, RasaApiError } from "@/lib/rasa";

export async function activateModelArtifact(
  artifactId: string,
  actorId?: string
) {
  const artifact = await db.modelArtifact.findUnique({
    where: { id: artifactId },
    select: {
      id: true,
      assistantId: true,
      filename: true,
      sha256: true
    }
  });
  if (!artifact) throw new Error("Model artifact not found.");

  const status = await activateRasaArtifact(artifact.id);
  const activatedAt = new Date();

  await db.$transaction(async (tx) => {
    await tx.modelArtifact.updateMany({
      where: { active: true },
      data: { active: false }
    });
    await tx.assistant.updateMany({
      where: { activeModel: { not: null } },
      data: { activeModel: null }
    });
    await tx.modelArtifact.update({
      where: { id: artifact.id },
      data: {
        active: true,
        activatedAt,
        rasaModelId: status.model_id ?? null,
        rasaModelFile: status.model_file ?? null
      }
    });
    await tx.assistant.update({
      where: { id: artifact.assistantId },
      data: { activeModel: artifact.filename }
    });
    if (actorId) {
      await tx.auditLog.create({
        data: {
          actorId,
          action: "model.activate",
          entityType: "model_artifact",
          entityId: artifact.id,
          metadata: {
            assistantId: artifact.assistantId,
            filename: artifact.filename,
            sha256: artifact.sha256,
            rasaModelId: status.model_id ?? null
          }
        }
      });
    }
  });

  return { artifact, status, activatedAt };
}

export async function requireDeployedAssistant(assistantId: string) {
  const active = await db.modelArtifact.findFirst({
    where: { assistantId, active: true },
    select: { id: true, filename: true }
  });
  if (!active) {
    throw new RasaApiError(
      "Cet assistant n’est pas le modèle actuellement déployé sur Rasa.",
      409,
      undefined,
      "ASSISTANT_NOT_DEPLOYED"
    );
  }
  return active;
}
