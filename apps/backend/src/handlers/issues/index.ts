import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { PutCommand, UpdateCommand, DeleteCommand, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  TABLE_NAMES,
  GSI_NAMES,
  docClient,
  keys,
  generateId,
  now,
} from '@unisync/db-utils';
import type { Issue, Language, TranslationJob, NoteAttachment, PdfTranslationJob, IssueMention, Note } from '@unisync/shared-types';
import {
  withAuth,
  canCreateIssue,
  canEditIssue,
  canDeleteIssue,
  canCloseIssue,
  type AuthenticatedHandler,
} from '../../middleware/authorize.js';
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
const createIssueSchema = z.object({
  content: z.string().min(1).max(5000),
  language: z.enum(['en', 'zh', 'zh-TW']),
  parentIssueId: z.string().optional(),
  mentions: z.array(z.string()).optional(),
  isRevisionNote: z.boolean().optional(),
});

const updateIssueSchema = z.object({
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

// Helper to convert legacy Note to Issue format
function noteToIssue(note: Note & { PK: string; SK: string }): Issue & { PK: string; SK: string } {
  return {
    ...note,
    issueId: note.noteId,
    parentIssueId: undefined,
    replyCount: 0,
    status: 'open',
    mentions: [],
  };
}

// Helper to find an issue by ID
async function findIssue(showSetId: string, issueId: string): Promise<(Issue & { PK: string; SK: string }) | null> {
  // First try to find as Issue
  const issueResult = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAMES.NOTES,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      FilterExpression: 'issueId = :issueId',
      ExpressionAttributeValues: {
        ':pk': `SHOWSET#${showSetId}`,
        ':skPrefix': 'ISSUE#',
        ':issueId': issueId,
      },
    })
  );

  if (issueResult.Items?.[0]) {
    return issueResult.Items[0] as Issue & { PK: string; SK: string };
  }

  // Fall back to legacy Note format
  const noteResult = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAMES.NOTES,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      FilterExpression: 'noteId = :noteId',
      ExpressionAttributeValues: {
        ':pk': `SHOWSET#${showSetId}`,
        ':skPrefix': 'NOTE#',
        ':noteId': issueId,
      },
    })
  );

  if (noteResult.Items?.[0]) {
    return noteToIssue(noteResult.Items[0] as Note & { PK: string; SK: string });
  }

  return null;
}

// Parse @mentions from content
function parseMentions(content: string): string[] {
  const mentionRegex = /@(\w+(?:\s+\w+)?)/g;
  const matches = content.matchAll(mentionRegex);
  return Array.from(matches, (m) => m[1]);
}

// Look up users by name for mentions
async function resolveUserMentions(userNames: string[]): Promise<IssueMention[]> {
  if (userNames.length === 0) return [];

  // Query users table to find users by name
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAMES.USERS,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': 'USERS',
      },
    })
  );

  const users = result.Items ?? [];
  const mentions: IssueMention[] = [];

  for (const userName of userNames) {
    const user = users.find(
      (u: Record<string, unknown>) =>
        (u.name as string)?.toLowerCase() === userName.toLowerCase()
    );
    if (user) {
      mentions.push({
        userId: user.userId as string,
        userName: user.name as string,
      });
    }
  }

  return mentions;
}

// Handlers
const listIssues: AuthenticatedHandler = async (event) => {
  try {
    const showSetId = event.pathParameters?.id;
    if (!showSetId) {
      return validationError('ShowSet ID is required');
    }

    // Query both Issues and legacy Notes
    const [issueResult, noteResult] = await Promise.all([
      docClient.send(
        new QueryCommand({
          TableName: TABLE_NAMES.NOTES,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': `SHOWSET#${showSetId}`,
            ':skPrefix': 'ISSUE#',
          },
          ScanIndexForward: false,
        })
      ),
      docClient.send(
        new QueryCommand({
          TableName: TABLE_NAMES.NOTES,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': `SHOWSET#${showSetId}`,
            ':skPrefix': 'NOTE#',
          },
          ScanIndexForward: false,
        })
      ),
    ]);

    // Convert legacy notes to issues
    const issues = issueResult.Items ?? [];
    const legacyNotes = (noteResult.Items ?? []).map((note) =>
      noteToIssue(note as Note & { PK: string; SK: string })
    );

    // Combine and sort by createdAt descending
    const allIssues = [...issues, ...legacyNotes].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Filter to only root issues (no parentIssueId) for the list view
    const rootIssues = allIssues.filter((issue) => !issue.parentIssueId);

    return success(rootIssues as Issue[]);
  } catch (err) {
    console.error('Error listing issues:', err);
    return internalError();
  }
};

