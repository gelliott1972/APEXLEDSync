import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminDisableUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { PutCommand, UpdateCommand, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  TABLE_NAMES,
  docClient,
  keys,
  generateId,
  now,
} from '@unisync/db-utils';
import type { User, UserRole } from '@unisync/shared-types';
import { withAuth, type AuthenticatedHandler } from '../../middleware/authorize.js';
import {
  success,
  validationError,
  notFound,
  forbidden,
  internalError,
} from '../../lib/response.js';
import { canManageUsers } from '../../lib/auth.js';

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION ?? 'ap-east-1',
});

const USER_POOL_ID = process.env.USER_POOL_ID!;

// Schemas
const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(['admin', 'bim_coordinator', '3d_modeller', '2d_drafter']),
  preferredLang: z.enum(['en', 'zh', 'zh-TW']).optional().default('en'),
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(['admin', 'bim_coordinator', '3d_modeller', '2d_drafter']).optional(),
  preferredLang: z.enum(['en', 'zh', 'zh-TW']).optional(),
  status: z.enum(['active', 'deactivated']).optional(),
  canEditVersions: z.boolean().optional(),
});

// Handlers
const listUsers: AuthenticatedHandler = async (event, auth) => {
  try {
    if (!canManageUsers(auth.role)) {
      return forbidden('Only admins can list users');
    }

    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAMES.USERS,
        FilterExpression: 'begins_with(PK, :prefix)',
        ExpressionAttributeValues: {
          ':prefix': 'USER#',
        },
      })
    );

    return success((result.Items ?? []) as User[]);
  } catch (err) {
    console.error('Error listing users:', err);
    return internalError();
  }
};

const getUser: AuthenticatedHandler = async (event, auth) => {
  try {
    if (!canManageUsers(auth.role)) {
      return forbidden('Only admins can view user details');
    }

    const userId = event.pathParameters?.userId;
    if (!userId) {
      return validationError('User ID is required');
    }

    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAMES.USERS,
        Key: keys.user(userId),
      })
    );

    if (!result.Item) {
      return notFound('User');
    }

    return success(result.Item as User);
  } catch (err) {
    console.error('Error getting user:', err);
    return internalError();
  }
};

const createUser: AuthenticatedHandler = async (event, auth) => {
  try {
    if (!canManageUsers(auth.role)) {
      return forbidden('Only admins can create users');
    }

    const body = JSON.parse(event.body ?? '{}');
    const parsed = createUserSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { email, name, role, preferredLang } = parsed.data;
    const userId = generateId();
    const timestamp = now();

    // Create Cognito user
    const cognitoResult = await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name', Value: name },
          { Name: 'custom:userId', Value: userId },
          { Name: 'custom:role', Value: role },
          { Name: 'custom:preferredLang', Value: preferredLang },
        ],
        DesiredDeliveryMediums: ['EMAIL'],
      })
    );

    const cognitoSub = cognitoResult.User?.Attributes?.find(
      (attr) => attr.Name === 'sub'
    )?.Value!;

    // Add to role group
    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        GroupName: `unisync-${role}`,
      })
    );

    // Create DynamoDB record
    const user: User & { PK: string; SK: string; GSI1PK: string; GSI1SK: string } = {
      ...keys.user(userId),
      ...keys.userEmail(email),
      userId,
      email,
      name,
      role,
      status: 'active',
      preferredLang,
      cognitoSub,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAMES.USERS,
        Item: user,
      })
    );

    return success(user, 201);
  } catch (err: any) {
    if (err.name === 'UsernameExistsException') {
      return validationError('A user with this email already exists');
    }
    console.error('Error creating user:', err);
    return internalError();
  }
};

