import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

function authorized(request: NextRequest) {
  const expected = process.env.MODEL_DOWNLOAD_TOKEN;
  const header = request.headers.get("authorization");
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!expected || expected.length < 32 || !provided) return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const metadata = await db.modelArtifact.findFirst({
    where: { active: true },
    orderBy: { activatedAt: "desc" },
    select: {
      id: true,
      filename: true,
      sha256: true,
      sizeBytes: true
    }
  });
  if (!metadata) return new NextResponse("Not found", { status: 404 });

  const etag = `"${metadata.sha256}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag }
    });
  }

  const artifact = await db.modelArtifact.findUnique({
    where: { id: metadata.id },
    select: {
      active: true,
      filename: true,
      sha256: true,
      archive: true
    }
  });
  if (
    !artifact ||
    !artifact.active ||
    artifact.filename !== metadata.filename ||
    artifact.sha256 !== metadata.sha256 ||
    BigInt(artifact.archive.length) !== metadata.sizeBytes
  ) {
    return new NextResponse("Model unavailable", {
      status: 503,
      headers: { "Cache-Control": "private, no-store" }
    });
  }

  return new NextResponse(new Uint8Array(artifact.archive), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(artifact.archive.length),
      "Cache-Control": "private, no-store",
      ETag: etag,
      filename: artifact.filename
    }
  });
}
