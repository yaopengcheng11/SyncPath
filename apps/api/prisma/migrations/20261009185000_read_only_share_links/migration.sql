-- Separate capability links never add recipients to workspace/project members.
CREATE TABLE "share_links" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "project_id" TEXT,
    "creator_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "projects_id_workspace_id_key" ON "projects"("id", "workspace_id");
CREATE UNIQUE INDEX "share_links_token_hash_key" ON "share_links"("token_hash");
CREATE INDEX "share_links_workspace_id_created_at_idx" ON "share_links"("workspace_id", "created_at");
CREATE INDEX "share_links_project_id_created_at_idx" ON "share_links"("project_id", "created_at");
CREATE INDEX "share_links_creator_id_idx" ON "share_links"("creator_id");

ALTER TABLE "share_links" ADD CONSTRAINT "share_links_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_project_id_workspace_id_fkey"
    FOREIGN KEY ("project_id", "workspace_id") REFERENCES "projects"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_creator_id_fkey"
    FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
