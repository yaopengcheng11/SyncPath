-- Locked cards are immutable: no moves (week_start_date), no content edits,
-- no deletes. Only toggling is_locked back to false is accepted while set.
ALTER TABLE "progress_entries"
  ADD COLUMN "is_locked" BOOLEAN NOT NULL DEFAULT false;