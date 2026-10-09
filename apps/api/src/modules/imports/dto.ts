/**
 * Legacy JSON import DTOs.
 *
 * The R0 SPA exported projects + logs in a specific shape (see
 * docs/SYNCPATH_DEVELOPMENT_FRAMEWORK_ACCEPTANCE.md §7.3 for the field
 * map). This module normalises that shape into the v1 API objects.
 *
 * Source of truth: docs §7.3 ("旧数据迁移映射").
 *
 * Notes:
 *   - `personnel` is kept verbatim on the Workspace description; we never
 *     substring-match it for permissions (docs §7.3 rule).
 *   - `WorkLog.author` becomes `title` (Key Objectives). The actual
 *     creator is the user calling the import endpoint.
 *   - `goals[]` is preserved in the entry's notes (legacyGoals JSON
 *     blob) for first-stage parity — the structured Initiative/Goal model
 *     is a later migration.
 *   - IDs from the legacy file are discarded; we mint fresh v7 UUIDs.
 *     Legacy IDs are stored as the JSON payload's `id` field for future
 *     linking (mirroring `legacy_id`).
 */

export interface LegacyGoal {
  id?: string;
  title?: string;
  status?: string;
  description?: string;
}

export interface LegacyWorkLog {
  id?: string;
  author?: string;            // → title (Key Objectives)
  level?: number | string;    // 1|2|3 → primary|secondary|minor
  weekStartDate?: string;
  date?: string;              // older dumps may use `date`
  summary?: string;
  notes?: string;
  goals?: LegacyGoal[];
  createdAt?: number;
  updatedAt?: number;
  isLocked?: boolean;
  status?: 'pending' | 'completed';
}

export interface LegacyProject {
  id?: string;
  name: string;
  personnel?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  color?: string;
  holidayRegion?: 'CN' | 'US' | 'NONE';
  logs?: LegacyWorkLog[];
}

export interface LegacyImportBody {
  projects?: LegacyProject[];
  /** Optional override of the target workspace slug; created if missing. */
  workspaceName?: string;
  /** Allow caller to opt out of legacy data mutation warnings. */
  accept?: boolean;
}

export interface ImportSummary {
  workspace: { id: string; name: string; slug: string; created: boolean };
  projects: Array<{
    sourceId: string | null;
    id: string;
    name: string;
    created: boolean;
    entriesCreated: number;
    entriesSkipped: number;
    errors: string[];
  }>;
  totals: {
    projectsCreated: number;
    projectsSkipped: number;
    entriesCreated: number;
    entriesSkipped: number;
  };
}
