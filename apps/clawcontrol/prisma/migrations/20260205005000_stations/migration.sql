-- Add stations table for agent categorization

CREATE TABLE IF NOT EXISTS "stations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "icon" TEXT NOT NULL,
  "description" TEXT,
  "color" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "stations_name_key" ON "stations"("name");
CREATE INDEX IF NOT EXISTS "stations_sort_order_idx" ON "stations"("sort_order");

-- Default stations
INSERT OR IGNORE INTO "stations" ("id", "name", "icon", "description", "color", "sort_order")
VALUES
  ('spec', 'spec', 'file-text', 'Planning & specifications', NULL, 10),
  ('build', 'build', 'hammer', 'Implementation', NULL, 20),
  ('qa', 'qa', 'check-circle', 'Quality assurance', NULL, 30),
  ('ops', 'ops', 'settings', 'Operations', NULL, 40);

-- Backfill: ensure every existing agent.station has a corresponding station row
INSERT OR IGNORE INTO "stations" ("id", "name", "icon", "description", "color", "sort_order")
SELECT DISTINCT
  a."station" AS "id",
  a."station" AS "name",
  'tag'       AS "icon",
  NULL        AS "description",
  NULL        AS "color",
  1000        AS "sort_order"
FROM "agents" a
WHERE a."station" IS NOT NULL AND a."station" != '';

