ALTER TABLE "projects" ADD COLUMN "timeline_revision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "timeline_versions" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "entry_id" TEXT,
  "actor" JSONB,
  "changes" JSONB NOT NULL,
  "snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "timeline_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "timeline_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "timeline_versions_project_id_version_key" ON "timeline_versions"("project_id", "version");
CREATE INDEX "timeline_versions_project_id_created_at_idx" ON "timeline_versions"("project_id", "created_at");
