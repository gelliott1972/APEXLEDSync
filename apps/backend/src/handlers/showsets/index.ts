import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { PutCommand, UpdateCommand, DeleteCommand, QueryCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  TABLE_NAMES,
  GSI_NAMES,
  docClient,
  keys,
  generateId,
  now,
} from '@unisync/db-utils';
import type {
  ShowSet,
  StageStatus,
  StageName,
  Area,
  ShowSetStages,
  VersionType,
  VersionHistoryEntry,
  Note,
  Language,
  TranslationJob,
} from '@unisync/shared-types';
import { ENGINEER_ALLOWED_STATUSES, CUSTOMER_REVIEWER_ALLOWED_STATUSES } from '@unisync/shared-types';
import { withAuth, canUpdateStage, canManageLinks, type AuthenticatedHandler } from '../../middleware/authorize.js';
import {
  success,
  validationError,
  notFound,
  forbidden,
  internalError,
} from '../../lib/response.js';
import { canManageShowSets, isEngineer, isCustomerReviewer, isViewOnly, canRequestUpstreamRevision } from '../../lib/auth.js';

// SQS client for translation queue
const sqsClient = new SQSClient({
  region: process.env.AWS_REGION ?? 'ap-east-1',
});

// S3 client for attachment uploads
const s3Client = new S3Client({
  region: process.env.AWS_REGION ?? 'ap-east-1',
});

const TRANSLATION_QUEUE_URL = process.env.TRANSLATION_QUEUE_URL!;
const ATTACHMENTS_BUCKET = process.env.ATTACHMENTS_BUCKET!;

// Allowed MIME types for revision attachments
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

// Create a revision note in the notes table
async function createRevisionNote(
  showSetId: string,
  _stageName: StageName, // Kept for potential future use (e.g., prefixing note content)
  content: string,
  language: Language,
  userId: string,
  userName: string
): Promise<string> {
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
    authorId: userId,
    authorName: userName,
    originalLang: language,
    content: noteContent,
    translationStatus: 'pending',
    attachments: [],
    isRevisionNote: true,
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

  return noteId;
}

// Schemas
const localizedStringSchema = z.object({
  en: z.string(),
  zh: z.string(),
  'zh-TW': z.string(),
});

const vmItemSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
});

const createShowSetSchema = z.object({
  showSetId: z.string().regex(/^SS-\d{2}[A-Za-z]?-\d{2}$/, 'ShowSet ID must be in format SS-XX-XX or SS-XXY-XX'),
  area: z.enum(['311', '312']),
  scene: z.string().regex(/^SC\d{2}$/, 'Scene must be in format SCXX'),
  description: localizedStringSchema,
  vmList: z.array(vmItemSchema).optional(),
});

const updateShowSetSchema = z.object({
  showSetId: z.string().regex(/^SS-\d{2}[A-Za-z]?-\d{2}$/, 'ShowSet ID must be in format SS-XX-XX or SS-XXY-XX').optional(),
  area: z.enum(['311', '312']).optional(),
  scene: z.string().optional(),
  description: localizedStringSchema.optional(),
  vmList: z.array(vmItemSchema).optional(),
});

const stageUpdateSchema = z.object({
  status: z.enum(['not_started', 'in_progress', 'complete', 'on_hold', 'client_review', 'engineer_review', 'revision_required']),
  assignedTo: z.string().nullable().optional(),
  version: z.string().optional(),
  revisionNote: z.string().optional(), // Required when setting revision_required, optional for recall
  revisionNoteLang: z.enum(['en', 'zh', 'zh-TW']).optional(),
  // Recall from review: target stage to start working on
  recallTarget: z.enum(['screen', 'structure', 'integrated', 'inBim360', 'drawing2d']).optional(),
  // Recall from review: stage that was in review when recall initiated
  recallFrom: z.enum(['screen', 'structure', 'integrated', 'inBim360', 'drawing2d']).optional(),
});

// Schema for manual version update - 3 deliverables
const versionUpdateSchema = z.object({
  versionType: z.enum(['screenVersion', 'revitVersion', 'drawingVersion']),
  reason: z.string().optional().default(''),
  language: z.enum(['en', 'zh', 'zh-TW']),
  targetVersion: z.number().int().positive().optional(), // If provided, set to this version directly
});

// Map stage to version type - 3 deliverables (structure + integrated share revitVersion)
function getVersionTypeForStage(stage: StageName): VersionType | null {
  switch (stage) {
    case 'screen':
      return 'screenVersion';
    case 'structure':
    case 'integrated':
      return 'revitVersion';  // Both share the same Revit model version
    case 'inBim360':
      return null;            // No version - just uploads to BIM360 cloud
    case 'drawing2d':
      return 'drawingVersion';
    default:
      return null;
  }
}

// Stages that support revision_required
const REVISION_STAGES: StageName[] = ['integrated', 'inBim360', 'drawing2d'];

// Stage order for cascade resets
const STAGE_ORDER: StageName[] = ['screen', 'structure', 'integrated', 'inBim360', 'drawing2d'];

// Get downstream stages (stages that come after the given stage)
function getDownstreamStages(stage: StageName): StageName[] {
  const idx = STAGE_ORDER.indexOf(stage);
  if (idx === -1) return [];
  return STAGE_ORDER.slice(idx + 1);
}

const linksUpdateSchema = z.object({
  modelUrl: z.string().url().nullable().optional(),
  drawingsUrl: z.string().url().nullable().optional(),
});

