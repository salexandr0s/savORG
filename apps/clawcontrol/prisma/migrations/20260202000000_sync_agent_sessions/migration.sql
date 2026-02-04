-- CreateTable
-- Note: This migration syncs schema drift from db push.
-- The agent_sessions table may already exist in development DBs.
-- Use IF NOT EXISTS for idempotency.
CREATE TABLE IF NOT EXISTS "agent_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "session_key" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "model" TEXT,
    "updated_at_ms" BIGINT NOT NULL,
    "last_seen_at" DATETIME NOT NULL,
    "aborted_last_run" BOOLEAN NOT NULL DEFAULT false,
    "percent_used" INTEGER,
    "state" TEXT NOT NULL DEFAULT 'idle',
    "operation_id" TEXT,
    "work_order_id" TEXT,
    "raw_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agent_sessions_session_id_key" ON "agent_sessions"("session_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_sessions_agent_id_idx" ON "agent_sessions"("agent_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_sessions_state_idx" ON "agent_sessions"("state");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_sessions_last_seen_at_idx" ON "agent_sessions"("last_seen_at");
