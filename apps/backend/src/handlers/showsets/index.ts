import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { PutCommand, UpdateCommand, DeleteCommand, QueryCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
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
  LocalizedString,
  VMItem,
  ShowSetStages,
  VersionType,
  VersionHistoryEntry,
} from '@unisync/shared-types';
import { withAuth, canUpdateStage, canManageLinks, type AuthenticatedHandler } from '../../middleware/authorize.js';
import {
  success,
  validationError,
  notFound,
  forbidden,
  internalError,
} from '../../lib/response.js';
import { canManageShowSets } from '../../lib/auth.js';

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
});

// Schema for manual version update
const versionUpdateSchema = z.object({
  versionType: z.enum(['screenVersion', 'revitVersion', 'drawingVersion']),
  reason: z.string().min(1),
  language: z.enum(['en', 'zh', 'zh-TW']),
});

// Map stage to version type
function getVersionTypeForStage(stage: StageName): VersionType | null {
  switch (stage) {
    case 'screen':
      return 'screenVersion';
    case 'structure':
    case 'integrated':
    case 'inBim360':
      return 'revitVersion';
    case 'drawing2d':
      return 'drawingVersion';
    default:
      return null;
  }
}

// Stages that support revision_required
const REVISION_STAGES: StageName[] = ['integrated', 'inBim360', 'drawing2d'];

const linksUpdateSchema = z.object({
  modelUrl: z.string().url().nullable().optional(),
  drawingsUrl: z.string().url().nullable().optional(),
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
    awaitingClient: { status: 'not_started', updatedBy: userId, updatedAt: timestamp },
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
      return forbidden('Only admins and BIM coordinators can create ShowSets');
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
      // Version tracking - initialize to v1
      screenVersion: 1,
      revitVersion: 1,
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
      return forbidden('Only admins and BIM coordinators can update ShowSets');
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

    const { status, assignedTo, version, revisionNote, revisionNoteLang } = parsed.data;

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

    // Check if this is a revision_required -> in_progress transition (version bump)
    const isRevisionToInProgress = currentStage.status === 'revision_required' && status === 'in_progress';
    const versionType = getVersionTypeForStage(stageName);
    let newVersion: number | undefined;
    let versionHistoryEntry: VersionHistoryEntry | undefined;

    if (isRevisionToInProgress && versionType) {
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

    const { versionType, reason, language } = parsed.data;

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
    const newVersion = currentVersion + 1;
    const timestamp = now();

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

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const resource = event.resource;

  const wrappedHandler = (fn: AuthenticatedHandler) =>
    withAuth(fn)(event, {} as never, () => {});

  switch (`${method} ${resource}`) {
    case 'GET /showsets':
      return wrappedHandler(listShowSets);
    case 'POST /showsets':
      return wrappedHandler(createShowSet);
    case 'GET /showsets/{id}':
      return wrappedHandler(getShowSet);
    case 'PUT /showsets/{id}':
      return wrappedHandler(updateShowSet);
    case 'DELETE /showsets/{id}':
      return wrappedHandler(deleteShowSet);
    case 'PUT /showsets/{id}/stage/{stage}':
      return wrappedHandler(updateStage);
    case 'PUT /showsets/{id}/links':
      return wrappedHandler(updateLinks);
    case 'PUT /showsets/{id}/version':
      return wrappedHandler(updateVersion);
    default:
      return validationError('Unknown endpoint');
  }
};
