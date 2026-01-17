import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { PutCommand, UpdateCommand, DeleteCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import {
  TABLE_NAMES,
  docClient,
  keys,
  generateId,
  now,
} from '@unisync/db-utils';
import type { Note, Language, TranslationJob } from '@unisync/shared-types';
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

const TRANSLATION_QUEUE_URL = process.env.TRANSLATION_QUEUE_URL!;

// Schemas
const createNoteSchema = z.object({
  content: z.string().min(1).max(5000),
  language: z.enum(['en', 'zh', 'zh-TW']),
});

const updateNoteSchema = z.object({
  content: z.string().min(1).max(5000),
});

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

    const { content, language } = parsed.data;
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

    // Find the note (we need to scan since we don't have the full key)
    // In production, you might want to include showSetId in the request
    const scanResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAMES.NOTES,
        IndexName: 'GSI1-note-id-index', // Would need to add this GSI
        KeyConditionExpression: 'noteId = :noteId',
        ExpressionAttributeValues: {
          ':noteId': noteId,
        },
      })
    );

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

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const resource = event.resource;

  const wrappedHandler = (fn: AuthenticatedHandler) =>
    withAuth(fn)(event, {} as never, () => {});

  switch (`${method} ${resource}`) {
    case 'GET /showsets/{id}/notes':
      return wrappedHandler(listNotes);
    case 'POST /showsets/{id}/notes':
      return wrappedHandler(createNote);
    case 'PUT /notes/{noteId}':
      return wrappedHandler(updateNote);
    case 'DELETE /notes/{noteId}':
      return wrappedHandler(deleteNote);
    default:
      return validationError('Unknown endpoint');
  }
};
