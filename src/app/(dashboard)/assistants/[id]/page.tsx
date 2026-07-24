import { notFound } from "next/navigation";
import { AssistantWorkspace } from "@/components/assistant-workspace";
import { canEdit, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const assistant = await db.assistant.findUnique({
    where: { id },
    select: { name: true }
  });
  return { title: assistant?.name ?? "Assistant" };
}

export default async function AssistantPage({ params }: Props) {
  const user = await requireUser();
  const { id } = await params;
  const assistant = await db.assistant.findUnique({
    where: { id },
    include: {
      trainingRuns: { orderBy: { createdAt: "desc" }, take: 20 }
    }
  });
  if (!assistant) notFound();

  const payload = {
    ...assistant,
    createdAt: assistant.createdAt.toISOString(),
    updatedAt: assistant.updatedAt.toISOString(),
    trainingRuns: assistant.trainingRuns.map((run) => ({
      ...run,
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null
    }))
  };

  return (
    <AssistantWorkspace editable={canEdit(user)} initialAssistant={payload} />
  );
}
