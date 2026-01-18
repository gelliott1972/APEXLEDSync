import type { Language } from './user.js';
import type { LocalizedString } from './showset.js';

export type TranslationStatus = 'pending' | 'complete' | 'failed';

export interface NoteAttachment {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  s3Key: string;
  uploadedAt: string;
}

export interface Note {
  noteId: string;
  showSetId: string;
  authorId: string;
  authorName: string;
  originalLang: Language;
  content: LocalizedString;
  translationStatus: TranslationStatus;
  attachments: NoteAttachment[];
  isRevisionNote?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NoteCreateInput {
  content: string;
  language: Language;
}

export interface NoteUpdateInput {
  content: string;
}

// DynamoDB key structure
export interface NoteDDBKeys {
  PK: `SHOWSET#${string}`;
  SK: `NOTE#${string}#${string}`;
}

// Translation job message
export interface TranslationJob {
  noteId: string;
  showSetId: string;
  originalLang: Language;
  originalContent: string;
  targetLanguages: Language[];
}
