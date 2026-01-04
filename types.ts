
export interface Goal {
  id: string;
  title: string;
  status: 'pending' | 'in-progress' | 'completed';
  description: string;
  isLocked?: boolean;
}

export type LogLevel = 1 | 2 | 3; // 1: Primary, 2: Secondary, 3: Minor
export type HolidayRegion = 'CN' | 'US' | 'NONE';

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
  status?: 'pending' | 'completed'; // Added status field
}

export interface HolidayData {
  date: string;
  localName: string;
  name: string;
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
  holidayRegion?: HolidayRegion;
  storedHolidays?: HolidayData[]; // Store fetched holidays here
}

export interface User {
  username: string;
  password?: string; // In a real app, never store plain text. For this local demo, it's acceptable.
  role: 'admin' | 'guest';
  color?: string;
}

export interface Collaborator {
  clientId: number;
  username: string;
  color: string;
  action: string; 
  target?: string; 
  targetId?: string; 
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
  currentUser: User | null; // Replaces userMode
  readonlyProjectIds?: string[]; // IDs of projects that are read-only (e.g. retained from a closed session)
  systemMessage?: {
    title: string;
    message: string;
    type: 'info' | 'warning' | 'error';
  } | null;
  theme?: 'light' | 'dark';
}
