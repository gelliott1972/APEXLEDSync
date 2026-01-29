import type { APIGatewayProxyEvent, APIGatewayProxyResult, Handler } from 'aws-lambda';
import type { UserRole, StageName } from '@unisync/shared-types';
import { STAGE_PERMISSIONS } from '@unisync/shared-types';
import { getAuthContext, type AuthContext } from '../lib/auth.js';
import { forbidden, unauthorized } from '../lib/response.js';

export type AuthenticatedHandler = (
  event: APIGatewayProxyEvent,
  context: AuthContext
) => Promise<APIGatewayProxyResult>;

export function withAuth(handler: AuthenticatedHandler): Handler<APIGatewayProxyEvent, APIGatewayProxyResult> {
  return async (event) => {
    const authContext = getAuthContext(event);
    if (!authContext) {
      return unauthorized();
    }
    return handler(event, authContext);
  };
}

export function withRoles(
  allowedRoles: UserRole[],
  handler: AuthenticatedHandler
): Handler<APIGatewayProxyEvent, APIGatewayProxyResult> {
  return async (event) => {
    const authContext = getAuthContext(event);
    if (!authContext) {
      return unauthorized();
    }
    if (!allowedRoles.includes(authContext.role)) {
      return forbidden('Insufficient permissions');
    }
    return handler(event, authContext);
  };
}

export function canUpdateStage(role: UserRole, stage: StageName): boolean {
  const allowedStages = STAGE_PERMISSIONS[role];
  return allowedStages?.includes(stage) ?? false;
}

export function canManageLinks(role: UserRole): boolean {
  return role === 'admin' || role === 'bim_coordinator';
}

export function canDeleteNote(role: UserRole, authorId: string, userId: string): boolean {
  return role === 'admin' || authorId === userId;
}

export function canEditNote(authorId: string, userId: string): boolean {
  return authorId === userId;
}

// Issue authorization helpers
export function canCreateIssue(role: UserRole): boolean {
  return role !== 'view_only';
}

export function canEditIssue(authorId: string, userId: string): boolean {
  return authorId === userId;
}

export function canDeleteIssue(role: UserRole, authorId: string, userId: string): boolean {
  return role === 'admin' || authorId === userId;
}

export function canCloseIssue(role: UserRole, authorId: string, userId: string): boolean {
  // Creator or Admin can close/reopen
  return role === 'admin' || authorId === userId;
}
