import type { Language } from './user.js';
import type { LocalizedString } from './showset.js';
import type { TranslationStatus, NoteAttachment } from './note.js';

export type IssueStatus = 'open' | 'closed';

export interface IssueMention {
  userId: string;
  userName: string;
}

export interface Issue {
  issueId: string;
  showSetId: string;
  // Threading
  parentIssueId?: string; // If set, this is a reply
  replyCount: number; // Direct reply count for UI
  // Author
  authorId: string;
  authorName: string;
  // Content (multilingual support)
  originalLang: Language;
  content: LocalizedString;
  translationStatus: TranslationStatus;
  // Status
  status: IssueStatus;
  closedAt?: string;
  closedBy?: string;
  closedByName?: string;
  // Mentions
  mentions: IssueMention[];
  // Participants and read tracking
  participants: string[]; // UserIds of creator + all repliers
  unreadFor: string[]; // UserIds who haven't seen latest replies
  lastReadBy: Record<string, string>; // userId -> ISO timestamp of last read
  // Existing fields from Note
  attachments: NoteAttachment[];
  isRevisionNote?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IssueCreateInput {
  content: string;
  language: Language;
  parentIssueId?: string;
  mentions?: string[]; // Array of userIds
  isRevisionNote?: boolean;
}

export interface IssueUpdateInput {
  content: string;
}

// DynamoDB key structure
export interface IssueDDBKeys {
  PK: `SHOWSET#${string}`;
  SK: `ISSUE#${string}#${string}`;
}

// GSI1 for author lookup ("My Issues")
export interface IssueAuthorGSI {
  GSI1PK: `USER#${string}`;
  GSI1SK: `ISSUE#${string}#${string}`;
}

// GSI2 for mention lookup (issues I'm mentioned in)
export interface IssueMentionGSI {
  GSI2PK: `MENTION#${string}`;
  GSI2SK: `ISSUE#${string}#${string}#${string}`;
}

// My issues response
export interface MyIssuesResponse {
  createdByMe: Issue[];
  mentionedIn: Issue[];
  openCount: number;
  unreadCount: number; // Count of issues with unread replies for this user
  unreadIssueIds: string[]; // List of issueIds with unread content
}
