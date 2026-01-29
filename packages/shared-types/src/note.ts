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
  // PDF text extraction and translation fields
  extractedText?: string;
  translatedText?: {
    en: string;
    zh: string;
    'zh-TW': string;
  };
  pdfTranslationStatus?: 'pending' | 'complete' | 'failed';
  pdfTranslationError?: string;
}

// PDF translation job message
export interface PdfTranslationJob {
  noteId: string;
  attachmentId: string;
  showSetId: string;
  s3Key: string;
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