// Schema for upstream revision request
const upstreamRevisionSchema = z.object({
  targetStages: z.array(z.enum(['screen', 'structure', 'integrated', 'inBim360', 'drawing2d'])).min(1),
  currentStage: z.enum(['screen', 'structure', 'integrated', 'inBim360', 'drawing2d']),
  revisionNote: z.string().min(1, 'Revision note is required'),
  revisionNoteLang: z.enum(['en', 'zh', 'zh-TW']),
  // Optional attachment metadata for uploading a file with the revision request
  attachment: z.object({
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(100),
    fileSize: z.number().positive().max(50 * 1024 * 1024), // Max 50MB
  }).optional(),
});

// Initialize default stages
function createDefaultStages(userId: string): ShowSetStages {
  const timestamp = now();
  const defaultStage = {
    status: 'not_started' as StageStatus,
    updatedBy: userId,
    updatedAt: timestamp,
  };

  return {
    screen: { ...defaultStage },
    structure: { ...defaultStage },
    integrated: { ...defaultStage },
    inBim360: { status: 'not_started', updatedBy: userId, updatedAt: timestamp },
    drawing2d: { ...defaultStage },
  };
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
const listShowSets: AuthenticatedHandler = async (event) => {
  try {
    const area = event.queryStringParameters?.area as Area | undefined;

    let items: ShowSet[];

    if (area) {
      // Query by area using GSI
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAMES.SHOWSETS,
          IndexName: GSI_NAMES.AREA_INDEX,
          KeyConditionExpression: 'GSI1PK = :areaPk',
          ExpressionAttributeValues: {
            ':areaPk': `AREA#${area}`,
          },
        })
      );
      items = (result.Items ?? []) as ShowSet[];
    } else {
      // Scan all showsets (filter by PK prefix)
      const result = await docClient.send(
        new ScanCommand({
          TableName: TABLE_NAMES.SHOWSETS,
          FilterExpression: 'begins_with(PK, :prefix)',
          ExpressionAttributeValues: {
            ':prefix': 'SHOWSET#',
          },
        })
      );
      items = (result.Items ?? []) as ShowSet[];
    }

    return success(items);
  } catch (err) {
    console.error('Error listing showsets:', err);
    return internalError();
  }
};

const getShowSet: AuthenticatedHandler = async (event) => {
  try {
    const showSetId = event.pathParameters?.id;
    if (!showSetId) {
      return validationError('ShowSet ID is required');
    }

    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAMES.SHOWSETS,
        Key: keys.showSet(showSetId),
      })
    );

    if (!result.Item) {
      return notFound('ShowSet');
    }

    return success(result.Item as ShowSet);
  } catch (err) {
    console.error('Error getting showset:', err);
    return internalError();
  }
};

const createShowSet: AuthenticatedHandler = async (event, auth) => {
  try {
    if (!canManageShowSets(auth.role)) {
      return forbidden('Only admins can create ShowSets');
    }

    const body = JSON.parse(event.body ?? '{}');
    const parsed = createShowSetSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { showSetId, area, scene, description, vmList } = parsed.data;
    const timestamp = now();

    // Check if showset already exists
    const existing = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAMES.SHOWSETS,
        Key: keys.showSet(showSetId),
      })
    );

    if (existing.Item) {
      return validationError('ShowSet already exists');
    }

    const showSet: ShowSet & { PK: string; SK: string; GSI1PK: string; GSI1SK: string } = {
      ...keys.showSet(showSetId),
      ...keys.showSetArea(area, showSetId),
      showSetId,
      area,
      scene,
      description,
      vmList: vmList ?? [],
      stages: createDefaultStages(auth.userId),
      links: {
        modelUrl: null,
        drawingsUrl: null,
      },
      // Version tracking - 3 deliverables, initialize to v1
      screenVersion: 1,
      revitVersion: 1,       // Shared by structure + integrated stages
      drawingVersion: 1,
      versionHistory: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAMES.SHOWSETS,
        Item: showSet,
      })
    );

    await logActivity(showSetId, auth.userId, auth.name, 'showset_created', {});

    return success(showSet, 201);
  } catch (err) {
    console.error('Error creating showset:', err);
    return internalError();
  }
};

