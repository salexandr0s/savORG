-- Agent identity refactor: name-agnostic runtime fields and structured owner/actor linkage

-- Work orders: structured ownership
ALTER TABLE "work_orders" ADD COLUMN "owner_type" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "work_orders" ADD COLUMN "owner_agent_id" TEXT;

-- Agents: display/runtime identity
ALTER TABLE "agents" ADD COLUMN "display_name" TEXT;
ALTER TABLE "agents" ADD COLUMN "slug" TEXT;
ALTER TABLE "agents" ADD COLUMN "runtime_agent_id" TEXT;
ALTER TABLE "agents" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'worker';
ALTER TABLE "agents" ADD COLUMN "dispatch_eligible" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "agents" ADD COLUMN "name_source" TEXT NOT NULL DEFAULT 'system';

-- Activities: structured actor linkage
ALTER TABLE "activities" ADD COLUMN "actor_type" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "activities" ADD COLUMN "actor_agent_id" TEXT;

-- Artifacts: structured creator linkage
ALTER TABLE "artifacts" ADD COLUMN "created_by_agent_id" TEXT;

-- Backfill agent identity columns from legacy values
UPDATE "agents"
SET "display_name" = COALESCE(NULLIF(TRIM("name"), ''), "name")
WHERE "display_name" IS NULL;

UPDATE "agents"
SET "slug" = COALESCE(
  NULLIF(
    LOWER(
      TRIM(
        REPLACE(
          REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(
                  REPLACE("display_name", ' ', '-'),
                  '_', '-'
                ),
                '.', '-'
              ),
              ':', '-'
            ),
            '/', '-'
          ),
          '--', '-'
        )
      )
    ),
    ''
  ),
  LOWER("id")
)
WHERE "slug" IS NULL;

-- Deduplicate slugs if any collisions exist
WITH ranked AS (
  SELECT "id", "slug", ROW_NUMBER() OVER (PARTITION BY "slug" ORDER BY "id") AS rn
  FROM "agents"
  WHERE "slug" IS NOT NULL
)
UPDATE "agents"
SET "slug" = "slug" || '-' || CAST((SELECT rn FROM ranked WHERE ranked."id" = "agents"."id") AS TEXT)
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);

UPDATE "agents"
SET "runtime_agent_id" = COALESCE(
  CASE
    WHEN "session_key" LIKE 'agent:%' AND INSTR(SUBSTR("session_key", 7), ':') > 0
      THEN SUBSTR("session_key", 7, INSTR(SUBSTR("session_key", 7), ':') - 1)
    ELSE NULL
  END,
  "slug",
  LOWER("id")
)
WHERE "runtime_agent_id" IS NULL;

UPDATE "agents"
SET "kind" = CASE
  WHEN LOWER("display_name" || ' ' || "role" || ' ' || "station" || ' ' || "runtime_agent_id") LIKE '%ceo%'
    OR LOWER("display_name" || ' ' || "role" || ' ' || "station" || ' ' || "runtime_agent_id") LIKE '%chief%'
    THEN 'ceo'
  WHEN LOWER("display_name" || ' ' || "role" || ' ' || "station" || ' ' || "runtime_agent_id") LIKE '%manager%'
    THEN 'manager'
  WHEN LOWER("display_name" || ' ' || "role" || ' ' || "station" || ' ' || "runtime_agent_id") LIKE '%guard%'
    THEN 'guard'
  ELSE 'worker'
END;

UPDATE "agents"
SET "dispatch_eligible" = CASE WHEN "kind" IN ('manager', 'ceo', 'guard') THEN false ELSE true END;

UPDATE "agents"
SET "name_source" = CASE WHEN "session_key" LIKE 'agent:%' THEN 'openclaw' ELSE 'system' END;

-- Keep legacy alias in sync for compatibility
UPDATE "agents"
SET "name" = COALESCE("display_name", "name")
WHERE "display_name" IS NOT NULL;

-- Backfill work-order structured ownership and normalize legacy owner label
UPDATE "work_orders"
SET "owner_type" = CASE
  WHEN LOWER(TRIM("owner")) = 'system' THEN 'system'
  WHEN LOWER(TRIM("owner")) = 'user' OR "owner" IS NULL OR TRIM("owner") = '' THEN 'user'
  ELSE 'agent'
