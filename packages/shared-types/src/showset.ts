export type Area = '311' | '312';

export type StageStatus = 'not_started' | 'in_progress' | 'complete' | 'on_hold' | 'client_review' | 'engineer_review' | 'revision_required';

export type StageName =
  | 'screen'
  | 'structure'
  | 'integrated'
  | 'inBim360'
  | 'drawing2d';

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
}

export interface StageInfoSimple {
  status: StageStatus;
  updatedBy: string;
  updatedAt: string;
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

// Version types
export type VersionType = 'screenVersion' | 'revitVersion' | 'drawingVersion';

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
  // Version tracking
  screenVersion: number;
  revitVersion: number;
  drawingVersion: number;
  versionHistory: VersionHistoryEntry[];
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
  bim_coordinator: ['screen', 'structure', 'integrated', 'inBim360', 'drawing2d'],
  '3d_modeller': ['screen', 'structure', 'integrated'],
  '2d_drafter': ['drawing2d'],
};

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
