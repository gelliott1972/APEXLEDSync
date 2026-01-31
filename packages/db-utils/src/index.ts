import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  type GetCommandInput,
  type PutCommandInput,
  type UpdateCommandInput,
  type DeleteCommandInput,
  type QueryCommandInput,
  type ScanCommandInput,
} from '@aws-sdk/lib-dynamodb';

// Table names with unisync prefix
export const TABLE_NAMES = {
  USERS: process.env.USERS_TABLE ?? 'unisync-users',
  SHOWSETS: process.env.SHOWSETS_TABLE ?? 'unisync-showsets',
  NOTES: process.env.NOTES_TABLE ?? 'unisync-notes',
  ACTIVITY: process.env.ACTIVITY_TABLE ?? 'unisync-activity',
  SESSIONS: process.env.SESSIONS_TABLE ?? 'unisync-sessions',
} as const;

// GSI names
export const GSI_NAMES = {
  EMAIL_INDEX: 'GSI1-email-index',
  AREA_INDEX: 'GSI1-area-index',
  DATE_INDEX: 'GSI1-date-index',
  // Issue GSIs (on notes table)
  ISSUE_AUTHOR_INDEX: 'GSI1-author-index',
  ISSUE_MENTION_INDEX: 'GSI2-mention-index',
} as const;

// Initialize DynamoDB client
const createDynamoDBClient = () => {
  const config: ConstructorParameters<typeof DynamoDBClient>[0] = {
    region: process.env.AWS_REGION ?? 'ap-east-1',
  };

  // LocalStack endpoint for local development
  if (process.env.DYNAMODB_ENDPOINT) {
    config.endpoint = process.env.DYNAMODB_ENDPOINT;
    config.credentials = {
      accessKeyId: 'test',
      secretAccessKey: 'test',
    };
  }

  return config;
};

const client = new DynamoDBClient(createDynamoDBClient());
export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

// Helper functions
export async function getItem<T>(params: GetCommandInput): Promise<T | null> {
  const result = await docClient.send(new GetCommand(params));
  return (result.Item as T) ?? null;
}

export async function putItem(params: PutCommandInput): Promise<void> {
  await docClient.send(new PutCommand(params));
}

export async function updateItem(params: UpdateCommandInput): Promise<void> {
  await docClient.send(new UpdateCommand(params));
}

export async function deleteItem(params: DeleteCommandInput): Promise<void> {
  await docClient.send(new DeleteCommand(params));
}

export async function queryItems<T>(params: QueryCommandInput): Promise<T[]> {
  const result = await docClient.send(new QueryCommand(params));
  return (result.Items as T[]) ?? [];
}

export async function queryItemsWithPagination<T>(
  params: QueryCommandInput
): Promise<{ items: T[]; nextToken?: string }> {
  const result = await docClient.send(new QueryCommand(params));
  return {
    items: (result.Items as T[]) ?? [],
    nextToken: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined,
  };
}

export async function scanItems<T>(params: ScanCommandInput): Promise<T[]> {
  const result = await docClient.send(new ScanCommand(params));
  return (result.Items as T[]) ?? [];
}

// Key builders
export const keys = {
  user: (userId: string) => ({
    PK: `USER#${userId}`,
    SK: 'PROFILE',
  }),
  userEmail: (email: string) => ({
    GSI1PK: `EMAIL#${email}`,
    GSI1SK: 'PROFILE',
  }),
  showSet: (showSetId: string) => ({
    PK: `SHOWSET#${showSetId}`,
    SK: 'DETAILS',
  }),
  showSetArea: (area: string, showSetId: string) => ({
    GSI1PK: `AREA#${area}`,
    GSI1SK: `SHOWSET#${showSetId}`,
  }),
  note: (showSetId: string, timestamp: string, noteId: string) => ({
    PK: `SHOWSET#${showSetId}`,
    SK: `NOTE#${timestamp}#${noteId}`,
  }),
  // Issue keys (uses same table as notes)
  issue: (showSetId: string, timestamp: string, issueId: string) => ({
    PK: `SHOWSET#${showSetId}`,
    SK: `ISSUE#${timestamp}#${issueId}`,
  }),
  issueAuthor: (userId: string, timestamp: string, issueId: string) => ({
    GSI1PK: `USER#${userId}`,
    GSI1SK: `ISSUE#${timestamp}#${issueId}`,
  }),
  issueMention: (userId: string, showSetId: string, timestamp: string, issueId: string) => ({
    // Base table keys required for every DynamoDB item
    PK: `MENTION#${userId}`,
    SK: `ISSUE#${showSetId}#${timestamp}#${issueId}`,
    // GSI2 keys for mention lookup
    GSI2PK: `MENTION#${userId}`,
    GSI2SK: `ISSUE#${showSetId}#${timestamp}#${issueId}`,
  }),
  activity: (showSetId: string, timestamp: string, activityId: string) => ({
    PK: `SHOWSET#${showSetId}`,
    SK: `ACTIVITY#${timestamp}#${activityId}`,
  }),
  activityDate: (date: string, timestamp: string, activityId: string) => ({
    GSI1PK: `ACTIVITY_DATE#${date}`,
    GSI1SK: `${timestamp}#${activityId}`,
  }),
  session: (userId: string) => ({
    PK: 'ACTIVE_SESSION',
    SK: `USER#${userId}`,
  }),
};

// Generate unique IDs
export function generateId(): string {
  return crypto.randomUUID();
}

// Get current ISO timestamp
export function now(): string {
  return new Date().toISOString();
}

// Get Unix timestamp for TTL
export function ttlTimestamp(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}