const createIssue: AuthenticatedHandler = async (event, auth) => {
  try {
    const showSetId = event.pathParameters?.id;
    if (!showSetId) {
      return validationError('ShowSet ID is required');
    }

    if (!canCreateIssue(auth.role)) {
      return forbidden('View-only users cannot create issues');
    }

    const body = JSON.parse(event.body ?? '{}');
    const parsed = createIssueSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { content, language, parentIssueId, isRevisionNote } = parsed.data;
    const issueId = generateId();
    const timestamp = now();

    // Validate parent issue exists if provided
    if (parentIssueId) {
      const parentIssue = await findIssue(showSetId, parentIssueId);
      if (!parentIssue) {
        return validationError('Parent issue not found');
      }
    }

    // Parse @mentions from content
    const mentionedNames = parseMentions(content);
    const resolvedMentions = await resolveUserMentions(mentionedNames);

    // Initialize content with original language
    const issueContent: Record<Language, string> = {
      en: language === 'en' ? content : '',
      zh: language === 'zh' ? content : '',
      'zh-TW': language === 'zh-TW' ? content : '',
    };

    const issue: Issue & { PK: string; SK: string; GSI1PK: string; GSI1SK: string } = {
      ...keys.issue(showSetId, timestamp, issueId),
      ...keys.issueAuthor(auth.userId, timestamp, issueId),
      issueId,
      showSetId,
      parentIssueId,
      replyCount: 0,
      authorId: auth.userId,
      authorName: auth.name,
      originalLang: language,
      content: issueContent,
      translationStatus: 'pending',
      status: 'open',
      mentions: resolvedMentions,
      attachments: [],
      isRevisionNote: isRevisionNote ?? false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // Create mention index entries
    const mentionItems = resolvedMentions.map((mention) => ({
      PutRequest: {
        Item: {
          ...keys.issueMention(mention.userId, showSetId, timestamp, issueId),
          issueId,
          showSetId,
          mentionedUserId: mention.userId,
          mentionedUserName: mention.userName,
          authorId: auth.userId,
          authorName: auth.name,
          createdAt: timestamp,
          itemType: 'MENTION_INDEX',
        },
      },
    }));

    // Write issue and mention indexes in batch
    const writeRequests = [{ PutRequest: { Item: issue } }, ...mentionItems];

    // DynamoDB BatchWrite has a limit of 25 items
    for (let i = 0; i < writeRequests.length; i += 25) {
      const batch = writeRequests.slice(i, i + 25);
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE_NAMES.NOTES]: batch,
          },
        })
      );
    }

    // If this is a reply, increment parent's reply count
    if (parentIssueId) {
      const parentIssue = await findIssue(showSetId, parentIssueId);
      if (parentIssue) {
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAMES.NOTES,
            Key: { PK: parentIssue.PK, SK: parentIssue.SK },
            UpdateExpression: 'SET replyCount = if_not_exists(replyCount, :zero) + :one, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
              ':zero': 0,
              ':one': 1,
              ':updatedAt': timestamp,
            },
          })
        );
      }
    }

    // Queue translation job
    const targetLanguages = getTargetLanguages(language);
    await queueTranslation({
      noteId: issueId, // Reuse noteId field for translation
      showSetId,
      originalLang: language,
      originalContent: content,
      targetLanguages,
    });

    // Log activity
    await logActivity(showSetId, auth.userId, auth.name, parentIssueId ? 'issue_reply_added' : 'issue_created', {
      issueId,
      parentIssueId,
      isRevisionNote: isRevisionNote ?? false,
      mentionCount: resolvedMentions.length,
    });

    return success(issue, 201);
  } catch (err) {
    console.error('Error creating issue:', err);
    return internalError();
  }
};

const getIssue: AuthenticatedHandler = async (event) => {
  try {
    const issueId = event.pathParameters?.issueId;
    const showSetId = event.queryStringParameters?.showSetId;

    if (!issueId) {
      return validationError('Issue ID is required');
    }
    if (!showSetId) {
      return validationError('showSetId query parameter is required');
    }

    const issue = await findIssue(showSetId, issueId);
    if (!issue) {
      return notFound('Issue');
    }

    // Get replies for this issue
    const repliesResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAMES.NOTES,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        FilterExpression: 'parentIssueId = :parentId',
        ExpressionAttributeValues: {
          ':pk': `SHOWSET#${showSetId}`,
          ':skPrefix': 'ISSUE#',
          ':parentId': issueId,
        },
        ScanIndexForward: true, // Oldest first for replies
      })
    );

    const replies = repliesResult.Items ?? [];

    return success({
      issue,
      replies,
    });
  } catch (err) {
    console.error('Error getting issue:', err);
    return internalError();
  }
};

