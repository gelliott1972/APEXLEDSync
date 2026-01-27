// User types
export type {
  UserRole,
  UserStatus,
  Language,
  User,
  UserCreateInput,
  UserUpdateInput,
  ProfileUpdateInput,
  UserDDBKeys,
  UserEmailGSI,
} from './user.js';

// Re-export LocalizedString from user (it's also used elsewhere)
export type { LocalizedString } from './showset.js';

// ShowSet types
export type {
  Area,
  StageStatus,
  StageName,
  VMItem,
  StageInfo,
  StageInfoSimple,
  ShowSetStages,
  ShowSetLinks,
  VersionType,
  VersionHistoryEntry,
  ShowSet,
  ShowSetCreateInput,
  ShowSetUpdateInput,
  StageUpdateInput,
  LinksUpdateInput,
  UpstreamRevisionRequest,
  ShowSetDDBKeys,
  ShowSetAreaGSI,
} from './showset.js';

export { STAGE_PERMISSIONS, STATUS_COLORS, ENGINEER_ALLOWED_STATUSES, CUSTOMER_REVIEWER_ALLOWED_STATUSES, STAGE_VERSION_MAP, STAGE_NAMES } from './showset.js';

// Note types (deprecated - use Issue types)
export type {
  TranslationStatus,
  NoteAttachment,
  Note,
  NoteCreateInput,
  NoteUpdateInput,
  NoteDDBKeys,
  TranslationJob,
  PdfTranslationJob,
} from './note.js';

// Issue types
export type {
  IssueStatus,
  IssueMention,
  Issue,
  IssueCreateInput,
  IssueUpdateInput,
  IssueDDBKeys,
  IssueAuthorGSI,
  IssueMentionGSI,
  MyIssuesResponse,
} from './issue.js';

// Activity types
export type {
  ActivityAction,
  StatusChangeDetails,
  AssignmentDetails,
  VersionUpdateDetails,
  LinkUpdateDetails,
  ActivityDetails,
  Activity,
  ActivityDDBKeys,
  ActivityDateGSI,
} from './activity.js';

// Session types
export type {
  Session,
  SessionStartInput,
  SessionHeartbeatInput,
  SessionDDBKeys,
} from './session.js';

export { SESSION_TTL_SECONDS, HEARTBEAT_INTERVAL_MS } from './session.js';

// API types
export type {
  ErrorCode,
  ApiError,
  ApiResponse,
  PaginatedResponse,
} from './api.js';

export { HTTP_STATUS } from './api.js';
