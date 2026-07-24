CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');
CREATE TYPE "TrainingStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'EDITOR',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assistants" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "language" TEXT NOT NULL DEFAULT 'en',
  "config_yaml" TEXT NOT NULL,
  "domain_yaml" TEXT NOT NULL,
  "nlu_yaml" TEXT NOT NULL,
  "stories_yaml" TEXT NOT NULL,
  "rules_yaml" TEXT NOT NULL,
  "endpoints_yaml" TEXT NOT NULL,
  "credentials_yaml" TEXT NOT NULL,
  "active_model" TEXT,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assistants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "training_runs" (
  "id" TEXT NOT NULL,
  "assistant_id" TEXT NOT NULL,
  "status" "TrainingStatus" NOT NULL DEFAULT 'QUEUED',
  "model_name" TEXT,
  "log" TEXT NOT NULL DEFAULT '',
  "source_snapshot" JSONB NOT NULL,
  "source_hash" TEXT NOT NULL,
  "deploy_after_training" BOOLEAN NOT NULL DEFAULT true,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "worker_id" TEXT,
  "lease_until" TIMESTAMP(3),
  "heartbeat_at" TIMESTAMP(3),
  "error_code" TEXT,
  "deployment_error" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "training_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assistant_revisions" (
  "id" TEXT NOT NULL,
  "assistant_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "documents" JSONB NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assistant_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "model_artifacts" (
  "id" TEXT NOT NULL,
  "assistant_id" TEXT NOT NULL,
  "training_run_id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "archive" BYTEA NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "rasa_model_id" TEXT,
  "rasa_model_file" TEXT,
  "activated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "model_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "store_bots" (
  "id" TEXT NOT NULL,
  "assistant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "public_key" TEXT NOT NULL,
  "allowed_origins" JSONB NOT NULL,
  "primary_color" TEXT NOT NULL DEFAULT '#7c5cff',
  "accent_color" TEXT NOT NULL DEFAULT '#35d0ba',
  "position" TEXT NOT NULL DEFAULT 'right',
  "welcome_message" TEXT NOT NULL DEFAULT 'Bonjour ! Comment puis-je vous aider ?',
  "placeholder" TEXT NOT NULL DEFAULT 'Écrivez votre message…',
  "launcher_label" TEXT NOT NULL DEFAULT 'Besoin d''aide ?',
  "avatar_url" TEXT,
  "locale" TEXT NOT NULL DEFAULT 'fr',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "store_bots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversations" (
  "id" TEXT NOT NULL,
  "assistant_id" TEXT NOT NULL,
  "store_bot_id" TEXT,
  "sender_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'studio',
  "reviewed_at" TIMESTAMP(3),
  "rating" INTEGER,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "messages" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "direction" "MessageDirection" NOT NULL,
  "text" TEXT NOT NULL,
  "payload" JSONB,
  "request_id" TEXT,
  "intent" TEXT,
  "confidence" DOUBLE PRECISION,
  "latency_ms" INTEGER,
  "is_fallback" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "actor_id" TEXT,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "assistants_slug_key" ON "assistants"("slug");
CREATE INDEX "assistants_created_by_id_idx" ON "assistants"("created_by_id");
CREATE INDEX "training_runs_assistant_id_created_at_idx" ON "training_runs"("assistant_id", "created_at");
CREATE INDEX "training_runs_status_lease_until_created_at_idx" ON "training_runs"("status", "lease_until", "created_at");
CREATE UNIQUE INDEX "assistant_revisions_assistant_id_version_key" ON "assistant_revisions"("assistant_id", "version");
CREATE INDEX "assistant_revisions_assistant_id_created_at_idx" ON "assistant_revisions"("assistant_id", "created_at");
CREATE UNIQUE INDEX "model_artifacts_training_run_id_key" ON "model_artifacts"("training_run_id");
CREATE INDEX "model_artifacts_assistant_id_created_at_idx" ON "model_artifacts"("assistant_id", "created_at");
CREATE INDEX "model_artifacts_active_idx" ON "model_artifacts"("active");
CREATE UNIQUE INDEX "store_bots_public_key_key" ON "store_bots"("public_key");
CREATE INDEX "store_bots_assistant_id_idx" ON "store_bots"("assistant_id");
CREATE UNIQUE INDEX "conversations_assistant_id_sender_id_key" ON "conversations"("assistant_id", "sender_id");
CREATE INDEX "conversations_last_message_at_idx" ON "conversations"("last_message_at");
CREATE UNIQUE INDEX "messages_request_id_key" ON "messages"("request_id");
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

ALTER TABLE "assistants"
  ADD CONSTRAINT "assistants_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "training_runs"
  ADD CONSTRAINT "training_runs_assistant_id_fkey"
  FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assistant_revisions"
  ADD CONSTRAINT "assistant_revisions_assistant_id_fkey"
  FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assistant_revisions"
  ADD CONSTRAINT "assistant_revisions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "model_artifacts"
  ADD CONSTRAINT "model_artifacts_assistant_id_fkey"
  FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "model_artifacts"
  ADD CONSTRAINT "model_artifacts_training_run_id_fkey"
  FOREIGN KEY ("training_run_id") REFERENCES "training_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_bots"
  ADD CONSTRAINT "store_bots_assistant_id_fkey"
  FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_assistant_id_fkey"
  FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_store_bot_id_fkey"
  FOREIGN KEY ("store_bot_id") REFERENCES "store_bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