const updateIssue: AuthenticatedHandler = async (event, auth) => {
  try {
    const issueId = event.pathParameters?.issueId;
    const showSetId = event.queryStringParameters?.showSetId;

    if (!issueId) {
      return validationError('Issue ID is required');
    }
    if (!showSetId) {
      return validationError('showSetId query parameter is required');
    }

    const body = JSON.parse(event.body ?? '{}');
    const parsed = updateIssueSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { content } = parsed.data;

    const issue = await findIssue(showSetId, issueId);
    if (!issue) {
      return notFound('Issue');
    }

    if (!canEditIssue(issue.authorId, auth.userId)) {
      return forbidden('You can only edit your own issues');
    }

    const timestamp = now();

    // Parse new mentions
    const mentionedNames = parseMentions(content);
    const resolvedMentions = await resolveUserMentions(mentionedNames);

    // Update content in original language and reset translations
    const issueContent: Record<Language, string> = {
      en: issue.originalLang === 'en' ? content : '',
      zh: issue.originalLang === 'zh' ? content : '',
      'zh-TW': issue.originalLang === 'zh-TW' ? content : '',
    };

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.NOTES,
        Key: { PK: issue.PK, SK: issue.SK },
        UpdateExpression: 'SET content = :content, translationStatus = :status, mentions = :mentions, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':content': issueContent,
          ':status': 'pending',
          ':mentions': resolvedMentions,
          ':updatedAt': timestamp,
        },
      })
    );

    // Queue re-translation
    const targetLanguages = getTargetLanguages(issue.originalLang);
    await queueTranslation({
      noteId: issueId,
      showSetId,
      originalLang: issue.originalLang,
      originalContent: content,
      targetLanguages,
    });

    return success({ message: 'Issue updated successfully' });
  } catch (err) {
    console.error('Error updating issue:', err);
    return internalError();
  }
};

const deleteIssue: AuthenticatedHandler = async (event, auth) => {
  try {
    const issueId = event.pathParameters?.issueId;
    const showSetId = event.queryStringParameters?.showSetId;

    if (!issueId) {
      return validationError('Issue ID is required');
    }
    if (!showSetId) {
      return validationError('showSetId query parameter is required');
    }

    const issue = await findIssue(showSetId, issueId);
    if (!issue) {
      return notFound('Issue');
    }

    if (!canDeleteIssue(auth.role, issue.authorId, auth.userId)) {
      return forbidden('You can only delete your own issues (admins can delete any)');
    }

    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAMES.NOTES,
        Key: { PK: issue.PK, SK: issue.SK },
      })
    );

    // If this was a reply, decrement parent's reply count
    if (issue.parentIssueId) {
      const parentIssue = await findIssue(showSetId, issue.parentIssueId);
      if (parentIssue) {
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAMES.NOTES,
            Key: { PK: parentIssue.PK, SK: parentIssue.SK },
            UpdateExpression: 'SET replyCount = replyCount - :one, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
              ':one': 1,
              ':updatedAt': now(),
            },
          })
        );
      }
    }

    return success({ message: 'Issue deleted successfully' });
  } catch (err) {
    console.error('Error deleting issue:', err);
    return internalError();
  }
};

const closeIssue: AuthenticatedHandler = async (event, auth) => {
  try {
    const issueId = event.pathParameters?.issueId;
    const showSetId = event.queryStringParameters?.showSetId;

    if (!issueId) {
      return validationError('Issue ID is required');
    }
    if (!showSetId) {
      return validationError('showSetId query parameter is required');
    }

    const issue = await findIssue(showSetId, issueId);
    if (!issue) {
      return notFound('Issue');
    }

    if (!canCloseIssue(auth.role, issue.authorId, auth.userId)) {
      return forbidden('Only the creator or an admin can close this issue');
    }

    if (issue.status === 'closed') {
      return validationError('Issue is already closed');
    }

    const timestamp = now();

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.NOTES,
        Key: { PK: issue.PK, SK: issue.SK },
        UpdateExpression: 'SET #status = :status, closedAt = :closedAt, closedBy = :closedBy, closedByName = :closedByName, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'closed',
          ':closedAt': timestamp,
          ':closedBy': auth.userId,
          ':closedByName': auth.name,
          ':updatedAt': timestamp,
        },
      })
    );

    await logActivity(showSetId, auth.userId, auth.name, 'issue_closed', {
      issueId,
    });

    return success({ message: 'Issue closed successfully' });
  } catch (err) {
    console.error('Error closing issue:', err);
    return internalError();
  }
};

