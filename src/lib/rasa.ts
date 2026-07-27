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
  maxResponseBytes?: number;
};

const DEFAULT_JSON_RESPONSE_BYTES = 512 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 16 * 1024;
const MODEL_ACTIVATION_TIMEOUT_MS = 30_000;
const MODEL_ACTIVATION_POLL_INTERVAL_MS = 500;
const MODEL_STATUS_REQUEST_TIMEOUT_MS = 5_000;

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

async function readBoundedText(response: Response, maxBytes: number) {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > maxBytes
  ) {
    await response.body?.cancel();
    throw new RasaApiError(
      "Rasa returned an oversized response.",
      502,
      undefined,
      "RASA_RESPONSE_TOO_LARGE"
    );
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new RasaApiError(
        "Rasa returned an oversized response.",
        502,
        undefined,
        "RASA_RESPONSE_TOO_LARGE"
      );
    }
    chunks.push(chunk.value);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
    );
  } catch {
    throw new RasaApiError(
      "Rasa returned invalid UTF-8.",
      502,
      undefined,
      "RASA_INVALID_RESPONSE"
    );
  }
}

async function readBoundedJson<T>(response: Response, maxBytes: number) {
  const text = await readBoundedText(response, maxBytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RasaApiError(
      "Rasa returned invalid JSON.",
      502,
      undefined,
      "RASA_INVALID_RESPONSE"
    );
  }
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
      redirect: "error",
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
    let details: unknown;
    try {
      const body = await readBoundedText(
        response,
        MAX_ERROR_RESPONSE_BYTES
      );
      details = body;
      try {
        details = JSON.parse(body);
      } catch {
        // Keep the bounded plain-text response.
      }
    } catch {
      details = undefined;
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
  return readBoundedJson<RasaStatus>(
    response,
    DEFAULT_JSON_RESPONSE_BYTES
  );
}

export async function getRasaOverview() {
  const timeoutMs = 10_000;
  const [root, version, status] = await Promise.allSettled([
    rasaFetch("/", undefined, { timeoutMs }).then((response) =>
      readBoundedText(response, 64 * 1024)
    ),
    rasaFetch("/version", undefined, { timeoutMs }).then((response) =>
      readBoundedJson<unknown>(response, DEFAULT_JSON_RESPONSE_BYTES)
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

export async function parseMessage(
  text: string,
  options: RasaRequestOptions = {}
) {
  const response = await rasaFetch("/model/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  }, options);
  return readBoundedJson<RasaParseResult>(
    response,
    options.maxResponseBytes ?? DEFAULT_JSON_RESPONSE_BYTES
  );
}

export async function sendRestMessage(
  sender: string,
  message: string,
  metadata?: Record<string, unknown>,
  options: RasaRequestOptions = {}
) {
  const response = await rasaFetch("/webhooks/rest/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender, message, metadata })
  }, options);
  return readBoundedJson<RasaReply[]>(
    response,
    options.maxResponseBytes ?? DEFAULT_JSON_RESPONSE_BYTES
  );
}

export async function getTracker(sender: string) {
  const response = await rasaFetch(
    `/conversations/${encodeURIComponent(sender)}/tracker?include_events=APPLIED`
  );
  return readBoundedJson<unknown>(response, 16 * 1024 * 1024);
}

export async function getLoadedDomain() {
  const response = await rasaFetch("/domain", {
    headers: { Accept: "application/json" }
  });
  return readBoundedJson<unknown>(response, 16 * 1024 * 1024);
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
    "/model/train?save_to_default_model_directory=true",
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

export async function activateRasaArtifact(
  artifactId: string,
  expectedFilename: string
) {
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

  const deadline = Date.now() + MODEL_ACTIVATION_TIMEOUT_MS;
  let lastStatus: RasaStatus | undefined;
  let lastError: RasaApiError | undefined;

  while (Date.now() < deadline) {
    try {
      const remainingMs = deadline - Date.now();
      lastStatus = await getRasaStatus(
        Math.max(1, Math.min(MODEL_STATUS_REQUEST_TIMEOUT_MS, remainingMs))
      );
      const loadedFilename = lastStatus.model_file?.split(/[\\/]/).pop();
      if (loadedFilename === expectedFilename) return lastStatus;
    } catch (error) {
      if (
        !(error instanceof RasaApiError) ||
        (error.code !== "RASA_TIMEOUT" && error.code !== "RASA_UNREACHABLE")
      ) {
        throw error;
      }
      lastError = error;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) {
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(MODEL_ACTIVATION_POLL_INTERVAL_MS, remainingMs)
        )
      );
    }
  }

  throw new RasaApiError(
    "Rasa accepted the model but did not confirm the requested model file.",
    504,
    {
      expectedFilename,
      reportedFilename: lastStatus?.model_file ?? null,
      lastErrorCode: lastError?.code
    },
    "MODEL_ACTIVATION_NOT_CONFIRMED"
  );
}