const updateUser: AuthenticatedHandler = async (event, auth) => {
  try {
    if (!canManageUsers(auth.role)) {
      return forbidden('Only admins can update users');
    }

    const userId = event.pathParameters?.userId;
    if (!userId) {
      return validationError('User ID is required');
    }

    const body = JSON.parse(event.body ?? '{}');
    const parsed = updateUserSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { name, role, preferredLang, status, canEditVersions } = parsed.data;

    if (!name && !role && !preferredLang && status === undefined && canEditVersions === undefined) {
      return validationError('At least one field must be provided');
    }

    // Get existing user
    const existing = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAMES.USERS,
        Key: keys.user(userId),
      })
    );

    if (!existing.Item) {
      return notFound('User');
    }

    const existingUser = existing.Item as User;

    // Update Cognito attributes
    const cognitoAttributes: { Name: string; Value: string }[] = [];
    if (name) cognitoAttributes.push({ Name: 'name', Value: name });
    if (role) cognitoAttributes.push({ Name: 'custom:role', Value: role });
    if (preferredLang) cognitoAttributes.push({ Name: 'custom:preferredLang', Value: preferredLang });

    if (cognitoAttributes.length > 0) {
      await cognitoClient.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: USER_POOL_ID,
          Username: existingUser.email,
          UserAttributes: cognitoAttributes,
        })
      );
    }

    // Update role group if changed
    if (role && role !== existingUser.role) {
      // Remove from old group
      await cognitoClient.send(
        new AdminRemoveUserFromGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: existingUser.email,
          GroupName: `unisync-${existingUser.role}`,
        })
      );

      // Add to new group
      await cognitoClient.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: existingUser.email,
          GroupName: `unisync-${role}`,
        })
      );
    }

    // Handle deactivation
    if (status === 'deactivated' && existingUser.status !== 'deactivated') {
      await cognitoClient.send(
        new AdminDisableUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: existingUser.email,
        })
      );
    }

    // Update DynamoDB
    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {};

    if (name) {
      updateExpressions.push('#name = :name');
      expressionAttributeNames['#name'] = 'name';
      expressionAttributeValues[':name'] = name;
    }

    if (role) {
      updateExpressions.push('#role = :role');
      expressionAttributeNames['#role'] = 'role';
      expressionAttributeValues[':role'] = role;
    }

    if (preferredLang) {
      updateExpressions.push('#preferredLang = :preferredLang');
      expressionAttributeNames['#preferredLang'] = 'preferredLang';
      expressionAttributeValues[':preferredLang'] = preferredLang;
    }

    if (status) {
      updateExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = status;
    }

    if (canEditVersions !== undefined) {
      updateExpressions.push('#canEditVersions = :canEditVersions');
      expressionAttributeNames['#canEditVersions'] = 'canEditVersions';
      expressionAttributeValues[':canEditVersions'] = canEditVersions;
    }

    updateExpressions.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = now();

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.USERS,
        Key: keys.user(userId),
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );

    return success({ message: 'User updated successfully' });
  } catch (err) {
    console.error('Error updating user:', err);
    return internalError();
  }
};

const deleteUser: AuthenticatedHandler = async (event, auth) => {
  try {
    if (!canManageUsers(auth.role)) {
      return forbidden('Only admins can deactivate users');
    }

    const userId = event.pathParameters?.userId;
    if (!userId) {
      return validationError('User ID is required');
    }

    // Get existing user
    const existing = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAMES.USERS,
        Key: keys.user(userId),
      })
    );

    if (!existing.Item) {
      return notFound('User');
    }

    const existingUser = existing.Item as User;

    // Disable in Cognito (soft delete)
    await cognitoClient.send(
      new AdminDisableUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: existingUser.email,
      })
    );

    // Update status in DynamoDB
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.USERS,
        Key: keys.user(userId),
        UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':status': 'deactivated',
          ':updatedAt': now(),
        },
      })
    );

    return success({ message: 'User deactivated successfully' });
  } catch (err) {
    console.error('Error deactivating user:', err);
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
    case 'GET /users':
      return wrappedHandler(listUsers);
    case 'GET /users/{userId}':
      return wrappedHandler(getUser);
    case 'POST /users':
      return wrappedHandler(createUser);
    case 'PUT /users/{userId}':
      return wrappedHandler(updateUser);
    case 'DELETE /users/{userId}':
      return wrappedHandler(deleteUser);
    default:
      return validationError('Unknown endpoint');
  }
};
