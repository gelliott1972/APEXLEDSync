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
import type { Session } from '@unisync/shared-types';
import { SESSION_TTL_SECONDS } from '@unisync/shared-types';
import { withAuth, type AuthenticatedHandler } from '../../middleware/authorize.js';
import {
  success,
  validationError,
  internalError,
} from '../../lib/response.js';

// Schemas
const startSessionSchema = z.object({
  showSetId: z.string().optional(),
  activity: z.string().min(1).max(200),
});

const heartbeatSchema = z.object({
  showSetId: z.string().optional(),
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

    const { showSetId, activity } = parsed.data;
    const timestamp = now();

    const session: Session & { PK: string; SK: string } = {
      ...keys.session(auth.userId),
      userId: auth.userId,
      userName: auth.name,
      showSetId: showSetId ?? null,
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

    const { showSetId, activity } = parsed.data;
    const timestamp = now();

    // Build update expression dynamically
    const updateExpressions = [
      '#lastHeartbeat = :lastHeartbeat',
      '#expiresAt = :expiresAt',
    ];
    const expressionAttributeNames: Record<string, string> = {
      '#lastHeartbeat': 'lastHeartbeat',
      '#expiresAt': 'expiresAt',
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ':lastHeartbeat': timestamp,
      ':expiresAt': ttlTimestamp(SESSION_TTL_SECONDS),
    };

    if (showSetId !== undefined) {
      updateExpressions.push('#showSetId = :showSetId');
      expressionAttributeNames['#showSetId'] = 'showSetId';
      expressionAttributeValues[':showSetId'] = showSetId;
    }

    if (activity !== undefined) {
      updateExpressions.push('#activity = :activity');
      expressionAttributeNames['#activity'] = 'activity';
      expressionAttributeValues[':activity'] = activity;
    }

    // Use PutCommand to upsert the session
    const session: Session & { PK: string; SK: string } = {
      ...keys.session(auth.userId),
      userId: auth.userId,
      userName: auth.name,
      showSetId: showSetId ?? null,
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

const endSession: AuthenticatedHandler = async (event, auth) => {
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

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const resource = event.resource;

  const wrappedHandler = (fn: AuthenticatedHandler) =>
    withAuth(fn)(event, {} as never, () => {});

  switch (`${method} ${resource}`) {
    case 'GET /sessions':
      return wrappedHandler(listSessions);
    case 'POST /sessions/start':
      return wrappedHandler(startSession);
    case 'POST /sessions/heartbeat':
      return wrappedHandler(heartbeat);
    case 'POST /sessions/end':
      return wrappedHandler(endSession);
    default:
      return validationError('Unknown endpoint');
  }
};
