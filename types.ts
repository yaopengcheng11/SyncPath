
export interface Goal {
  id: string;
  title: string;
  status: 'pending' | 'in-progress' | 'completed';
  description: string;
  isLocked?: boolean;
}

export type LogLevel = 1 | 2 | 3; // 1: Primary, 2: Secondary, 3: Minor

export interface WorkLog {
  id: string;
  author: string;
  level: LogLevel;
  weekStartDate: string; // YYYY-MM-DD
  summary: string;
  goals: Goal[];
  notes: string;
  createdAt: number;
  updatedAt?: number; // Added for conflict resolution
  isLocked?: boolean;
}

export interface Project {
  id: string;
  name: string;
  personnel: string;
  description?: string; // Added for AI generation context
  startDate: string;
  endDate: string;
  color: string;
  updatedAt?: number; // Added for conflict resolution
}

export type ViewState = 'dashboard' | 'timeline' | 'editor' | 'project-form' | 'multi-timeline';

export interface AppState {
  projects: Project[];
  selectedProjectId: string | null;
  selectedMultiIds?: string[]; // Added for multi-view selection
  logs: Record<string, Record<string, WorkLog[]>>; // Keyed by projectId, then weekStartDate
  activeLogDate: string | null;
  activeLogId: string | null; 
  view: ViewState;
  userMode: 'admin' | 'guest'; // Added for permission handling
}