END;

UPDATE "work_orders"
SET "owner_agent_id" = (
  SELECT a."id"
  FROM "agents" a
  WHERE
    LOWER(a."id") = LOWER(TRIM("work_orders"."owner")) OR
    LOWER(a."name") = LOWER(TRIM("work_orders"."owner")) OR
    LOWER(COALESCE(a."display_name", '')) = LOWER(TRIM("work_orders"."owner")) OR
    LOWER(COALESCE(a."slug", '')) = LOWER(TRIM("work_orders"."owner")) OR
    LOWER(COALESCE(a."runtime_agent_id", '')) = LOWER(TRIM("work_orders"."owner"))
  ORDER BY a."id"
  LIMIT 1
)
WHERE "owner_type" = 'agent' AND ("owner_agent_id" IS NULL OR "owner_agent_id" = '');

UPDATE "work_orders"
SET "owner" = CASE
  WHEN "owner_type" = 'agent' AND "owner_agent_id" IS NOT NULL THEN 'agent:' || "owner_agent_id"
  WHEN "owner_type" = 'system' THEN 'system'
  ELSE 'user'
END;

-- Backfill activity actor fields
UPDATE "activities"
SET "actor_type" = CASE
  WHEN LOWER("actor") LIKE 'agent:%' THEN 'agent'
  WHEN LOWER("actor") LIKE 'system%' OR LOWER("actor") LIKE 'operator:%' THEN 'system'
  ELSE 'user'
END;

UPDATE "activities"
SET "actor_agent_id" = (
  SELECT a."id"
  FROM "agents" a
  WHERE
    LOWER(a."id") = LOWER(TRIM(SUBSTR("activities"."actor", 7))) OR
    LOWER(a."name") = LOWER(TRIM(SUBSTR("activities"."actor", 7))) OR
    LOWER(COALESCE(a."display_name", '')) = LOWER(TRIM(SUBSTR("activities"."actor", 7))) OR
    LOWER(COALESCE(a."slug", '')) = LOWER(TRIM(SUBSTR("activities"."actor", 7))) OR
    LOWER(COALESCE(a."runtime_agent_id", '')) = LOWER(TRIM(SUBSTR("activities"."actor", 7)))
  ORDER BY a."id"
  LIMIT 1
)
WHERE "actor_type" = 'agent';

-- Backfill artifact creator linkage
UPDATE "artifacts"
SET "created_by_agent_id" = (
  SELECT a."id"
  FROM "agents" a
  WHERE
    LOWER(a."id") = LOWER(TRIM("artifacts"."created_by")) OR
    LOWER(a."name") = LOWER(TRIM("artifacts"."created_by")) OR
    LOWER(COALESCE(a."display_name", '')) = LOWER(TRIM("artifacts"."created_by")) OR
    LOWER(COALESCE(a."slug", '')) = LOWER(TRIM("artifacts"."created_by")) OR
    LOWER(COALESCE(a."runtime_agent_id", '')) = LOWER(TRIM("artifacts"."created_by"))
  ORDER BY a."id"
  LIMIT 1
)
WHERE "created_by_agent_id" IS NULL;

-- New indexes
CREATE INDEX "work_orders_owner_type_idx" ON "work_orders"("owner_type");
CREATE INDEX "work_orders_owner_agent_id_idx" ON "work_orders"("owner_agent_id");

CREATE UNIQUE INDEX "agents_slug_key" ON "agents"("slug");
CREATE INDEX "agents_display_name_idx" ON "agents"("display_name");
CREATE INDEX "agents_kind_idx" ON "agents"("kind");
CREATE INDEX "agents_dispatch_eligible_idx" ON "agents"("dispatch_eligible");

CREATE INDEX "activities_actor_type_idx" ON "activities"("actor_type");
CREATE INDEX "activities_actor_agent_id_idx" ON "activities"("actor_agent_id");

CREATE INDEX "artifacts_created_by_agent_id_idx" ON "artifacts"("created_by_agent_id");