const updateShowSet: AuthenticatedHandler = async (event, auth) => {
  try {
    if (!canManageShowSets(auth.role)) {
      return forbidden('Only admins can update ShowSet details');
    }

    const currentShowSetId = event.pathParameters?.id;
    if (!currentShowSetId) {
      return validationError('ShowSet ID is required');
    }

    const body = JSON.parse(event.body ?? '{}');
    const parsed = updateShowSetSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { showSetId: newShowSetId, area, scene, description, vmList } = parsed.data;

    if (!newShowSetId && !area && !scene && !description && !vmList) {
      return validationError('At least one field must be provided');
    }

    // If showSetId is being changed, we need to copy the item to a new key and delete the old one
    if (newShowSetId && newShowSetId !== currentShowSetId) {
      // Check if new ID already exists
      const existingNew = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAMES.SHOWSETS,
          Key: keys.showSet(newShowSetId),
        })
      );

      if (existingNew.Item) {
        return validationError('A ShowSet with that ID already exists');
      }

      // Get the current item
      const currentResult = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAMES.SHOWSETS,
          Key: keys.showSet(currentShowSetId),
        })
      );

      if (!currentResult.Item) {
        return notFound('ShowSet');
      }

      const currentItem = currentResult.Item as ShowSet & { PK: string; SK: string; GSI1PK: string; GSI1SK: string };
      const timestamp = now();

      // Create new item with updated values
      const newItem = {
        ...currentItem,
        ...keys.showSet(newShowSetId),
        ...keys.showSetArea(area ?? currentItem.area, newShowSetId),
        showSetId: newShowSetId,
        area: area ?? currentItem.area,
        scene: scene ?? currentItem.scene,
        description: description ?? currentItem.description,
        vmList: vmList ?? currentItem.vmList,
        updatedAt: timestamp,
      };

      // Write new item
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAMES.SHOWSETS,
          Item: newItem,
        })
      );

      // Delete old item
      await docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAMES.SHOWSETS,
          Key: keys.showSet(currentShowSetId),
        })
      );

      // Log the ID change
      await logActivity(newShowSetId, auth.userId, auth.name, 'showset_renamed', {
        from: currentShowSetId,
        to: newShowSetId,
      });

      return success({ message: 'ShowSet updated successfully', newShowSetId });
    }

    // Standard update without ID change
    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {};

    if (area) {
      updateExpressions.push('#area = :area');
      expressionAttributeNames['#area'] = 'area';
      expressionAttributeValues[':area'] = area;
      // Update GSI1 for area lookup
      updateExpressions.push('GSI1PK = :gsi1pk');
      expressionAttributeValues[':gsi1pk'] = `AREA#${area}`;
    }

    if (scene) {
      updateExpressions.push('#scene = :scene');
      expressionAttributeNames['#scene'] = 'scene';
      expressionAttributeValues[':scene'] = scene;
    }

    if (description) {
      updateExpressions.push('#description = :description');
      expressionAttributeNames['#description'] = 'description';
      expressionAttributeValues[':description'] = description;
    }

    if (vmList) {
      updateExpressions.push('#vmList = :vmList');
      expressionAttributeNames['#vmList'] = 'vmList';
      expressionAttributeValues[':vmList'] = vmList;
    }

    updateExpressions.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = now();

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.SHOWSETS,
        Key: keys.showSet(currentShowSetId),
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ConditionExpression: 'attribute_exists(PK)',
      })
    );

    return success({ message: 'ShowSet updated successfully' });
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      return notFound('ShowSet');
    }
    console.error('Error updating showset:', err);
    return internalError();
  }
};

const deleteShowSet: AuthenticatedHandler = async (event, auth) => {
  try {
    if (auth.role !== 'admin') {
      return forbidden('Only admins can delete ShowSets');
    }

    const showSetId = event.pathParameters?.id;
    if (!showSetId) {
      return validationError('ShowSet ID is required');
    }

    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAMES.SHOWSETS,
        Key: keys.showSet(showSetId),
        ConditionExpression: 'attribute_exists(PK)',
      })
    );

    return success({ message: 'ShowSet deleted successfully' });
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      return notFound('ShowSet');
    }
    console.error('Error deleting showset:', err);
    return internalError();
  }
};

