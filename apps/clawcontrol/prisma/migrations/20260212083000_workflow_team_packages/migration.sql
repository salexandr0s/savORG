-- Workflow + Team + Package UX unification foundation

CREATE TABLE IF NOT EXISTS "agent_teams" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "source" TEXT NOT NULL DEFAULT 'custom',
  "workflow_ids" TEXT NOT NULL DEFAULT '[]',
  "template_ids" TEXT NOT NULL DEFAULT '[]',
  "health_status" TEXT NOT NULL DEFAULT 'healthy',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_teams_slug_key" ON "agent_teams"("slug");
CREATE INDEX IF NOT EXISTS "agent_teams_source_idx" ON "agent_teams"("source");
CREATE INDEX IF NOT EXISTS "agent_teams_health_status_idx" ON "agent_teams"("health_status");

ALTER TABLE "agents" ADD COLUMN "team_id" TEXT;
CREATE INDEX IF NOT EXISTS "agents_team_id_idx" ON "agents"("team_id");
