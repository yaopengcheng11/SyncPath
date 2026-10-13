-- Receipts are scoped to the authenticated recipient and contain no token or
-- content. Removing a link preserves its receipt as an unavailable snapshot.
CREATE TABLE "received_shares" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "link_id" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workspace_name" TEXT NOT NULL,
    "sharer_username" TEXT NOT NULL,
    "sharer_display_name" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "received_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "received_shares_user_id_link_id_key" ON "received_shares"("user_id", "link_id");
CREATE INDEX "received_shares_user_id_received_at_idx" ON "received_shares"("user_id", "received_at");
CREATE INDEX "received_shares_link_id_idx" ON "received_shares"("link_id");

ALTER TABLE "received_shares" ADD CONSTRAINT "received_shares_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "received_shares" ADD CONSTRAINT "received_shares_link_id_fkey"
    FOREIGN KEY ("link_id") REFERENCES "share_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;