const updateStage: AuthenticatedHandler = async (event, auth) => {
  try {
    const showSetId = event.pathParameters?.id;
    const stageName = event.pathParameters?.stage as StageName;

    if (!showSetId || !stageName) {
      return validationError('ShowSet ID and stage name are required');
    }

    const validStages: StageName[] = ['screen', 'structure', 'integrated', 'inBim360', 'drawing2d'];
    if (!validStages.includes(stageName)) {
      return validationError('Invalid stage name');
    }

    if (!canUpdateStage(auth.role, stageName)) {
      return forbidden(`You do not have permission to update the ${stageName} stage`);
    }

    const body = JSON.parse(event.body ?? '{}');
    const parsed = stageUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { status, assignedTo, version, revisionNote, revisionNoteLang, recallTarget, recallFrom } = parsed.data;

    // View-only users cannot update any stages
    if (isViewOnly(auth.role)) {
      return forbidden('View-only users cannot update stages');
    }

    // Engineers can only approve (complete) or request revision
    if (isEngineer(auth.role) && !ENGINEER_ALLOWED_STATUSES.includes(status)) {
      return forbidden('Engineers can only approve (complete) or request revision');
    }

    // Customer reviewers can only approve/reject and only for stages in client_review status
    if (isCustomerReviewer(auth.role)) {
      if (!CUSTOMER_REVIEWER_ALLOWED_STATUSES.includes(status)) {
        return forbidden('Customer reviewers can only approve (complete) or request revision');
      }
    }

    // Validate revision_required - only valid for certain stages and requires a note
    // Exception: revision_required without note is allowed for recall cascades (we set a default message)
    if (status === 'revision_required' && !recallTarget) {
      if (!REVISION_STAGES.includes(stageName)) {
        return validationError('revision_required status is only valid for Integrated, InBim360, and Drawing2d stages');
      }
      if (!revisionNote || !revisionNoteLang) {
        return validationError('A revision note is required when setting revision_required status');
      }
    }

    // Get current state for activity logging and version tracking
    const current = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAMES.SHOWSETS,
        Key: keys.showSet(showSetId),
      })
    );

    if (!current.Item) {
      return notFound('ShowSet');
    }

    const currentShowSet = current.Item as ShowSet;
    const currentStage = currentShowSet.stages[stageName];
    const timestamp = now();

    // Engineer can only update stages that are in engineer_review status
    if (isEngineer(auth.role) && currentStage.status !== 'engineer_review') {
      return forbidden('Engineers can only review stages that are in Engineer Review status');
    }

    // Customer reviewer can only update stages that are in client_review status
    if (isCustomerReviewer(auth.role) && currentStage.status !== 'client_review') {
      return forbidden('Customer reviewers can only review stages that are in Client Review status');
    }

    // Check if ShowSet is locked (completed and not unlocked)
    if (isShowSetLocked(currentShowSet) && status === 'in_progress') {
      return forbidden('ShowSet is locked. An admin must unlock it before changes can be made.');
    }

    // Handle recall from review - special case
    if (recallTarget && recallFrom) {
      // Validate that recallFrom is in a review state
      const recallFromStage = currentShowSet.stages[recallFrom];
      if (recallFromStage.status !== 'engineer_review' && recallFromStage.status !== 'client_review') {
        return validationError('Recall is only valid when the source stage is in review');
      }

      // Validate that recallTarget is upstream of or equal to recallFrom
      const targetIdx = STAGE_ORDER.indexOf(recallTarget);
      const fromIdx = STAGE_ORDER.indexOf(recallFrom);
      if (targetIdx > fromIdx) {
        return validationError('Recall target must be upstream of or equal to the review stage');
      }

      // Check permission for the target stage
      if (!canUpdateStage(auth.role, recallTarget)) {
        return forbidden(`You do not have permission to update the ${recallTarget} stage`);
      }

      // Build the update expression for recall
      const recallTimestamp = now();
      const targetVType = getVersionTypeForStage(recallTarget);
      let recallNewVersion: number | undefined;
      let recallVersionEntry: VersionHistoryEntry | undefined;

      // Increment version on target if starting work (in_progress)
      if (status === 'in_progress' && targetVType) {
        let currentVer: number;
        if (targetVType === 'revitVersion') {
          currentVer = currentShowSet.revitVersion
            ?? Math.max(currentShowSet.structureVersion ?? 1, currentShowSet.integratedVersion ?? 1);
        } else {
          currentVer = currentShowSet[targetVType] ?? 1;
        }
        recallNewVersion = currentVer + 1;
        recallVersionEntry = {
          id: generateId(),
          versionType: targetVType,
          version: recallNewVersion,
          reason: { en: '', zh: '', 'zh-TW': '' },
          createdAt: recallTimestamp,
          createdBy: auth.userId,
        };
      }

      // Target stage gets the requested status (in_progress or revision_required)
      const targetStageUpdate: Record<string, unknown> = {
        ...currentShowSet.stages[recallTarget],
        status,
        updatedBy: auth.userId,
        updatedAt: recallTimestamp,
      };

      let recallUpdateExpr = 'SET stages.#targetStage = :targetStageUpdate, #updatedAt = :updatedAt';
      const recallExprNames: Record<string, string> = {
        '#targetStage': recallTarget,
        '#updatedAt': 'updatedAt',
      };
      const recallExprValues: Record<string, unknown> = {
        ':targetStageUpdate': targetStageUpdate,
        ':updatedAt': recallTimestamp,
      };

      // Add version increment if needed
      if (recallNewVersion !== undefined && targetVType) {
        recallUpdateExpr += ', #versionType = :recallNewVersion';
        recallExprNames['#versionType'] = targetVType;
        recallExprValues[':recallNewVersion'] = recallNewVersion;
      }

      // Add version history entry if needed
      if (recallVersionEntry) {
        recallUpdateExpr += ', versionHistory = list_append(if_not_exists(versionHistory, :emptyList), :historyEntry)';
        recallExprValues[':emptyList'] = [];
        recallExprValues[':historyEntry'] = [recallVersionEntry];
      }

      // Set stages between target and recallFrom (exclusive of target, inclusive of recallFrom) to revision_required
      const stagesToReset: StageName[] = [];
      for (let i = targetIdx + 1; i <= fromIdx; i++) {
        const stageToReset = STAGE_ORDER[i];
        stagesToReset.push(stageToReset);
        const resetStage = {
          ...currentShowSet.stages[stageToReset],
          status: 'revision_required',
          updatedBy: auth.userId,
          updatedAt: recallTimestamp,
        };
        recallUpdateExpr += `, stages.#stage_${stageToReset} = :stageReset_${stageToReset}`;
        recallExprNames[`#stage_${stageToReset}`] = stageToReset;
        recallExprValues[`:stageReset_${stageToReset}`] = resetStage;
      }

      // Also set downstream complete stages to revision_required
      const downstreamToReset: StageName[] = [];
      for (let i = fromIdx + 1; i < STAGE_ORDER.length; i++) {
        const dsStage = STAGE_ORDER[i];
        if (currentShowSet.stages[dsStage].status === 'complete') {
          downstreamToReset.push(dsStage);
          const resetStage = {
            ...currentShowSet.stages[dsStage],
            status: 'revision_required',
            updatedBy: auth.userId,
            updatedAt: recallTimestamp,
          };
          recallUpdateExpr += `, stages.#ds_${dsStage} = :dsReset_${dsStage}`;
          recallExprNames[`#ds_${dsStage}`] = dsStage;
          recallExprValues[`:dsReset_${dsStage}`] = resetStage;
        }
      }

      // Execute the recall update
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAMES.SHOWSETS,
          Key: keys.showSet(showSetId),
          UpdateExpression: recallUpdateExpr,
          ExpressionAttributeNames: recallExprNames,
          ExpressionAttributeValues: recallExprValues,
        })
      );

      // Create a revision note if provided
      if (revisionNote && revisionNoteLang) {
        await createRevisionNote(
          showSetId,
          recallTarget,
          revisionNote,
          revisionNoteLang,
          auth.userId,
          auth.name
        );
      }

      // Log recall activity
      await logActivity(showSetId, auth.userId, auth.name, 'recall_from_review', {
        recallFrom,
        recallTarget,
        startedWork: status === 'in_progress',
        stagesReset: [...stagesToReset, ...downstreamToReset],
        versionBumped: recallNewVersion !== undefined,
      });

      // Log version bump if applicable
      if (recallNewVersion !== undefined && targetVType) {
        let prevVersion: number;
        if (targetVType === 'revitVersion') {
          prevVersion = currentShowSet.revitVersion
            ?? Math.max(currentShowSet.structureVersion ?? 1, currentShowSet.integratedVersion ?? 1);
        } else {
          prevVersion = currentShowSet[targetVType] ?? 1;
        }
        await logActivity(showSetId, auth.userId, auth.name, 'version_bump', {
          versionType: targetVType,
          from: prevVersion,
          to: recallNewVersion,
          trigger: 'recall',
        });
      }

      return success({ message: 'Stage recalled successfully' });
    }

    // Cascade downstream stages when re-working a completed stage
    // When going from complete → in_progress, downstream stages become revision_required
    const shouldCascadeDownstream = currentStage.status === 'complete' && status === 'in_progress';

    // Auto-increment version when re-working a stage (complete or revision_required -> in_progress)
    // Version increments ONLY from revision_required/complete -> in_progress
    const versionType = getVersionTypeForStage(stageName);
    let newVersion: number | undefined;
    let versionHistoryEntry: VersionHistoryEntry | undefined;

    const shouldIncrementVersion =
      (currentStage.status === 'complete' || currentStage.status === 'revision_required') &&
      status === 'in_progress' &&
      versionType !== null;  // Skip inBim360 (has no version)

    if (shouldIncrementVersion && versionType) {
      // Get current version with fallback for legacy data
      let currentVersionValue: number;
      if (versionType === 'revitVersion') {
        // Fallback chain: revitVersion -> max(structureVersion, integratedVersion) -> 1
        currentVersionValue = currentShowSet.revitVersion
          ?? Math.max(currentShowSet.structureVersion ?? 1, currentShowSet.integratedVersion ?? 1);
      } else {
        currentVersionValue = currentShowSet[versionType] ?? 1;
      }
      // Auto-increment the version
      newVersion = currentVersionValue + 1;

      // Create version history entry
      versionHistoryEntry = {
        id: generateId(),
        versionType,
        version: newVersion,
        reason: {
          en: '',
          zh: '',
          'zh-TW': '',
        },
        createdAt: timestamp,
        createdBy: auth.userId,
      };
    }

    const stageUpdate: Record<string, unknown> = {
      status,
      updatedBy: auth.userId,
      updatedAt: timestamp,
    };

    // Only include assignedTo and version for stages that support them
    if (['screen', 'structure', 'integrated', 'drawing2d'].includes(stageName)) {
      if (assignedTo !== undefined) {
        stageUpdate.assignedTo = assignedTo;
      }
      if (version !== undefined) {
        stageUpdate.version = version;
      }
    }

    // Save revision note when setting revision_required
    if (status === 'revision_required' && revisionNote) {
      stageUpdate.revisionNote = revisionNote;
      stageUpdate.revisionNoteBy = auth.name;
      stageUpdate.revisionNoteAt = timestamp;

      // Also create a note in the notes table
      await createRevisionNote(
        showSetId,
        stageName,
        revisionNote,
        revisionNoteLang ?? 'en',
        auth.userId,
        auth.name
      );
    }

    // Build the update expression
    let updateExpression = 'SET stages.#stage = :stageUpdate, #updatedAt = :updatedAt';
    const expressionAttributeNames: Record<string, string> = {
      '#stage': stageName,
      '#updatedAt': 'updatedAt',
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ':stageUpdate': stageUpdate,
      ':updatedAt': timestamp,
    };

    // Add version increment if needed
    if (newVersion !== undefined && versionType) {
      updateExpression += `, #versionType = :newVersion`;
      expressionAttributeNames['#versionType'] = versionType;
      expressionAttributeValues[':newVersion'] = newVersion;
    }

    // Add version history entry if needed
    if (versionHistoryEntry) {
      updateExpression += `, versionHistory = list_append(if_not_exists(versionHistory, :emptyList), :historyEntry)`;
      expressionAttributeValues[':emptyList'] = [];
      expressionAttributeValues[':historyEntry'] = [versionHistoryEntry];
    }

    // Handle cascade when re-working a stage
    // Downstream stages that were complete become revision_required (not not_started)
    // This preserves version info and shows they need re-work
    const downstreamStagesToReset: StageName[] = [];
    if (shouldCascadeDownstream) {
      // Set downstream stages to revision_required (only if they were complete)
      const downstreamStages = getDownstreamStages(stageName);
      for (const ds of downstreamStages) {
        const currentDsStatus = currentShowSet.stages[ds].status;

        // Only change if was complete - preserve not_started
        if (currentDsStatus === 'complete') {
          const resetStage = {
            ...currentShowSet.stages[ds],
            status: 'revision_required',
            updatedBy: auth.userId,
            updatedAt: timestamp,
          };

          updateExpression += `, stages.#ds_${ds} = :dsReset_${ds}`;
          expressionAttributeNames[`#ds_${ds}`] = ds;
          expressionAttributeValues[`:dsReset_${ds}`] = resetStage;

          // DO NOT increment versions on cascade - version increments when stage is re-worked
          downstreamStagesToReset.push(ds);
        }
      }
    }

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.SHOWSETS,
        Key: keys.showSet(showSetId),
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );

    // Log status change activity
    if (currentStage.status !== status) {
      await logActivity(showSetId, auth.userId, auth.name, 'status_change', {
        stage: stageName,
        from: currentStage.status,
        to: status,
      });
    }

    // Log assignment activity
    if (assignedTo !== undefined && (currentStage as any).assignedTo !== assignedTo) {
      await logActivity(showSetId, auth.userId, auth.name, 'assignment', {
        stage: stageName,
        assignedTo,
      });
    }

    // Log version update activity
    if (version !== undefined && (currentStage as any).version !== version) {
      await logActivity(showSetId, auth.userId, auth.name, 'version_update', {
        stage: stageName,
        version,
      });
    }

    // Log version bump activity
    if (newVersion !== undefined && versionType) {
      // Get the previous version for logging (same fallback logic)
      let prevVersion: number;
      if (versionType === 'revitVersion') {
        prevVersion = currentShowSet.revitVersion
          ?? Math.max(currentShowSet.structureVersion ?? 1, currentShowSet.integratedVersion ?? 1);
      } else {
        prevVersion = currentShowSet[versionType] ?? 1;
      }
      await logActivity(showSetId, auth.userId, auth.name, 'version_bump', {
        versionType,
        from: prevVersion,
        to: newVersion,
        trigger: currentStage.status, // 'revision_required' or 'complete'
        historyEntryId: versionHistoryEntry?.id,
      });
    }

    // Log cascade reset activity
    if (downstreamStagesToReset.length > 0) {
      await logActivity(showSetId, auth.userId, auth.name, 'cascade_reset', {
        triggeredBy: stageName,
        resetStages: downstreamStagesToReset,
      });
    }

    return success({ message: 'Stage updated successfully' });
  } catch (err) {
    console.error('Error updating stage:', err);
    return internalError();
  }
};

