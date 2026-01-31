import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminDisableUserCommand,
  AdminDeleteUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { PutCommand, UpdateCommand, ScanCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import {
  TABLE_NAMES,
  docClient,
  keys,
  generateId,
  now,
} from '@unisync/db-utils';
import type { User } from '@unisync/shared-types';
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

// Generate a secure temporary password
function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const specials = '!@#$%';
  let password = '';
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Add a special character and number to meet Cognito requirements
  password += specials.charAt(Math.floor(Math.random() * specials.length));
  password += Math.floor(Math.random() * 10);
  return password;
}

// Schemas
const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(['admin', 'bim_coordinator', 'engineer', '3d_modeller', '2d_drafter', 'customer_reviewer', 'reviewer', 'view_only']),
  preferredLang: z.enum(['en', 'zh', 'zh-TW']).optional().default('en'),
  skipEmail: z.boolean().optional().default(false), // If true, return temp password for clipboard invite
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(['admin', 'bim_coordinator', 'engineer', '3d_modeller', '2d_drafter', 'customer_reviewer', 'reviewer', 'view_only']).optional(),
  preferredLang: z.enum(['en', 'zh', 'zh-TW']).optional(),
  status: z.enum(['active', 'deactivated']).optional(),
  canEditVersions: z.boolean().optional(),
});

const resetPasswordSchema = z.object({
  skipEmail: z.boolean().optional().default(false), // If true, return temp password for clipboard
});

// Handlers
const listUsers: AuthenticatedHandler = async (_event, auth) => {
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

// List users for @mention autocomplete (available to all authenticated users)
const listUsersForMention: AuthenticatedHandler = async () => {
  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAMES.USERS,
        FilterExpression: 'begins_with(PK, :prefix)',
        ExpressionAttributeValues: {
          ':prefix': 'USER#',
        },
        ProjectionExpression: 'userId, #n',
        ExpressionAttributeNames: {
          '#n': 'name',
        },
      })
    );

    // Return only userId and name for privacy
    return success((result.Items ?? []).map(u => ({ userId: u.userId, name: u.name })));
  } catch (err) {
    console.error('Error listing users for mention:', err);
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

    const { email, name, role, preferredLang, skipEmail } = parsed.data;
    const userId = generateId();
    const timestamp = now();

    // Generate temp password if skipping email
    const tempPassword = skipEmail ? generateTempPassword() : undefined;

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
        // If skipEmail, suppress welcome message and use our temp password
        ...(skipEmail
          ? {
              MessageAction: 'SUPPRESS',
              TemporaryPassword: tempPassword,
            }
          : {
              DesiredDeliveryMediums: ['EMAIL'],
            }),
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
      canEditVersions: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAMES.USERS,
        Item: user,
      })
    );

    // Return user with temp password if email was skipped (for clipboard invite)
    return success(
      skipEmail ? { ...user, tempPassword } : user,
      201
    );
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
      return forbidden('Only admins can delete users');
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

    // Delete from Cognito
    await cognitoClient.send(
      new AdminDeleteUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: existingUser.email,
      })
    );

    // Delete from DynamoDB
    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAMES.USERS,
        Key: keys.user(userId),
      })
    );

    return success({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Error deleting user:', err);
    return internalError();
  }
};

const resetPassword: AuthenticatedHandler = async (event, auth) => {
  try {
    if (!canManageUsers(auth.role)) {
      return forbidden('Only admins can reset passwords');
    }

    const userId = event.pathParameters?.userId;
    if (!userId) {
      return validationError('User ID is required');
    }

    const body = JSON.parse(event.body ?? '{}');
    const parsed = resetPasswordSchema.safeParse(body);

    if (!parsed.success) {
      return validationError('Invalid request body', {
        details: parsed.error.message,
      });
    }

    const { skipEmail } = parsed.data;

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

    // Generate new temporary password
    const tempPassword = generateTempPassword();

    // Set the new password in Cognito (temporary = true means user must change on next login)
    await cognitoClient.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username: existingUser.email,
        Password: tempPassword,
        Permanent: false, // Temporary password - user must change on next login
      })
    );

    // If skipEmail, return the temp password for clipboard
    // Otherwise, we'd need to send an email (not implemented - Cognito doesn't auto-send for password resets)
    if (skipEmail) {
      return success({
        message: 'Password reset successfully',
        tempPassword,
        email: existingUser.email,
        name: existingUser.name,
        preferredLang: existingUser.preferredLang,
      });
    }

    // TODO: Implement email sending via SES if needed
    // For now, always return the temp password since we don't have email sending set up
    return success({
      message: 'Password reset successfully',
      tempPassword,
      email: existingUser.email,
      name: existingUser.name,
      preferredLang: existingUser.preferredLang,
    });
  } catch (err) {
    console.error('Error resetting password:', err);
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
    case 'GET /users':
      return await wrappedHandler(listUsers);
    case 'GET /users/for-mention':
      return await wrappedHandler(listUsersForMention);
    case 'GET /users/{userId}':
      return await wrappedHandler(getUser);
    case 'POST /users':
      return await wrappedHandler(createUser);
    case 'PUT /users/{userId}':
      return await wrappedHandler(updateUser);
    case 'DELETE /users/{userId}':
      return await wrappedHandler(deleteUser);
    case 'POST /users/{userId}/reset-password':
      return await wrappedHandler(resetPassword);
    default:
      return validationError('Unknown endpoint');
  }
};
