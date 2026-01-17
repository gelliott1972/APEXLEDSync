import type { StageName, StageStatus } from './showset.js';

export type ActivityAction =
  | 'status_change'
  | 'assignment'
  | 'link_update'
  | 'version_update'
  | 'note_added'
  | 'showset_created';

export interface StatusChangeDetails {
  stage: StageName;
  from: StageStatus;
  to: StageStatus;
}

export interface AssignmentDetails {
  stage: StageName;
  assignedTo: string | null;
  assignedToName?: string;
}

export interface VersionUpdateDetails {
  stage: StageName;
  version: string;
}

export interface LinkUpdateDetails {
  field: 'modelUrl' | 'drawingsUrl';
  value: string | null;
}

export type ActivityDetails =
  | StatusChangeDetails
  | AssignmentDetails
  | VersionUpdateDetails
  | LinkUpdateDetails
  | Record<string, never>;

export interface Activity {
  activityId: string;
  showSetId: string;
  userId: string;
  userName: string;
  action: ActivityAction;
  details: ActivityDetails;
  createdAt: string;
}

// DynamoDB key structure
export interface ActivityDDBKeys {
  PK: `SHOWSET#${string}`;
  SK: `ACTIVITY#${string}#${string}`;
}

export interface ActivityDateGSI {
  GSI1PK: `ACTIVITY_DATE#${string}`;
  GSI1SK: `${string}#${string}`;
}
