import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { PutCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  TABLE_NAMES,
  docClient,
  keys,
  now,
  ttlTimestamp,
} from '@unisync/db-utils';
import type { Session, StageName } from '@unisync/shared-types';
import { SESSION_TTL_SECONDS } from '@unisync/shared-types';
import { withAuth, type AuthenticatedHandler } from '../../middleware/authorize.js';
import {
  success,
  validationError,
  internalError,
} from '../../lib/response.js';

// Schemas
const stageNameSchema = z.enum(['screen', 'structure', 'inBim360', 'drawing2d']);

const startSessionSchema = z.object({
  showSetId: z.string().optional(),
  workingStages: z.array(stageNameSchema).optional().default([]),
  activity: z.string().min(1).max(200),
});

const heartbeatSchema = z.object({
  showSetId: z.string().optional(),
  workingStages: z.array(stageNameSchema).optional(),
  activity: z.string().min(1).max(200).optional(),
});

// Handlers
const listSessions: AuthenticatedHandler = async () => {
  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAMES.SESSIONS,
        FilterExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': 'ACTIVE_SESSION',
        },
      })
    );

    // Filter out expired sessions (DynamoDB TTL is eventually consistent)
    const currentTime = Math.floor(Date.now() / 1000);
    const activeSessions = (result.Items ?? []).filter(
      (item) => (item as Session).expiresAt > currentTime
    ) as Session[];

    return success(activeSessions);
  } catch (err) {
    console.error('Error listing sessions:', err);
    return internalError();
  }
};

const startSession: AuthenticatedHandler = async (event, auth) => {
  try {
    const body = JSON.parse(event.body ?? '{}');
    const parsed = startSessionSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { showSetId, workingStages, activity } = parsed.data;
    const timestamp = now();

    const session: Session & { PK: string; SK: string } = {
      ...keys.session(auth.userId),
      userId: auth.userId,
      userName: auth.name,
      showSetId: showSetId ?? null,
      workingStages: workingStages as StageName[],
      activity,
      startedAt: timestamp,
      lastHeartbeat: timestamp,
      expiresAt: ttlTimestamp(SESSION_TTL_SECONDS),
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAMES.SESSIONS,
        Item: session,
      })
    );

    return success(session, 201);
  } catch (err) {
    console.error('Error starting session:', err);
    return internalError();
  }
};

const heartbeat: AuthenticatedHandler = async (event, auth) => {
  try {
    const body = JSON.parse(event.body ?? '{}');
    const parsed = heartbeatSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { showSetId, workingStages, activity } = parsed.data;
    const timestamp = now();

    // Use PutCommand to upsert the session
    const session: Session & { PK: string; SK: string } = {
      ...keys.session(auth.userId),
      userId: auth.userId,
      userName: auth.name,
      showSetId: showSetId ?? null,
      workingStages: (workingStages ?? []) as StageName[],
      activity: activity ?? 'Working',
      startedAt: timestamp,
      lastHeartbeat: timestamp,
      expiresAt: ttlTimestamp(SESSION_TTL_SECONDS),
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAMES.SESSIONS,
        Item: session,
      })
    );

    return success({ message: 'Heartbeat received' });
  } catch (err) {
    console.error('Error processing heartbeat:', err);
    return internalError();
  }
};

const endSession: AuthenticatedHandler = async (_event, auth) => {
  try {
    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAMES.SESSIONS,
        Key: keys.session(auth.userId),
      })
    );

    return success({ message: 'Session ended' });
  } catch (err) {
    console.error('Error ending session:', err);
    return internalError();
  }
};

const myActiveSessions: AuthenticatedHandler = async (_event, auth) => {
  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAMES.SESSIONS,
        FilterExpression: 'PK = :pk AND userId = :userId',
        ExpressionAttributeValues: {
          ':pk': 'ACTIVE_SESSION',
          ':userId': auth.userId,
        },
      })
    );

    // Filter out expired sessions (DynamoDB TTL is eventually consistent)
    const currentTime = Math.floor(Date.now() / 1000);
    const activeSessions = (result.Items ?? []).filter(
      (item) => (item as Session).expiresAt > currentTime
    ) as Session[];

    return success(activeSessions);
  } catch (err) {
    console.error('Error getting my active sessions:', err);
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
    case 'GET /sessions':
      return await wrappedHandler(listSessions);
    case 'GET /sessions/my-active':
      return await wrappedHandler(myActiveSessions);
    case 'POST /sessions/start':
      return await wrappedHandler(startSession);
    case 'POST /sessions/heartbeat':
      return await wrappedHandler(heartbeat);
    case 'POST /sessions/end':
      return await wrappedHandler(endSession);
    default:
      return validationError('Unknown endpoint');
  }
};
