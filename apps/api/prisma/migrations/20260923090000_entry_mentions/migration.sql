ALTER TABLE "progress_entries"
  ADD COLUMN "mention_all" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mentioned_user_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "mention_notifications" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "recipient_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "read_at" TIMESTAMP(3),
  CONSTRAINT "mention_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mention_notifications_recipient_id_created_at_idx" ON "mention_notifications"("recipient_id", "created_at");
CREATE INDEX "mention_notifications_entry_id_idx" ON "mention_notifications"("entry_id");

ALTER TABLE "mention_notifications" ADD CONSTRAINT "mention_notifications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mention_notifications" ADD CONSTRAINT "mention_notifications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mention_notifications" ADD CONSTRAINT "mention_notifications_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "progress_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mention_notifications" ADD CONSTRAINT "mention_notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mention_notifications" ADD CONSTRAINT "mention_notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
