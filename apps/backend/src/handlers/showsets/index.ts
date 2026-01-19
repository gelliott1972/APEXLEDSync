import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { PutCommand, UpdateCommand, DeleteCommand, QueryCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
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
import { ENGINEER_ALLOWED_STATUSES } from '@unisync/shared-types';
import { withAuth, canUpdateStage, canManageLinks, type AuthenticatedHandler } from '../../middleware/authorize.js';
import {
  success,
  validationError,
  notFound,
  forbidden,
  internalError,
} from '../../lib/response.js';
import { canManageShowSets, isEngineer } from '../../lib/auth.js';

// SQS client for translation queue
const sqsClient = new SQSClient({
  region: process.env.AWS_REGION ?? 'ap-east-1',
});

const TRANSLATION_QUEUE_URL = process.env.TRANSLATION_QUEUE_URL!;

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
): Promise<void> {
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
  revisionNote: z.string().optional(), // Required when setting revision_required
  revisionNoteLang: z.enum(['en', 'zh', 'zh-TW']).optional(),
  skipVersionIncrement: z.boolean().optional(), // Skip auto-increment when going revision_required -> in_progress
});

// Schema for manual version update - per-stage versions
const versionUpdateSchema = z.object({
  versionType: z.enum(['screenVersion', 'structureVersion', 'integratedVersion', 'bim360Version', 'drawingVersion']),
  reason: z.string().optional().default(''),
  language: z.enum(['en', 'zh', 'zh-TW']),
  targetVersion: z.number().int().positive().optional(), // If provided, set to this version directly
});

// Map stage to version type - per-stage versions
function getVersionTypeForStage(stage: StageName): VersionType | null {
  switch (stage) {
    case 'screen':
      return 'screenVersion';
    case 'structure':
      return 'structureVersion';
    case 'integrated':
      return 'integratedVersion';
    case 'inBim360':
      return 'bim360Version';
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

const unlockShowSetSchema = z.object({
  reason: z.string().min(1, 'Unlock reason is required'),
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
      // Version tracking - per-stage, initialize to v1
      screenVersion: 1,
      structureVersion: 1,
      integratedVersion: 1,
      bim360Version: 1,
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

    const { status, assignedTo, version, revisionNote, revisionNoteLang, skipVersionIncrement } = parsed.data;

    // Engineers can only approve (complete) or request revision
    if (isEngineer(auth.role) && !ENGINEER_ALLOWED_STATUSES.includes(status)) {
      return forbidden('Engineers can only approve (complete) or request revision');
    }

    // Validate revision_required - only valid for certain stages and requires a note
    if (status === 'revision_required') {
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

    // Check if ShowSet is locked (completed and not unlocked)
    if (isShowSetLocked(currentShowSet) && status === 'in_progress') {
      return forbidden('ShowSet is locked. An admin must unlock it before changes can be made.');
    }

    // Track if we need to cascade reset (starting work on unlocked ShowSet)
    const isStartingWorkOnUnlocked = currentShowSet.unlockedAt && status === 'in_progress';

    // Check if this is a revision_required -> in_progress transition (version bump)
    // Only auto-increment if skipVersionIncrement is not true
    const isRevisionToInProgress = currentStage.status === 'revision_required' && status === 'in_progress';
    const versionType = getVersionTypeForStage(stageName);
    let newVersion: number | undefined;
    let versionHistoryEntry: VersionHistoryEntry | undefined;

    if (isRevisionToInProgress && versionType && !skipVersionIncrement) {
      // Auto-increment the version
      newVersion = (currentShowSet[versionType] ?? 1) + 1;

      // Create version history entry (will be populated with translated reason later)
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

    // Handle cascade reset when starting work on an unlocked ShowSet
    const downstreamStagesToReset: StageName[] = [];
    if (isStartingWorkOnUnlocked) {
      // Clear unlock fields
      updateExpression += ', unlockedAt = :nullValue, unlockedBy = :nullValue, unlockReason = :nullValue';
      expressionAttributeValues[':nullValue'] = null;

      // Reset downstream stages and increment their versions
      const downstreamStages = getDownstreamStages(stageName);
      for (const ds of downstreamStages) {
        const dsVersionType = getVersionTypeForStage(ds);
        const resetStage = {
          status: 'not_started',
          updatedBy: auth.userId,
          updatedAt: timestamp,
        };

        updateExpression += `, stages.#ds_${ds} = :dsReset_${ds}`;
        expressionAttributeNames[`#ds_${ds}`] = ds;
        expressionAttributeValues[`:dsReset_${ds}`] = resetStage;

        // Increment version for downstream stage
        if (dsVersionType) {
          const currentDsVersion = currentShowSet[dsVersionType] ?? 1;
          updateExpression += `, #dsVer_${ds} = :dsNewVer_${ds}`;
          expressionAttributeNames[`#dsVer_${ds}`] = dsVersionType;
          expressionAttributeValues[`:dsNewVer_${ds}`] = currentDsVersion + 1;
        }

        downstreamStagesToReset.push(ds);
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
      await logActivity(showSetId, auth.userId, auth.name, 'version_bump', {
        versionType,
        from: currentShowSet[versionType] ?? 1,
        to: newVersion,
        trigger: 'revision_required',
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
    const currentVersion = currentShowSet[versionType] ?? 1;
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

// Helper to check if ShowSet is locked
function isShowSetLocked(showSet: ShowSet): boolean {
  return showSet.stages.drawing2d.status === 'complete' && !showSet.unlockedAt;
}

// Unlock a ShowSet for revision (Admin only)
const unlockShowSet: AuthenticatedHandler = async (event, auth) => {
  try {
    if (auth.role !== 'admin') {
      return forbidden('Only admins can unlock ShowSets');
    }

    const showSetId = event.pathParameters?.id;
    if (!showSetId) {
      return validationError('ShowSet ID is required');
    }

    const body = JSON.parse(event.body ?? '{}');
    const parsed = unlockShowSetSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { reason } = parsed.data;

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
      return validationError('ShowSet is not locked (drawing2d must be complete and not already unlocked)');
    }

    const timestamp = now();

    // Update ShowSet with unlock info
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.SHOWSETS,
        Key: keys.showSet(showSetId),
        UpdateExpression: 'SET unlockedAt = :unlockedAt, unlockedBy = :unlockedBy, unlockReason = :unlockReason, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':unlockedAt': timestamp,
          ':unlockedBy': auth.userId,
          ':unlockReason': reason,
          ':updatedAt': timestamp,
        },
      })
    );

    // Log unlock activity
    await logActivity(showSetId, auth.userId, auth.name, 'showset_unlocked', {
      reason,
    });

    return success({ message: 'ShowSet unlocked for revision' });
  } catch (err) {
    console.error('Error unlocking showset:', err);
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
    case 'POST /showsets/{id}/unlock':
      return await wrappedHandler(unlockShowSet);
    default:
      return validationError('Unknown endpoint');
  }
};
