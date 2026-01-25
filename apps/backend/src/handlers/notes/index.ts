import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  TABLE_NAMES,
  docClient,
  keys,
  generateId,
  now,
} from '@unisync/db-utils';
import type { Note, Language, TranslationJob, NoteAttachment, PdfTranslationJob } from '@unisync/shared-types';
import { withAuth, canDeleteNote, canEditNote, type AuthenticatedHandler } from '../../middleware/authorize.js';
import {
  success,
  validationError,
  notFound,
  forbidden,
  internalError,
} from '../../lib/response.js';

const sqsClient = new SQSClient({
  region: process.env.AWS_REGION ?? 'ap-east-1',
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION ?? 'ap-east-1',
});

const TRANSLATION_QUEUE_URL = process.env.TRANSLATION_QUEUE_URL!;
const PDF_TRANSLATION_QUEUE_URL = process.env.PDF_TRANSLATION_QUEUE_URL;
const ATTACHMENTS_BUCKET = process.env.ATTACHMENTS_BUCKET!;

// Schemas
const createNoteSchema = z.object({
  content: z.string().min(1).max(5000),
  language: z.enum(['en', 'zh', 'zh-TW']),
  isRevisionNote: z.boolean().optional(),
});

const updateNoteSchema = z.object({
  content: z.string().min(1).max(5000),
});

const presignUploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  fileSize: z.number().positive().max(50 * 1024 * 1024), // Max 50MB
});

// Allowed MIME types for attachments
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

// Helper to get all languages except original
function getTargetLanguages(original: Language): Language[] {
  const all: Language[] = ['en', 'zh', 'zh-TW'];
  return all.filter((lang) => lang !== original);
}

// Send translation job to SQS
async function queueTranslation(job: TranslationJob) {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: TRANSLATION_QUEUE_URL,
      MessageBody: JSON.stringify(job),
    })
  );
}

// Queue PDF translation job
async function queuePdfTranslation(job: PdfTranslationJob) {
  if (!PDF_TRANSLATION_QUEUE_URL) {
    console.log('PDF translation queue not configured, skipping');
    return;
  }
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: PDF_TRANSLATION_QUEUE_URL,
      MessageBody: JSON.stringify(job),
    })
  );
}

// Log activity helper
async function logActivity(
  showSetId: string,
  userId: string,
  userName: string,
  action: string,
  details: Record<string, unknown>
) {
  const activityId = generateId();
  const timestamp = now();
  const date = timestamp.split('T')[0];

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAMES.ACTIVITY,
      Item: {
        ...keys.activity(showSetId, timestamp, activityId),
        ...keys.activityDate(date, timestamp, activityId),
        activityId,
        showSetId,
        userId,
        userName,
        action,
        details,
        createdAt: timestamp,
      },
    })
  );
}

// Handlers
const listNotes: AuthenticatedHandler = async (event) => {
  try {
    const showSetId = event.pathParameters?.id;
    if (!showSetId) {
      return validationError('ShowSet ID is required');
    }

    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAMES.NOTES,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `SHOWSET#${showSetId}`,
          ':skPrefix': 'NOTE#',
        },
        ScanIndexForward: false, // Most recent first
      })
    );

    return success((result.Items ?? []) as Note[]);
  } catch (err) {
    console.error('Error listing notes:', err);
    return internalError();
  }
};

