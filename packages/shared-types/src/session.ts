import type { StageName } from './showset.js';

export interface Session {
  userId: string;
  userName: string;
  showSetId: string | null;
  workingStages: StageName[];
  activity: string;
  startedAt: string;
  lastHeartbeat: string;
  expiresAt: number; // Unix timestamp for TTL
}

export interface SessionStartInput {
  showSetId?: string;
  workingStages?: StageName[];
  activity: string;
}

export interface SessionHeartbeatInput {
  showSetId?: string;
  activity?: string;
}

// DynamoDB key structure
export interface SessionDDBKeys {
  PK: 'ACTIVE_SESSION';
  SK: `USER#${string}`;
}

// Session TTL in seconds (5 minutes)
export const SESSION_TTL_SECONDS = 5 * 60;

// Heartbeat interval in milliseconds (60 seconds)
export const HEARTBEAT_INTERVAL_MS = 60 * 1000;
