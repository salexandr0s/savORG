-- Add stale sync semantics for OpenClaw agent reconciliation.
ALTER TABLE "agents" ADD COLUMN "is_stale" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "agents" ADD COLUMN "stale_at" DATETIME;

CREATE INDEX IF NOT EXISTS "agents_is_stale_idx" ON "agents"("is_stale");
CREATE INDEX IF NOT EXISTS "agents_stale_at_idx" ON "agents"("stale_at");
