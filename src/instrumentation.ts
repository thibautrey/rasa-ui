export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { startTrainingWorker } = await import("@/lib/training-worker");
    startTrainingWorker();
  }
}