const updateLinks: AuthenticatedHandler = async (event, auth) => {
  try {
    if (!canManageLinks(auth.role)) {
      return forbidden('Only admins and BIM coordinators can update links');
    }

    const showSetId = event.pathParameters?.id;
    if (!showSetId) {
      return validationError('ShowSet ID is required');
    }

    const body = JSON.parse(event.body ?? '{}');
    const parsed = linksUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { modelUrl, drawingsUrl } = parsed.data;

    if (modelUrl === undefined && drawingsUrl === undefined) {
      return validationError('At least one link must be provided');
    }

    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {};

    if (modelUrl !== undefined) {
      updateExpressions.push('links.#modelUrl = :modelUrl');
      expressionAttributeNames['#modelUrl'] = 'modelUrl';
      expressionAttributeValues[':modelUrl'] = modelUrl;
    }

    if (drawingsUrl !== undefined) {
      updateExpressions.push('links.#drawingsUrl = :drawingsUrl');
      expressionAttributeNames['#drawingsUrl'] = 'drawingsUrl';
      expressionAttributeValues[':drawingsUrl'] = drawingsUrl;
    }

    const timestamp = now();
    updateExpressions.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = timestamp;

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.SHOWSETS,
        Key: keys.showSet(showSetId),
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ConditionExpression: 'attribute_exists(PK)',
      })
    );

    // Log link updates
    if (modelUrl !== undefined) {
      await logActivity(showSetId, auth.userId, auth.name, 'link_update', {
        field: 'modelUrl',
        value: modelUrl,
      });
    }
    if (drawingsUrl !== undefined) {
      await logActivity(showSetId, auth.userId, auth.name, 'link_update', {
        field: 'drawingsUrl',
        value: drawingsUrl,
      });
    }

    return success({ message: 'Links updated successfully' });
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      return notFound('ShowSet');
    }
    console.error('Error updating links:', err);
    return internalError();
  }
};

