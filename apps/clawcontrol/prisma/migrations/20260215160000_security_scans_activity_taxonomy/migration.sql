-- Add activity taxonomy fields (category + risk level)
ALTER TABLE "activities" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "activities" ADD COLUMN "risk_level" TEXT NOT NULL DEFAULT 'safe';

CREATE INDEX "activities_category_idx" ON "activities"("category");
CREATE INDEX "activities_risk_level_idx" ON "activities"("risk_level");

-- Artifact scan records (sanitized; never store raw secrets/snippets)
CREATE TABLE "artifact_scan_records" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "artifact_type" TEXT NOT NULL,
  "artifact_key" TEXT NOT NULL,
  "manifest_id" TEXT,
  "manifest_version" TEXT,
  "outcome" TEXT NOT NULL,
  "blocked" BOOLEAN NOT NULL DEFAULT 0,
  "scanner_version" TEXT NOT NULL,
  "summary_json" TEXT NOT NULL DEFAULT '{}',
  "findings_json" TEXT NOT NULL DEFAULT '[]',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "artifact_scan_records_artifact_type_artifact_key_key"
  ON "artifact_scan_records"("artifact_type", "artifact_key");
CREATE INDEX "artifact_scan_records_artifact_type_idx" ON "artifact_scan_records"("artifact_type");
CREATE INDEX "artifact_scan_records_artifact_key_idx" ON "artifact_scan_records"("artifact_key");

-- Security alerts (idempotent link from blocked scan sha256 -> created work order)
CREATE TABLE "security_alerts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "artifact_key" TEXT NOT NULL,
  "work_order_id" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "security_alerts_artifact_key_key" ON "security_alerts"("artifact_key");
CREATE INDEX "security_alerts_work_order_id_idx" ON "security_alerts"("work_order_id");

