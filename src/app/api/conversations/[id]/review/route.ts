import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canEdit, getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security";

const schema = z.object({
  rating: z.number().int().min(1).max(5)
});

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const user = await getSession();
  if (!user || !canEdit(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const { rating } = schema.parse(await request.json());
    const current = await db.conversation.findUnique({
      where: { id },
      select: {
        id: true,
        rating: true,
        reviewedAt: true
      }
    });
    if (!current) {
      return NextResponse.json(
        { error: "Conversation not found." },
        { status: 404 }
      );
    }

    const reviewedAt = new Date();
    const conversation = await db.$transaction(async (tx) => {
      const updated = await tx.conversation.update({
        where: { id },
        data: { rating, reviewedAt },
        select: {
          id: true,
          rating: true,
          reviewedAt: true
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "conversation.review",
          entityType: "conversation",
          entityId: id,
          metadata: {
            rating,
            reviewedAt: reviewedAt.toISOString(),
            previousRating: current.rating,
            previousReviewedAt: current.reviewedAt?.toISOString() ?? null
          }
        }
      });
      return updated;
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to review conversation."
      },
      { status: 400 }
    );
  }
}