// Manual version update - requires canEditVersions permission
const updateVersion: AuthenticatedHandler = async (event, auth) => {
  try {
    const showSetId = event.pathParameters?.id;
    if (!showSetId) {
      return validationError('ShowSet ID is required');
    }

    // Authorization check: only admin or users with canEditVersions permission
    if (!auth.canEditVersions) {
      return forbidden('You do not have permission to edit versions');
    }

    const body = JSON.parse(event.body ?? '{}');
    const parsed = versionUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { versionType, reason, language, targetVersion } = parsed.data;

    // Get current showset to check permissions and get current version
    const current = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAMES.SHOWSETS,
        Key: keys.showSet(showSetId),
      })
    );

    if (!current.Item) {
      return notFound('ShowSet');
    }

    const currentShowSet = current.Item as ShowSet;
    // Get current version with fallback for legacy data
    let currentVersion: number;
    if (versionType === 'revitVersion') {
      // Fallback chain: revitVersion -> max(structureVersion, integratedVersion) -> 1
      currentVersion = currentShowSet.revitVersion
        ?? Math.max(currentShowSet.structureVersion ?? 1, currentShowSet.integratedVersion ?? 1);
    } else {
      currentVersion = currentShowSet[versionType] ?? 1;
    }
    // Use targetVersion if provided, otherwise increment
    const newVersion = targetVersion ?? currentVersion + 1;
    const timestamp = now();

    // If version hasn't changed, skip update
    if (newVersion === currentVersion) {
      return success({
        message: 'Version unchanged',
        [versionType]: currentVersion,
      });
    }

    // Create version history entry
    const versionHistoryEntry: VersionHistoryEntry = {
      id: generateId(),
      versionType,
      version: newVersion,
      reason: {
        en: language === 'en' ? reason : '',
        zh: language === 'zh' ? reason : '',
        'zh-TW': language === 'zh-TW' ? reason : '',
      },
      createdAt: timestamp,
      createdBy: auth.userId,
    };

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.SHOWSETS,
        Key: keys.showSet(showSetId),
        UpdateExpression: `SET #versionType = :newVersion, #updatedAt = :updatedAt, versionHistory = list_append(if_not_exists(versionHistory, :emptyList), :historyEntry)`,
        ExpressionAttributeNames: {
          '#versionType': versionType,
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':newVersion': newVersion,
          ':updatedAt': timestamp,
          ':emptyList': [],
          ':historyEntry': [versionHistoryEntry],
        },
      })
    );

    // Log version update activity
    await logActivity(showSetId, auth.userId, auth.name, 'version_manual', {
      versionType,
      from: currentVersion,
      to: newVersion,
      historyEntryId: versionHistoryEntry.id,
    });

    return success({
      message: 'Version updated successfully',
      [versionType]: newVersion,
      historyEntryId: versionHistoryEntry.id,
    });
  } catch (err) {
    console.error('Error updating version:', err);
    return internalError();
  }
};

