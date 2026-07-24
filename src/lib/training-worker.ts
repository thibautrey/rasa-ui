import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { activateModelArtifact } from "@/lib/models";
import {
  publicRasaError,
  RasaApiError,
  trainRasaModel,
  type RasaDocuments
} from "@/lib/rasa";

const POLL_INTERVAL_MS = 5_000;
const LEASE_DURATION_MS = 5 * 60_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 3;

type WorkerState = {
  busy: boolean;
  workerId: string;
  timer: NodeJS.Timeout;
};

type ClaimedRun = { id: string };

const globalWorker = globalThis as typeof globalThis & {
  rasaTrainingWorker?: WorkerState;
};

function trainingDocuments(value: Prisma.JsonValue): RasaDocuments {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The training source snapshot is invalid.");
  }
  const source = value as Record<string, Prisma.JsonValue>;
  const fields = [
    "configYaml",
    "domainYaml",
    "nluYaml",
    "storiesYaml",
    "rulesYaml"
  ] as const;
  const documents = Object.fromEntries(
    fields.map((field) => {
      const entry = source[field];
      if (typeof entry !== "string") {
        throw new Error(`The training snapshot is missing ${field}.`);
      }
      return [field, entry];
    })
  );
  return documents as RasaDocuments;
}

async function failExhaustedRuns() {
  await db.trainingRun.updateMany({
    where: {
      status: "RUNNING",
      attempts: { gte: MAX_ATTEMPTS },
      leaseUntil: { lt: new Date() }
    },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      workerId: null,
      leaseUntil: null,
      heartbeatAt: null,
      errorCode: "MAX_ATTEMPTS",
      log: "L’entraînement a été abandonné après plusieurs reprises."
    }
  });
}

async function claimNextRun(workerId: string) {
  await failExhaustedRuns();
  const leaseUntil = new Date(Date.now() + LEASE_DURATION_MS);
  const rows = await db.$queryRaw<ClaimedRun[]>`
    WITH candidate AS (
      SELECT "id"
      FROM "training_runs"
      WHERE (
        "status" = 'QUEUED'::"TrainingStatus"
        OR (
          "status" = 'RUNNING'::"TrainingStatus"
          AND "lease_until" < NOW()
        )
      )
      AND "attempts" < ${MAX_ATTEMPTS}
      ORDER BY "created_at" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "training_runs" AS run
    SET
      "status" = 'RUNNING'::"TrainingStatus",
      "worker_id" = ${workerId},
      "lease_until" = ${leaseUntil},
      "heartbeat_at" = NOW(),
      "attempts" = run."attempts" + 1,
      "started_at" = COALESCE(run."started_at", NOW()),
      "finished_at" = NULL,
      "error_code" = NULL
    FROM candidate
    WHERE run."id" = candidate."id"
    RETURNING run."id"
  `;
  return rows[0]?.id ?? null;
}

async function heartbeat(runId: string, workerId: string) {
  await db.trainingRun.updateMany({
    where: { id: runId, workerId, status: "RUNNING" },
    data: {
      heartbeatAt: new Date(),
      leaseUntil: new Date(Date.now() + LEASE_DURATION_MS)
    }
  });
}

function errorCode(error: unknown) {
  if (error instanceof RasaApiError) return error.code;
  return "TRAINING_FAILED";
}

async function processRun(runId: string, workerId: string) {
  const timer = setInterval(() => {
    void heartbeat(runId, workerId);
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref();

  try {
    const run = await db.trainingRun.findUniqueOrThrow({
      where: { id: runId },
      include: { artifact: true }
    });

    await db.trainingRun.update({
      where: { id: run.id },
      data: {
        log: run.artifact
          ? "Archive existante retrouvée après reprise.\n"
          : "Sources validées. Entraînement Rasa lancé…\n"
      }
    });

    let artifact = run.artifact;
    if (!artifact) {
      const result = await trainRasaModel(
        trainingDocuments(run.sourceSnapshot)
      );
      artifact = await db.modelArtifact.create({
        data: {
          assistantId: run.assistantId,
          trainingRunId: run.id,
          filename: result.filename,
          sha256: result.sha256,
          sizeBytes: BigInt(result.archive.length),
          archive: result.archive
        }
      });
    }

    let deploymentError: string | null = null;
    let deploymentLog = "Archive sauvegardée et disponible pour promotion.\n";
    if (run.deployAfterTraining) {
      try {
        const activation = await activateModelArtifact(artifact.id);
        deploymentLog = `Modèle actif : ${
          activation.status.model_file ?? artifact.filename
        }\n`;
      } catch (error) {
        const detail = publicRasaError(error);
        deploymentError = JSON.stringify(detail);
        deploymentLog =
          "Archive créée, mais son activation a échoué. Une nouvelle promotion peut être lancée depuis Modèles.\n";
      }
    }

    await db.trainingRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        modelName: artifact.filename,
        deploymentError,
        finishedAt: new Date(),
        workerId: null,
        leaseUntil: null,
        heartbeatAt: null,
        log: `Entraînement terminé.\n${deploymentLog}`
      }
    });
  } catch (error) {
    const detail = publicRasaError(error);
    await db.trainingRun.updateMany({
      where: { id: runId, workerId },
      data: {
        status: "FAILED",
        errorCode: errorCode(error),
        finishedAt: new Date(),
        workerId: null,
        leaseUntil: null,
        heartbeatAt: null,
        log: `${detail.error}\n${
          detail.details ? JSON.stringify(detail.details).slice(0, 4_000) : ""
        }`
      }
    });
  } finally {
    clearInterval(timer);
  }
}

async function tick() {
  const state = globalWorker.rasaTrainingWorker;
  if (!state || state.busy) return;
  state.busy = true;
  try {
    const runId = await claimNextRun(state.workerId);
    if (runId) await processRun(runId, state.workerId);
  } catch (error) {
    console.error(
      "Training worker tick failed:",
      error instanceof Error ? error.message : error
    );
  } finally {
    state.busy = false;
  }
}

export function startTrainingWorker() {
  if (process.env.TRAINING_WORKER_ENABLED === "false") return;
  if (globalWorker.rasaTrainingWorker) return;

  const timer = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  timer.unref();
  globalWorker.rasaTrainingWorker = {
    busy: false,
    workerId: `web-${randomUUID()}`,
    timer
  };
  void tick();
}

export function kickTrainingWorker() {
  startTrainingWorker();
  void tick();
}
