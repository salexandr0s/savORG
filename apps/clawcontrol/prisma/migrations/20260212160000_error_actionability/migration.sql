-- Actionable error intelligence: raw-redacted samples, per-signature daily counts, and AI insights

ALTER TABLE "error_signature_aggregates"
ADD COLUMN "last_sample_raw_redacted" TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "error_signature_daily_aggregates" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "signature_hash" TEXT NOT NULL,
  "day" DATETIME NOT NULL,
  "count" BIGINT NOT NULL DEFAULT 0,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "error_signature_daily_aggregates_signature_hash_fkey"
    FOREIGN KEY ("signature_hash") REFERENCES "error_signature_aggregates" ("signature_hash")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "error_signature_daily_aggregates_signature_hash_day_key"
  ON "error_signature_daily_aggregates"("signature_hash", "day");
CREATE INDEX IF NOT EXISTS "error_signature_daily_aggregates_signature_hash_idx"
  ON "error_signature_daily_aggregates"("signature_hash");
CREATE INDEX IF NOT EXISTS "error_signature_daily_aggregates_day_idx"
  ON "error_signature_daily_aggregates"("day");
CREATE INDEX IF NOT EXISTS "error_signature_daily_aggregates_day_count_idx"
  ON "error_signature_daily_aggregates"("day", "count");

CREATE TABLE IF NOT EXISTS "error_signature_insights" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "signature_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "diagnosis_md" TEXT NOT NULL DEFAULT '',
  "failure_reason" TEXT,
  "source_agent_id" TEXT,
  "source_agent_name" TEXT,
  "input_hash" TEXT NOT NULL DEFAULT '',
  "generated_at" DATETIME,
  "last_attempt_at" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "error_signature_insights_signature_hash_fkey"
    FOREIGN KEY ("signature_hash") REFERENCES "error_signature_aggregates" ("signature_hash")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "error_signature_insights_signature_hash_key"
  ON "error_signature_insights"("signature_hash");
CREATE INDEX IF NOT EXISTS "error_signature_insights_status_idx"
  ON "error_signature_insights"("status");
CREATE INDEX IF NOT EXISTS "error_signature_insights_generated_at_idx"
  ON "error_signature_insights"("generated_at");
CREATE INDEX IF NOT EXISTS "error_signature_insights_last_attempt_at_idx"
  ON "error_signature_insights"("last_attempt_at");