const createNote: AuthenticatedHandler = async (event, auth) => {
  try {
    const showSetId = event.pathParameters?.id;
    if (!showSetId) {
      return validationError('ShowSet ID is required');
    }

    const body = JSON.parse(event.body ?? '{}');
    const parsed = createNoteSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { content, language, isRevisionNote } = parsed.data;
    const noteId = generateId();
    const timestamp = now();

    // Initialize content with original language
    const noteContent: Record<Language, string> = {
      en: language === 'en' ? content : '',
      zh: language === 'zh' ? content : '',
      'zh-TW': language === 'zh-TW' ? content : '',
    };

    const note: Note & { PK: string; SK: string } = {
      ...keys.note(showSetId, timestamp, noteId),
      noteId,
      showSetId,
      authorId: auth.userId,
      authorName: auth.name,
      originalLang: language,
      content: noteContent,
      translationStatus: 'pending',
      attachments: [],
      isRevisionNote: isRevisionNote ?? false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAMES.NOTES,
        Item: note,
      })
    );

    // Queue translation job
    const targetLanguages = getTargetLanguages(language);
    await queueTranslation({
      noteId,
      showSetId,
      originalLang: language,
      originalContent: content,
      targetLanguages,
    });

    // Log activity
    await logActivity(showSetId, auth.userId, auth.name, 'note_added', {
      noteId,
      isRevisionNote: isRevisionNote ?? false,
    });

    return success(note, 201);
  } catch (err) {
    console.error('Error creating note:', err);
    return internalError();
  }
};

const updateNote: AuthenticatedHandler = async (event, auth) => {
  try {
    const noteId = event.pathParameters?.noteId;
    if (!noteId) {
      return validationError('Note ID is required');
    }

    const body = JSON.parse(event.body ?? '{}');
    const parsed = updateNoteSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { content } = parsed.data;

    // Note: In production, you might want to add a GSI for direct noteId lookup
    // For now, we require showSetId in the query params

    // For now, we'll require showSetId in the query params
    const showSetId = event.queryStringParameters?.showSetId;
    if (!showSetId) {
      return validationError('showSetId query parameter is required');
    }

    // Find note by scanning with showSetId
    const notesResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAMES.NOTES,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        FilterExpression: 'noteId = :noteId',
        ExpressionAttributeValues: {
          ':pk': `SHOWSET#${showSetId}`,
          ':skPrefix': 'NOTE#',
          ':noteId': noteId,
        },
      })
    );

    const existingNote = notesResult.Items?.[0] as (Note & { PK: string; SK: string }) | undefined;
    if (!existingNote) {
      return notFound('Note');
    }

    if (!canEditNote(existingNote.authorId, auth.userId)) {
      return forbidden('You can only edit your own notes');
    }

    const timestamp = now();

    // Update content in original language and reset translations
    const noteContent: Record<Language, string> = {
      en: existingNote.originalLang === 'en' ? content : '',
      zh: existingNote.originalLang === 'zh' ? content : '',
      'zh-TW': existingNote.originalLang === 'zh-TW' ? content : '',
    };

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.NOTES,
        Key: { PK: existingNote.PK, SK: existingNote.SK },
        UpdateExpression: 'SET content = :content, translationStatus = :status, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':content': noteContent,
          ':status': 'pending',
          ':updatedAt': timestamp,
        },
      })
    );

    // Queue re-translation
    const targetLanguages = getTargetLanguages(existingNote.originalLang);
    await queueTranslation({
      noteId,
      showSetId,
      originalLang: existingNote.originalLang,
      originalContent: content,
      targetLanguages,
    });

    return success({ message: 'Note updated successfully' });
  } catch (err) {
    console.error('Error updating note:', err);
    return internalError();
  }
};

const deleteNote: AuthenticatedHandler = async (event, auth) => {
  try {
    const noteId = event.pathParameters?.noteId;
    if (!noteId) {
      return validationError('Note ID is required');
    }

    const showSetId = event.queryStringParameters?.showSetId;
    if (!showSetId) {
      return validationError('showSetId query parameter is required');
    }

    // Find note
    const notesResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAMES.NOTES,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        FilterExpression: 'noteId = :noteId',
        ExpressionAttributeValues: {
          ':pk': `SHOWSET#${showSetId}`,
          ':skPrefix': 'NOTE#',
          ':noteId': noteId,
        },
      })
    );

    const existingNote = notesResult.Items?.[0] as (Note & { PK: string; SK: string }) | undefined;
    if (!existingNote) {
      return notFound('Note');
    }

    if (!canDeleteNote(auth.role, existingNote.authorId, auth.userId)) {
      return forbidden('You can only delete your own notes (admins can delete any)');
    }

    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAMES.NOTES,
        Key: { PK: existingNote.PK, SK: existingNote.SK },
      })
    );

    return success({ message: 'Note deleted successfully' });
  } catch (err) {
    console.error('Error deleting note:', err);
    return internalError();
  }
};

