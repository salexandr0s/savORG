-- Add JSON tags field for work order categorization
ALTER TABLE "work_orders" ADD COLUMN "tags" TEXT NOT NULL DEFAULT '[]';
