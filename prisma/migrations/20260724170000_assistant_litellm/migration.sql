ALTER TABLE "assistants"
  ADD COLUMN "llm_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "llm_system_prompt" TEXT NOT NULL DEFAULT '';
