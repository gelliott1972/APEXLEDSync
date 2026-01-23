export type Area = '311' | '312';

export type StageStatus = 'not_started' | 'in_progress' | 'complete' | 'on_hold' | 'client_review' | 'engineer_review' | 'revision_required';

export type StageName =
  | 'screen'
  | 'structure'
  | 'integrated'
  | 'inBim360'
  | 'drawing2d';

export const STAGE_NAMES: StageName[] = [
  'screen',
  'structure',
  'integrated',
  'inBim360',
  'drawing2d',
];

export interface LocalizedString {
  en: string;
  zh: string;
  'zh-TW': string;
}

export interface VMItem {
  id: string;
  name?: string;
}

export interface StageInfo {
  status: StageStatus;
  assignedTo?: string;
  updatedBy: string;
  updatedAt: string;
  version?: string;
  // Revision note (set when status = revision_required)
  revisionNote?: string;
  revisionNoteBy?: string;
  revisionNoteAt?: string;
}

export interface StageInfoSimple {
  status: StageStatus;
  updatedBy: string;
  updatedAt: string;
  // Revision note (set when status = revision_required)
  revisionNote?: string;
  revisionNoteBy?: string;
  revisionNoteAt?: string;
}

export interface ShowSetStages {
  screen: StageInfo;
  structure: StageInfo;
  integrated: StageInfo;
  inBim360: StageInfoSimple;
  drawing2d: StageInfo;
}

export interface ShowSetLinks {
  modelUrl: string | null;
  drawingsUrl: string | null;
}

// Version types - 3 deliverables (inBim360 has no version - just a publish step)
export type VersionType = 'screenVersion' | 'revitVersion' | 'drawingVersion';

// Map stage names to version types (inBim360 has no version)
export const STAGE_VERSION_MAP: Record<StageName, VersionType | null> = {
  screen: 'screenVersion',
  structure: 'revitVersion',     // Structure and Integrated share revitVersion
  integrated: 'revitVersion',    // Structure and Integrated share revitVersion
  inBim360: null,                // No version - just uploads to BIM360 cloud
  drawing2d: 'drawingVersion',
};

export interface VersionHistoryEntry {
  id: string;
  versionType: VersionType;
  version: number;
  reason: LocalizedString;
  createdAt: string;
  createdBy: string;
}

export interface ShowSet {
  showSetId: string;
  area: Area;
  scene: string;
  description: LocalizedString;
  vmList: VMItem[];
  stages: ShowSetStages;
  links: ShowSetLinks;
  // Version tracking - 3 deliverables
  screenVersion: number;      // Screen model version
  revitVersion: number;       // Revit model version (shared by structure + integrated stages)
  drawingVersion: number;     // 2D drawings version
  // Legacy fields for backward compatibility (migration in progress)
  structureVersion?: number;
  integratedVersion?: number;
  bim360Version?: number;
  versionHistory: VersionHistoryEntry[];
  // Locking - simple flag, admin controls
  lockedAt?: string;
  lockedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShowSetCreateInput {
  showSetId: string;
  area: Area;
  scene: string;
  description: LocalizedString;
  vmList?: VMItem[];
}

export interface ShowSetUpdateInput {
  showSetId?: string;
  area?: Area;
  scene?: string;
  description?: LocalizedString;
  vmList?: VMItem[];
}

export interface StageUpdateInput {
  status: StageStatus;
  assignedTo?: string | null;
  version?: string;
  revisionNote?: string;
  revisionNoteLang?: 'en' | 'zh' | 'zh-TW';
  // Recall from review: target stage to start working on
  recallTarget?: StageName;
  // Recall from review: stage that was in review when recall initiated
  recallFrom?: StageName;
}

export interface LinksUpdateInput {
  modelUrl?: string | null;
  drawingsUrl?: string | null;
}

// DynamoDB key structure
export interface ShowSetDDBKeys {
  PK: `SHOWSET#${string}`;
  SK: 'DETAILS';
}

export interface ShowSetAreaGSI {
  GSI1PK: `AREA#${Area}`;
  GSI1SK: `SHOWSET#${string}`;
}

// Permissions by role for stages
export const STAGE_PERMISSIONS: Record<string, StageName[]> = {
  admin: ['screen', 'structure', 'integrated', 'inBim360', 'drawing2d'],
  bim_coordinator: ['inBim360'],
  engineer: ['screen', 'structure', 'integrated', 'inBim360', 'drawing2d'], // Can only approve/reject, not work
  '3d_modeller': ['screen', 'structure', 'integrated'],
  '2d_drafter': ['drawing2d'],
  customer_reviewer: ['inBim360', 'drawing2d'], // Client review stages only, approval-only role
  view_only: [], // No permissions to update any stages
};

// Engineer can only set these statuses (approval-only role)
export const ENGINEER_ALLOWED_STATUSES: StageStatus[] = ['complete', 'revision_required'];

// Customer reviewer can only set these statuses (approval-only role for client_review stages)
export const CUSTOMER_REVIEWER_ALLOWED_STATUSES: StageStatus[] = ['complete', 'revision_required'];

// Status colors for UI
export const STATUS_COLORS: Record<StageStatus, string> = {
  not_started: 'gray',
  in_progress: 'orange',
  complete: 'green',
  on_hold: 'red',
  client_review: 'blue',
  engineer_review: 'purple',
  revision_required: 'amber',
};
