import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { TABLE_NAMES, docClient, keys, now } from '@unisync/db-utils';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { withAuth, type AuthenticatedHandler } from '../../middleware/authorize.js';
import { success, validationError, internalError } from '../../lib/response.js';

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  preferredLang: z.enum(['en', 'zh', 'zh-TW']).optional(),
});

const updateProfile: AuthenticatedHandler = async (event, auth) => {
  try {
    const body = JSON.parse(event.body ?? '{}');
    const parsed = updateProfileSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { name, preferredLang } = parsed.data;

    if (!name && !preferredLang) {
      return validationError('At least one field must be provided');
    }

    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {};

    if (name) {
      updateExpressions.push('#name = :name');
      expressionAttributeNames['#name'] = 'name';
      expressionAttributeValues[':name'] = name;
    }

    if (preferredLang) {
      updateExpressions.push('#preferredLang = :preferredLang');
      expressionAttributeNames['#preferredLang'] = 'preferredLang';
      expressionAttributeValues[':preferredLang'] = preferredLang;
    }

    updateExpressions.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = now();

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.USERS,
        Key: keys.user(auth.userId),
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );

    return success({ message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Error updating profile:', err);
    return internalError();
  }
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const path = event.resource;

  if (method === 'POST' && path === '/auth/update-profile') {
    return withAuth(updateProfile)(event, {} as never, () => {});
  }

  return validationError('Unknown endpoint');
};
