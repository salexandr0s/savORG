-- Add workflow tracking fields to work_orders and operations

-- Work orders: selected workflow + current stage
ALTER TABLE "work_orders" ADD COLUMN "workflow_id" TEXT;
ALTER TABLE "work_orders" ADD COLUMN "current_stage" INTEGER NOT NULL DEFAULT 0;

-- Operations: workflow chain state + escalation metadata
ALTER TABLE "operations" ADD COLUMN "workflow_id" TEXT;
ALTER TABLE "operations" ADD COLUMN "workflow_stage_index" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "operations" ADD COLUMN "iteration_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "operations" ADD COLUMN "loop_target_op_id" TEXT;
ALTER TABLE "operations" ADD COLUMN "escalated_at" DATETIME;
ALTER TABLE "operations" ADD COLUMN "escalation_reason" TEXT;

-- Indexes
CREATE INDEX "work_orders_workflow_id_idx" ON "work_orders"("workflow_id");
CREATE INDEX "operations_workflow_id_idx" ON "operations"("workflow_id");

