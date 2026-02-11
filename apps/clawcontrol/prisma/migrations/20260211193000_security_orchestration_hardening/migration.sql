-- Security + orchestration hardening migration

-- ---------------------------------------------------------------------------
-- Work order code sequence (race-safe WO code allocation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "work_order_sequences" (
  "id" INTEGER NOT NULL PRIMARY KEY,
  "next_value" INTEGER NOT NULL DEFAULT 1,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "work_order_sequences" ("id", "next_value")
VALUES (1, 1)
ON CONFLICT("id") DO NOTHING;

WITH computed AS (
  SELECT COALESCE(MAX(CAST(SUBSTR("code", 4) AS INTEGER)) + 1, 1) AS "next_value"
  FROM "work_orders"
  WHERE "code" GLOB 'WO-[0-9]*'
)
UPDATE "work_order_sequences"
SET "next_value" = (
  SELECT CASE
    WHEN "work_order_sequences"."next_value" > computed."next_value" THEN "work_order_sequences"."next_value"
    ELSE computed."next_value"
  END
  FROM computed
)
WHERE "id" = 1;

-- ---------------------------------------------------------------------------
-- Completion idempotency token uniqueness (operation-scoped)
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "operation_completion_tokens_token_key";
CREATE UNIQUE INDEX IF NOT EXISTS "operation_completion_tokens_operation_id_token_key"
  ON "operation_completion_tokens"("operation_id", "token");
CREATE INDEX IF NOT EXISTS "operation_completion_tokens_token_idx"
  ON "operation_completion_tokens"("token");

-- ---------------------------------------------------------------------------
-- Defensive data cleanup before state/status guards
-- ---------------------------------------------------------------------------
UPDATE "work_orders"
SET "state" = 'planned'
WHERE "state" IS NULL
  OR TRIM("state") = ''
  OR "state" NOT IN ('planned', 'active', 'blocked', 'review', 'shipped', 'cancelled');

UPDATE "operations"
SET "status" = 'todo'
WHERE "status" IS NULL
  OR TRIM("status") = ''
  OR "status" NOT IN ('todo', 'in_progress', 'blocked', 'review', 'done', 'rework');

-- ---------------------------------------------------------------------------
-- SQLite transition guards (trigger-based CHECK equivalent)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS "work_orders_state_guard_insert";
CREATE TRIGGER "work_orders_state_guard_insert"
BEFORE INSERT ON "work_orders"
FOR EACH ROW
WHEN NEW."state" IS NULL
  OR NEW."state" = ''
  OR NEW."state" NOT IN ('planned', 'active', 'blocked', 'review', 'shipped', 'cancelled')
BEGIN
  SELECT RAISE(FAIL, 'INVALID_WORK_ORDER_STATE');
END;

DROP TRIGGER IF EXISTS "work_orders_state_guard_update";
CREATE TRIGGER "work_orders_state_guard_update"
BEFORE UPDATE OF "state" ON "work_orders"
FOR EACH ROW
WHEN NEW."state" IS NULL
  OR NEW."state" = ''
  OR NEW."state" NOT IN ('planned', 'active', 'blocked', 'review', 'shipped', 'cancelled')
BEGIN
  SELECT RAISE(FAIL, 'INVALID_WORK_ORDER_STATE');
END;

DROP TRIGGER IF EXISTS "operations_status_guard_insert";
CREATE TRIGGER "operations_status_guard_insert"
BEFORE INSERT ON "operations"
FOR EACH ROW
WHEN NEW."status" IS NULL
  OR NEW."status" = ''
  OR NEW."status" NOT IN ('todo', 'in_progress', 'blocked', 'review', 'done', 'rework')
BEGIN
  SELECT RAISE(FAIL, 'INVALID_OPERATION_STATUS');
END;

DROP TRIGGER IF EXISTS "operations_status_guard_update";
CREATE TRIGGER "operations_status_guard_update"
BEFORE UPDATE OF "status" ON "operations"
FOR EACH ROW
WHEN NEW."status" IS NULL
  OR NEW."status" = ''
  OR NEW."status" NOT IN ('todo', 'in_progress', 'blocked', 'review', 'done', 'rework')
BEGIN
  SELECT RAISE(FAIL, 'INVALID_OPERATION_STATUS');
END;
