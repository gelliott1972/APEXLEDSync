import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE_NAMES, GSI_NAMES, docClient } from '@unisync/db-utils';
import type { Activity } from '@unisync/shared-types';
import { withAuth, type AuthenticatedHandler } from '../../middleware/authorize.js';
import { success, validationError, internalError } from '../../lib/response.js';

// Get activity for a specific ShowSet
const getShowSetActivity: AuthenticatedHandler = async (event) => {
  try {
    const showSetId = event.pathParameters?.id;
    if (!showSetId) {
      return validationError('ShowSet ID is required');
    }

    const limit = parseInt(event.queryStringParameters?.limit ?? '50', 10);

    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAMES.ACTIVITY,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `SHOWSET#${showSetId}`,
          ':skPrefix': 'ACTIVITY#',
        },
        ScanIndexForward: false, // Most recent first
        Limit: Math.min(limit, 100),
      })
    );

    return success((result.Items ?? []) as Activity[]);
  } catch (err) {
    console.error('Error getting showset activity:', err);
    return internalError();
  }
};

// Get recent activity across all ShowSets
const getRecentActivity: AuthenticatedHandler = async (event) => {
  try {
    const limit = parseInt(event.queryStringParameters?.limit ?? '50', 10);
    const daysBack = parseInt(event.queryStringParameters?.days ?? '7', 10);

    // Query activity for each day in the range
    const activities: Activity[] = [];
    const today = new Date();

    for (let i = 0; i < Math.min(daysBack, 30); i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAMES.ACTIVITY,
          IndexName: GSI_NAMES.DATE_INDEX,
          KeyConditionExpression: 'GSI1PK = :datePk',
          ExpressionAttributeValues: {
            ':datePk': `ACTIVITY_DATE#${dateStr}`,
          },
          ScanIndexForward: false,
          Limit: limit - activities.length,
        })
      );

      activities.push(...((result.Items ?? []) as Activity[]));

      if (activities.length >= limit) {
        break;
      }
    }

    // Sort by createdAt descending and limit
    activities.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return success(activities.slice(0, limit));
  } catch (err) {
    console.error('Error getting recent activity:', err);
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
    case 'GET /showsets/{id}/activity':
      return await wrappedHandler(getShowSetActivity);
    case 'GET /activity/recent':
      return await wrappedHandler(getRecentActivity);
    default:
      return validationError('Unknown endpoint');
  }
};