// Helper to check if ShowSet is locked (simple flag - admin controls)
function isShowSetLocked(showSet: ShowSet): boolean {
  return !!showSet.lockedAt;
}

// Lock a ShowSet (Admin only)
const lockShowSet: AuthenticatedHandler = async (event, auth) => {
  try {
    if (auth.role !== 'admin') {
      return forbidden('Only admins can lock ShowSets');
    }

    const showSetId = event.pathParameters?.id;
    if (!showSetId) {
      return validationError('ShowSet ID is required');
    }

    // Get current ShowSet
    const current = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAMES.SHOWSETS,
        Key: keys.showSet(showSetId),
      })
    );

    if (!current.Item) {
      return notFound('ShowSet');
    }

    const currentShowSet = current.Item as ShowSet;

    // Check if already locked
    if (isShowSetLocked(currentShowSet)) {
      return validationError('ShowSet is already locked');
    }

    const timestamp = now();

    // Update ShowSet with lock info
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.SHOWSETS,
        Key: keys.showSet(showSetId),
        UpdateExpression: 'SET lockedAt = :lockedAt, lockedBy = :lockedBy, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':lockedAt': timestamp,
          ':lockedBy': auth.userId,
          ':updatedAt': timestamp,
        },
      })
    );

    // Log lock activity
    await logActivity(showSetId, auth.userId, auth.name, 'showset_locked', {});

    return success({ message: 'ShowSet locked' });
  } catch (err) {
    console.error('Error locking showset:', err);
    return internalError();
  }
};

// Schema for unlock request body
const unlockShowSetSchema = z.object({
  stagesToReset: z.array(z.enum(['screen', 'structure', 'integrated', 'inBim360', 'drawing2d'])).optional(),
});

// Unlock a ShowSet (Admin only)
const unlockShowSet: AuthenticatedHandler = async (event, auth) => {
  try {
    if (auth.role !== 'admin') {
      return forbidden('Only admins can unlock ShowSets');
    }

    const showSetId = event.pathParameters?.id;
    if (!showSetId) {
      return validationError('ShowSet ID is required');
    }

    // Parse request body for stagesToReset
    const body = JSON.parse(event.body ?? '{}');
    const parsed = unlockShowSetSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { stagesToReset } = parsed.data;

    // Get current ShowSet
    const current = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAMES.SHOWSETS,
        Key: keys.showSet(showSetId),
      })
    );

    if (!current.Item) {
      return notFound('ShowSet');
    }

    const currentShowSet = current.Item as ShowSet;

    // Check if ShowSet is locked
    if (!isShowSetLocked(currentShowSet)) {
      return validationError('ShowSet is not locked');
    }

    const timestamp = now();

    // Build update expression - start with clearing lock fields
    let updateExpression = 'SET lockedAt = :nullVal, lockedBy = :nullVal, #updatedAt = :updatedAt';
    const expressionAttributeNames: Record<string, string> = {
      '#updatedAt': 'updatedAt',
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ':nullVal': null,
      ':updatedAt': timestamp,
    };

    // If stagesToReset is provided, set those stages to revision_required
    const stagesActuallyReset: StageName[] = [];
    if (stagesToReset && stagesToReset.length > 0) {
      for (const stageName of stagesToReset) {
        // Only reset stages that are currently complete
        if (currentShowSet.stages[stageName]?.status === 'complete') {
          const stageKey = `stages_${stageName}`;
          updateExpression += `, stages.#${stageKey} = :${stageKey}`;
          expressionAttributeNames[`#${stageKey}`] = stageName;
          expressionAttributeValues[`:${stageKey}`] = {
            ...currentShowSet.stages[stageName],
            status: 'revision_required',
            updatedAt: timestamp,
            updatedBy: auth.userId,
          };
          stagesActuallyReset.push(stageName);
        }
      }
    }

    // Execute update
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.SHOWSETS,
        Key: keys.showSet(showSetId),
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );

    // Log unlock activity with stages reset info
    await logActivity(showSetId, auth.userId, auth.name, 'showset_unlocked', {
      stagesReset: stagesActuallyReset,
    });

    return success({ message: 'ShowSet unlocked', stagesReset: stagesActuallyReset });
  } catch (err) {
    console.error('Error unlocking showset:', err);
    return internalError();
  }
};

