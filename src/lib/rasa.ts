import { createHash } from "node:crypto";
import { buildTrainingYaml } from "@/lib/assistant-documents";

export type RasaDocuments = Parameters<typeof buildTrainingYaml>[0];

export type RasaStatus = {
  model_file?: string | null;
  model_id?: string | null;
  num_active_training_jobs?: number;
};

export type RasaParseResult = {
  intent?: {
    name?: string;
    confidence?: number;
  };
  [key: string]: unknown;
};

export type RasaReply = {
  recipient_id?: string;
  text?: string;
  image?: string;
  buttons?: Array<{ title: string; payload: string }>;
  custom?: unknown;
};

type RasaRequestOptions = {
  timeoutMs?: number;
};

export class RasaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
    public readonly code = "RASA_API_ERROR"
  ) {
    super(message);
    this.name = "RasaApiError";
  }
}

function rasaUrl(path: string) {
  const base = process.env.RASA_BASE_URL?.replace(/\/+$/, "");
  if (!base) throw new Error("RASA_BASE_URL is not configured.");
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  const token = process.env.RASA_API_TOKEN;
  if (token) url.searchParams.set("token", token);
  return url;
}

async function rasaFetch(
  path: string,
  init?: RequestInit,
  options: RasaRequestOptions = {}
) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  let response: Response;
  try {
    response = await fetch(rasaUrl(path), {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new RasaApiError(
        `Rasa did not answer within ${Math.round(timeoutMs / 1000)} seconds.`,
        504,
        undefined,
        "RASA_TIMEOUT"
      );
    }
    throw new RasaApiError(
      "Rasa is unreachable.",
      503,
      error instanceof Error ? error.message : undefined,
      "RASA_UNREACHABLE"
    );
  }

  if (!response.ok) {
    const body = await response.text();
    let details: unknown = body;
    try {
      details = JSON.parse(body);
    } catch {
      // Keep the plain-text response.
    }
    throw new RasaApiError(
      `Rasa returned HTTP ${response.status}.`,
      response.status,
      details
    );
  }
  return response;
}

export function publicRasaError(error: unknown) {
  if (error instanceof RasaApiError) {
    return {
      error: error.message,
      code: error.code,
      rasaStatus: error.status,
      details:
        typeof error.details === "string"
          ? error.details.slice(0, 2_000)
          : error.details
    };
  }
  return {
    error: error instanceof Error ? error.message : "Rasa request failed.",
    code: "RASA_REQUEST_FAILED"
  };
}

export function publicRasaHttpStatus(error: unknown) {
  if (!(error instanceof RasaApiError)) return 500;
  if (error.code === "RASA_TIMEOUT") return 504;
  if (error.code === "RASA_UNREACHABLE") return 503;
  if (error.status === 400 || error.status === 409 || error.status === 422) {
    return error.status;
  }
  return 502;
}

export async function getRasaStatus(timeoutMs?: number) {
  const response = await rasaFetch("/status", undefined, { timeoutMs });
  return response.json() as Promise<RasaStatus>;
}

export async function getRasaOverview() {
  const timeoutMs = 10_000;
  const [root, version, status] = await Promise.allSettled([
    rasaFetch("/", undefined, { timeoutMs }).then((response) => response.text()),
    rasaFetch("/version", undefined, { timeoutMs }).then((response) =>
      response.json()
    ),
    getRasaStatus(timeoutMs)
  ]);

  const reachable = root.status === "fulfilled";
  const authenticated = status.status === "fulfilled";
  const statusValue = authenticated ? status.value : null;
  const ready = authenticated && Boolean(statusValue?.model_file);
  const rejected =
    status.status === "rejected"
      ? status.reason
      : version.status === "rejected"
        ? version.reason
        : root.status === "rejected"
          ? root.reason
          : null;

  return {
    connected: authenticated,
    reachable,
    authenticated,
    ready,
    root: reachable ? root.value : null,
    version: version.status === "fulfilled" ? version.value : null,
    status: statusValue,
    error:
      rejected instanceof Error
        ? rejected.message
        : rejected
          ? "Rasa is unavailable."
          : null
  };
}

export async function parseMessage(text: string) {
  const response = await rasaFetch("/model/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  return response.json() as Promise<RasaParseResult>;
}

export async function sendRestMessage(
  sender: string,
  message: string,
  metadata?: Record<string, unknown>
) {
  const response = await rasaFetch("/webhooks/rest/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender, message, metadata })
  });
  return response.json() as Promise<RasaReply[]>;
}

export async function getTracker(sender: string) {
  const response = await rasaFetch(
    `/conversations/${encodeURIComponent(sender)}/tracker?include_events=APPLIED`
  );
  return response.json();
}

export async function getLoadedDomain() {
  const response = await rasaFetch("/domain", {
    headers: { Accept: "application/json" }
  });
  return response.json();
}

function modelFilename(response: Response) {
  const direct = response.headers.get("filename");
  if (direct) return direct.replaceAll('"', "");
  const disposition = response.headers.get("content-disposition");
  return disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
}

function safeFilename(filename: string | null) {
  const value = filename?.split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]/g, "_");
  return value && value.endsWith(".tar.gz")
    ? value
    : `rasa-model-${Date.now()}.tar.gz`;
}

export async function trainRasaModel(documents: RasaDocuments) {
  return trainRasaYaml(buildTrainingYaml(documents));
}

export async function trainRasaYaml(yaml: string) {
  const timeoutMs = Number(process.env.RASA_TRAINING_TIMEOUT_MS ?? 1_800_000);
  const response = await rasaFetch(
    "/model/train?save_to_default_model_directory=true&force_training=true",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/yaml",
        Accept: "application/octet-stream"
      },
      body: yaml
    },
    { timeoutMs }
  );

  const archive = Buffer.from(await response.arrayBuffer());
  if (!archive.length) {
    throw new RasaApiError(
      "Rasa returned an empty model archive.",
      502,
      undefined,
      "EMPTY_MODEL_ARCHIVE"
    );
  }
  return {
    filename: safeFilename(modelFilename(response)),
    archive,
    sha256: createHash("sha256").update(archive).digest("hex")
  };
}

function modelDownloadSettings(artifactId: string) {
  const base = (
    process.env.INTERNAL_MODEL_SERVER_URL ?? process.env.NEXT_PUBLIC_APP_URL
  )?.replace(/\/+$/, "");
  const token = process.env.MODEL_DOWNLOAD_TOKEN;
  if (!base) {
    throw new Error(
      "INTERNAL_MODEL_SERVER_URL or NEXT_PUBLIC_APP_URL is required."
    );
  }
  if (!token || token.length < 32) {
    throw new Error("MODEL_DOWNLOAD_TOKEN must contain at least 32 characters.");
  }
  return {
    url: `${base}/api/internal/models/${encodeURIComponent(artifactId)}/archive`,
    headers: { Authorization: `Bearer ${token}` },
    wait_time_between_pulls: 0
  };
}

export async function activateRasaArtifact(artifactId: string) {
  await rasaFetch(
    "/model",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model_server: modelDownloadSettings(artifactId)
      })
    },
    { timeoutMs: 360_000 }
  );

  const status = await getRasaStatus();
  if (!status.model_file) {
    throw new RasaApiError(
      "Rasa accepted the model but did not report a loaded model.",
      502,
      status,
      "MODEL_NOT_READY"
    );
  }
  return status;
}