// Helper to find a note by ID
async function findNote(showSetId: string, noteId: string): Promise<(Note & { PK: string; SK: string }) | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAMES.NOTES,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      FilterExpression: 'noteId = :noteId',
      ExpressionAttributeValues: {
        ':pk': `SHOWSET#${showSetId}`,
        ':skPrefix': 'NOTE#',
        ':noteId': noteId,
      },
    })
  );
  return (result.Items?.[0] as (Note & { PK: string; SK: string }) | undefined) ?? null;
}

// Presign upload - get presigned URL for uploading a file
const presignUpload: AuthenticatedHandler = async (event, auth) => {
  try {
    const noteId = event.pathParameters?.noteId;
    const showSetId = event.queryStringParameters?.showSetId;

    if (!noteId) {
      return validationError('Note ID is required');
    }
    if (!showSetId) {
      return validationError('showSetId query parameter is required');
    }

    const body = JSON.parse(event.body ?? '{}');
    const parsed = presignUploadSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { fileName, mimeType, fileSize } = parsed.data;

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return validationError(`File type not allowed. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`);
    }

    // Check note exists and user can edit it
    const note = await findNote(showSetId, noteId);
    if (!note) {
      return notFound('Note');
    }

    if (!canEditNote(note.authorId, auth.userId)) {
      return forbidden('You can only add attachments to your own notes');
    }

    const attachmentId = generateId();
    const s3Key = `notes/${showSetId}/${noteId}/${attachmentId}/${fileName}`;

    // Generate presigned upload URL (valid for 10 minutes)
    const command = new PutObjectCommand({
      Bucket: ATTACHMENTS_BUCKET,
      Key: s3Key,
      ContentType: mimeType,
      ContentLength: fileSize,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 600 });

    return success({
      uploadUrl,
      attachmentId,
      s3Key,
    });
  } catch (err) {
    console.error('Error generating presigned URL:', err);
    return internalError();
  }
};

// Confirm upload - add attachment to note after upload is complete
const confirmUpload: AuthenticatedHandler = async (event, auth) => {
  try {
    const noteId = event.pathParameters?.noteId;
    const attachmentId = event.pathParameters?.attachmentId;
    const showSetId = event.queryStringParameters?.showSetId;

    if (!noteId || !attachmentId) {
      return validationError('Note ID and Attachment ID are required');
    }
    if (!showSetId) {
      return validationError('showSetId query parameter is required');
    }

    const body = JSON.parse(event.body ?? '{}');
    const { fileName, mimeType, fileSize, s3Key } = body;

    if (!fileName || !mimeType || !fileSize || !s3Key) {
      return validationError('fileName, mimeType, fileSize, and s3Key are required');
    }

    // Check note exists and user can edit it
    const note = await findNote(showSetId, noteId);
    if (!note) {
      return notFound('Note');
    }

    if (!canEditNote(note.authorId, auth.userId)) {
      return forbidden('You can only add attachments to your own notes');
    }

    const timestamp = now();
    const isPdf = mimeType === 'application/pdf';
    const attachment: NoteAttachment = {
      id: attachmentId,
      fileName,
      fileSize,
      mimeType,
      s3Key,
      uploadedAt: timestamp,
      // Set PDF translation status if this is a PDF
      ...(isPdf && { pdfTranslationStatus: 'pending' as const }),
    };

    // Add attachment to note
    const existingAttachments = note.attachments ?? [];
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.NOTES,
        Key: { PK: note.PK, SK: note.SK },
        UpdateExpression: 'SET attachments = :attachments, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':attachments': [...existingAttachments, attachment],
          ':updatedAt': timestamp,
        },
      })
    );

    // Queue PDF translation job if this is a PDF
    if (isPdf) {
      await queuePdfTranslation({
        noteId,
        attachmentId,
        showSetId,
        s3Key,
      });
    }

    return success(attachment, 201);
  } catch (err) {
    console.error('Error confirming upload:', err);
    return internalError();
  }
};