const reopenIssue: AuthenticatedHandler = async (event, auth) => {
  try {
    const issueId = event.pathParameters?.issueId;
    const showSetId = event.queryStringParameters?.showSetId;

    if (!issueId) {
      return validationError('Issue ID is required');
    }
    if (!showSetId) {
      return validationError('showSetId query parameter is required');
    }

    const issue = await findIssue(showSetId, issueId);
    if (!issue) {
      return notFound('Issue');
    }

    if (!canCloseIssue(auth.role, issue.authorId, auth.userId)) {
      return forbidden('Only the creator or an admin can reopen this issue');
    }

    if (issue.status === 'open') {
      return validationError('Issue is already open');
    }

    const timestamp = now();

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.NOTES,
        Key: { PK: issue.PK, SK: issue.SK },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt REMOVE closedAt, closedBy, closedByName',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'open',
          ':updatedAt': timestamp,
        },
      })
    );

    await logActivity(showSetId, auth.userId, auth.name, 'issue_reopened', {
      issueId,
    });

    return success({ message: 'Issue reopened successfully' });
  } catch (err) {
    console.error('Error reopening issue:', err);
    return internalError();
  }
};

const getMyIssues: AuthenticatedHandler = async (_event, auth) => {
  try {
    // Query issues created by this user (GSI1)
    const createdByMeResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAMES.NOTES,
        IndexName: GSI_NAMES.ISSUE_AUTHOR_INDEX,
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `USER#${auth.userId}`,
          ':skPrefix': 'ISSUE#',
        },
        ScanIndexForward: false,
        Limit: 50,
      })
    );

    // Query issues where user is mentioned (GSI2)
    const mentionedInResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAMES.NOTES,
        IndexName: GSI_NAMES.ISSUE_MENTION_INDEX,
        KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `MENTION#${auth.userId}`,
          ':skPrefix': 'ISSUE#',
        },
        ScanIndexForward: false,
        Limit: 50,
      })
    );

    const createdByMe = (createdByMeResult.Items ?? []) as Issue[];
    const mentionedIn = (mentionedInResult.Items ?? []).filter(
      (item: Record<string, unknown>) => item.itemType !== 'MENTION_INDEX'
    ) as Issue[];

    // Count open issues where user is author or mentioned
    const openCount = createdByMe.filter((i) => i.status === 'open' && !i.parentIssueId).length +
      mentionedIn.filter((i) => i.status === 'open' && !i.parentIssueId).length;

    return success({
      createdByMe: createdByMe.filter((i) => !i.parentIssueId), // Only root issues
      mentionedIn: mentionedIn.filter((i) => !i.parentIssueId),
      openCount,
    });
  } catch (err) {
    console.error('Error getting my issues:', err);
    return internalError();
  }
};