// Request upstream revision - any operator can request revisions to upstream stages
const requestUpstreamRevision: AuthenticatedHandler = async (event, auth) => {
  try {
    const showSetId = event.pathParameters?.id;
    if (!showSetId) {
      return validationError('ShowSet ID is required');
    }

    // Check permission
    if (!canRequestUpstreamRevision(auth.role)) {
      return forbidden('View-only users cannot request revisions');
    }

    const body = JSON.parse(event.body ?? '{}');
    const parsed = upstreamRevisionSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { targetStages, currentStage, revisionNote, revisionNoteLang, attachment } = parsed.data;

    // Validate attachment MIME type if provided
    if (attachment && !ALLOWED_MIME_TYPES.includes(attachment.mimeType)) {
      return validationError(`File type not allowed. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`);
    }

    // Validate that all target stages are upstream of current stage
    const currentIdx = STAGE_ORDER.indexOf(currentStage);
    for (const target of targetStages) {
      const targetIdx = STAGE_ORDER.indexOf(target);
      if (targetIdx >= currentIdx) {
        return validationError(`Target stage ${target} must be upstream of current stage ${currentStage}`);
      }
    }

    // Get current ShowSet
    const current = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAMES.SHOWSETS,
        Key: keys.showSet(showSetId),
      })
    );

    if (!current.Item) {
      return notFound('ShowSet');
    }

    const currentShowSet = current.Item as ShowSet;
    const timestamp = now();

    // Check if ShowSet is locked
    if (isShowSetLocked(currentShowSet)) {
      return forbidden('ShowSet is locked. An admin must unlock it before changes can be made.');
    }

    // Find the earliest target stage to determine the cascade range
    const targetIndices = targetStages.map(s => STAGE_ORDER.indexOf(s));
    const earliestTargetIdx = Math.min(...targetIndices);

    // All stages from earliest target through current stage (exclusive) need to be set to revision_required
    // This ensures intermediate stages are also marked
    const stagesToReset: StageName[] = [];
    for (let i = earliestTargetIdx; i < currentIdx; i++) {
      stagesToReset.push(STAGE_ORDER[i]);
    }

    // Build update expression
    let updateExpression = 'SET #updatedAt = :updatedAt';
    const expressionAttributeNames: Record<string, string> = {
      '#updatedAt': 'updatedAt',
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ':updatedAt': timestamp,
    };

    // Set all stages in the range to revision_required
    for (const stageName of stagesToReset) {
      const stageUpdate = {
        ...currentShowSet.stages[stageName],
        status: 'revision_required',
        updatedBy: auth.userId,
        updatedAt: timestamp,
      };
      updateExpression += `, stages.#stage_${stageName} = :stageUpdate_${stageName}`;
      expressionAttributeNames[`#stage_${stageName}`] = stageName;
      expressionAttributeValues[`:stageUpdate_${stageName}`] = stageUpdate;
    }

    // Execute update
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.SHOWSETS,
        Key: keys.showSet(showSetId),
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );

    // Create revision note and get its ID
    const noteId = await createRevisionNote(
      showSetId,
      STAGE_ORDER[earliestTargetIdx], // Use earliest target as the stage for the note
      revisionNote,
      revisionNoteLang,
      auth.userId,
      auth.name
    );

    // Log activity
    await logActivity(showSetId, auth.userId, auth.name, 'upstream_revision_requested', {
      targetStages,
      currentStage,
      stagesToReset,
    });

    // If attachment was provided, generate presigned upload URL
    let uploadInfo: { uploadUrl: string; attachmentId: string; s3Key: string } | undefined;
    if (attachment) {
      const attachmentId = generateId();
      const s3Key = `notes/${showSetId}/${noteId}/${attachmentId}/${attachment.fileName}`;

      const command = new PutObjectCommand({
        Bucket: ATTACHMENTS_BUCKET,
        Key: s3Key,
        ContentType: attachment.mimeType,
        ContentLength: attachment.fileSize,
      });

      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 600 });

      uploadInfo = { uploadUrl, attachmentId, s3Key };
    }

    return success({
      message: 'Upstream revision requested successfully',
      stagesToReset,
      noteId,
      ...uploadInfo,
    });
  } catch (err) {
    console.error('Error requesting upstream revision:', err);
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
    case 'GET /showsets':
      return await wrappedHandler(listShowSets);
    case 'POST /showsets':
      return await wrappedHandler(createShowSet);
    case 'GET /showsets/{id}':
      return await wrappedHandler(getShowSet);
    case 'PUT /showsets/{id}':
      return await wrappedHandler(updateShowSet);
    case 'DELETE /showsets/{id}':
      return await wrappedHandler(deleteShowSet);
    case 'PUT /showsets/{id}/stage/{stage}':
      return await wrappedHandler(updateStage);
    case 'PUT /showsets/{id}/links':
      return await wrappedHandler(updateLinks);
    case 'PUT /showsets/{id}/version':
      return await wrappedHandler(updateVersion);
    case 'POST /showsets/{id}/lock':
      return await wrappedHandler(lockShowSet);
    case 'POST /showsets/{id}/unlock':
      return await wrappedHandler(unlockShowSet);
    case 'POST /showsets/{id}/request-revision':
      return await wrappedHandler(requestUpstreamRevision);
    default:
      return validationError('Unknown endpoint');
  }
};