// Get attachment - generate presigned download URL
const getAttachment: AuthenticatedHandler = async (event) => {
  try {
    const noteId = event.pathParameters?.noteId;
    const attachmentId = event.pathParameters?.attachmentId;
    const showSetId = event.queryStringParameters?.showSetId;

    if (!noteId || !attachmentId) {
      return validationError('Note ID and Attachment ID are required');
    }
    if (!showSetId) {
      return validationError('showSetId query parameter is required');
    }

    // Find note and attachment
    const note = await findNote(showSetId, noteId);
    if (!note) {
      return notFound('Note');
    }

    const attachment = note.attachments?.find((a: NoteAttachment) => a.id === attachmentId);
    if (!attachment) {
      return notFound('Attachment');
    }

    // Generate presigned download URL (valid for 1 hour)
    const command = new GetObjectCommand({
      Bucket: ATTACHMENTS_BUCKET,
      Key: attachment.s3Key,
    });

    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return success({
      downloadUrl,
      attachment,
    });
  } catch (err) {
    console.error('Error generating download URL:', err);
    return internalError();
  }
};

// Delete attachment
const deleteAttachment: AuthenticatedHandler = async (event, auth) => {
  try {
    const noteId = event.pathParameters?.noteId;
    const attachmentId = event.pathParameters?.attachmentId;
    const showSetId = event.queryStringParameters?.showSetId;

    if (!noteId || !attachmentId) {
      return validationError('Note ID and Attachment ID are required');
    }
    if (!showSetId) {
      return validationError('showSetId query parameter is required');
    }

    // Find note
    const note = await findNote(showSetId, noteId);
    if (!note) {
      return notFound('Note');
    }

    if (!canEditNote(note.authorId, auth.userId)) {
      return forbidden('You can only delete attachments from your own notes');
    }

    const attachment = note.attachments?.find((a: NoteAttachment) => a.id === attachmentId);
    if (!attachment) {
      return notFound('Attachment');
    }

    // Delete from S3
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: ATTACHMENTS_BUCKET,
        Key: attachment.s3Key,
      })
    );

    // Remove from note
    const updatedAttachments = (note.attachments ?? []).filter((a: NoteAttachment) => a.id !== attachmentId);
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.NOTES,
        Key: { PK: note.PK, SK: note.SK },
        UpdateExpression: 'SET attachments = :attachments, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':attachments': updatedAttachments,
          ':updatedAt': now(),
        },
      })
    );

    return success({ message: 'Attachment deleted successfully' });
  } catch (err) {
    console.error('Error deleting attachment:', err);
    return internalError();
  }
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const resource = event.resource;

  const wrappedHandler = (fn: AuthenticatedHandler) =>
    withAuth(fn)(event, {} as never, () => {}) as Promise<APIGatewayProxyResult>;

  switch (`${method} ${resource}`) {
    case 'GET /showsets/{id}/notes':
      return await wrappedHandler(listNotes);
    case 'POST /showsets/{id}/notes':
      return await wrappedHandler(createNote);
    case 'PUT /notes/{noteId}':
      return await wrappedHandler(updateNote);
    case 'DELETE /notes/{noteId}':
      return await wrappedHandler(deleteNote);
    // Attachment endpoints
    case 'POST /notes/{noteId}/attachments/presign':
      return await wrappedHandler(presignUpload);
    case 'POST /notes/{noteId}/attachments/{attachmentId}/confirm':
      return await wrappedHandler(confirmUpload);
    case 'GET /notes/{noteId}/attachments/{attachmentId}':
      return await wrappedHandler(getAttachment);
    case 'DELETE /notes/{noteId}/attachments/{attachmentId}':
      return await wrappedHandler(deleteAttachment);
    default:
      return validationError('Unknown endpoint');
  }
};