// Attachment handlers (reuse from notes)
const presignUpload: AuthenticatedHandler = async (event, auth) => {
  try {
    const issueId = event.pathParameters?.issueId;
    const showSetId = event.queryStringParameters?.showSetId;

    if (!issueId) {
      return validationError('Issue ID is required');
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

    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return validationError(`File type not allowed. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`);
    }

    const issue = await findIssue(showSetId, issueId);
    if (!issue) {
      return notFound('Issue');
    }

    if (!canEditIssue(issue.authorId, auth.userId)) {
      return forbidden('You can only add attachments to your own issues');
    }

    const attachmentId = generateId();
    const s3Key = `issues/${showSetId}/${issueId}/${attachmentId}/${fileName}`;

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

const confirmUpload: AuthenticatedHandler = async (event, auth) => {
  try {
    const issueId = event.pathParameters?.issueId;
    const attachmentId = event.pathParameters?.attachmentId;
    const showSetId = event.queryStringParameters?.showSetId;

    if (!issueId || !attachmentId) {
      return validationError('Issue ID and Attachment ID are required');
    }
    if (!showSetId) {
      return validationError('showSetId query parameter is required');
    }

    const body = JSON.parse(event.body ?? '{}');
    const { fileName, mimeType, fileSize, s3Key } = body;

    if (!fileName || !mimeType || !fileSize || !s3Key) {
      return validationError('fileName, mimeType, fileSize, and s3Key are required');
    }

    const issue = await findIssue(showSetId, issueId);
    if (!issue) {
      return notFound('Issue');
    }

    if (!canEditIssue(issue.authorId, auth.userId)) {
      return forbidden('You can only add attachments to your own issues');
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
      ...(isPdf && { pdfTranslationStatus: 'pending' as const }),
    };

    const existingAttachments = issue.attachments ?? [];
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.NOTES,
        Key: { PK: issue.PK, SK: issue.SK },
        UpdateExpression: 'SET attachments = :attachments, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':attachments': [...existingAttachments, attachment],
          ':updatedAt': timestamp,
        },
      })
    );

    if (isPdf) {
      await queuePdfTranslation({
        noteId: issueId,
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

const getAttachment: AuthenticatedHandler = async (event) => {
  try {
    const issueId = event.pathParameters?.issueId;
    const attachmentId = event.pathParameters?.attachmentId;
    const showSetId = event.queryStringParameters?.showSetId;

    if (!issueId || !attachmentId) {
      return validationError('Issue ID and Attachment ID are required');
    }
    if (!showSetId) {
      return validationError('showSetId query parameter is required');
    }

    const issue = await findIssue(showSetId, issueId);
    if (!issue) {
      return notFound('Issue');
    }

    const attachment = issue.attachments?.find((a: NoteAttachment) => a.id === attachmentId);
    if (!attachment) {
      return notFound('Attachment');
    }

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

const deleteAttachment: AuthenticatedHandler = async (event, auth) => {
  try {
    const issueId = event.pathParameters?.issueId;
    const attachmentId = event.pathParameters?.attachmentId;
    const showSetId = event.queryStringParameters?.showSetId;

    if (!issueId || !attachmentId) {
      return validationError('Issue ID and Attachment ID are required');
    }
    if (!showSetId) {
      return validationError('showSetId query parameter is required');
    }

    const issue = await findIssue(showSetId, issueId);
    if (!issue) {
      return notFound('Issue');
    }

    if (!canEditIssue(issue.authorId, auth.userId)) {
      return forbidden('You can only delete attachments from your own issues');
    }

    const attachment = issue.attachments?.find((a: NoteAttachment) => a.id === attachmentId);
    if (!attachment) {
      return notFound('Attachment');
    }

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: ATTACHMENTS_BUCKET,
        Key: attachment.s3Key,
      })
    );

    const updatedAttachments = (issue.attachments ?? []).filter((a: NoteAttachment) => a.id !== attachmentId);
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.NOTES,
        Key: { PK: issue.PK, SK: issue.SK },
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
    // Issue CRUD
    case 'GET /showsets/{id}/issues':
      return await wrappedHandler(listIssues);
    case 'POST /showsets/{id}/issues':
      return await wrappedHandler(createIssue);
    case 'GET /issues/{issueId}':
      return await wrappedHandler(getIssue);
    case 'PUT /issues/{issueId}':
      return await wrappedHandler(updateIssue);
    case 'DELETE /issues/{issueId}':
      return await wrappedHandler(deleteIssue);
    // Reply (same as create but with parentIssueId)
    case 'POST /issues/{issueId}/replies':
      // Redirect to create with parentIssueId
      const issueIdForReply = event.pathParameters?.issueId; // Save before overwriting
      event.pathParameters = { id: event.queryStringParameters?.showSetId };
      const body = JSON.parse(event.body ?? '{}');
      body.parentIssueId = issueIdForReply;
      event.body = JSON.stringify(body);
      return await wrappedHandler(createIssue);
    // Status changes
    case 'POST /issues/{issueId}/close':
      return await wrappedHandler(closeIssue);
    case 'POST /issues/{issueId}/reopen':
      return await wrappedHandler(reopenIssue);
    // My issues
    case 'GET /issues/my-issues':
      return await wrappedHandler(getMyIssues);
    // Attachment endpoints
    case 'POST /issues/{issueId}/attachments/presign':
      return await wrappedHandler(presignUpload);
    case 'POST /issues/{issueId}/attachments/{attachmentId}/confirm':
      return await wrappedHandler(confirmUpload);
    case 'GET /issues/{issueId}/attachments/{attachmentId}':
      return await wrappedHandler(getAttachment);
    case 'DELETE /issues/{issueId}/attachments/{attachmentId}':
      return await wrappedHandler(deleteAttachment);
    default:
      return validationError('Unknown endpoint');
  }
};
