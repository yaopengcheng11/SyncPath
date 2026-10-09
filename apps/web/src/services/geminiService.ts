// services/geminiService.ts
//
// SyncPath R0 stub for AI capabilities.
//
// Background:
//   The original implementation imported `@google/genai` directly and called
//   Google Gemini models. The dependency was removed in commit `e654dbc`
//   ("fix: remove google ai related code"), but several callers kept their
//   imports. To keep TypeScript happy and to preserve the existing call
//   sites, this module re-exports the same surface area with no-op
//   implementations.
//
// Roadmap:
//   AI is part of the R1 release (iteration S5), implemented as DEV-018
//   through DEV-021 per docs/SYNCPATH_DEVELOPMENT_FRAMEWORK_ACCEPTANCE.md.
//   R0 (the current milestone) explicitly defers AI; see docs/R0_NOTES.md
//   for the deferred-work list. When the AI gateway and worker land,
//   replace this stub with a thin client that calls `/api/v1/ai/...`
//   and consumes AIProposal records. Until then the AI affordances in the
//   UI render as a clearly disabled state and produce nothing.

import { Goal } from '../types';

export interface GeneratedLogRaw {
  date: string;
  summary: string;
  level: number;
  author: string;
  goals: string[];
}

const disabled = (feature: string): void => {
  // eslint-disable-next-line no-console
  console.warn(
    `[SyncPath] AI capability "${feature}" is disabled in R0. ` +
      'Real AI lands in R1 (DEV-018 ~ DEV-021) per ' +
      'docs/SYNCPATH_DEVELOPMENT_FRAMEWORK_ACCEPTANCE.md.'
  );
};

/**
 * Draft a roadmap of work logs from a free-form project description.
 * R0 stub: returns an empty list so the caller loop is a no-op.
 */
export const generateRoadmap = async (
  _description: string,
  _startDate: string,
  _endDate: string
): Promise<GeneratedLogRaw[]> => {
  disabled('generateRoadmap');
  return [];
};

/**
 * Summarize a week of work into a single paragraph.
 * R0 stub: returns an empty string so the editor stays unchanged.
 */
export const summarizeWork = async (
  _goals: Goal[],
  _notes: string
): Promise<string> => {
  disabled('summarizeWork');
  return '';
};

/**
 * Suggest SMART goals from a context blurb.
 * R0 stub: returns an empty list.
 */
export const suggestGoals = async (
  _context: string
): Promise<Partial<Goal>[]> => {
  disabled('suggestGoals');
  return [];
};
