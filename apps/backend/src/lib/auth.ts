import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { UserRole } from '@unisync/shared-types';

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  cognitoSub: string;
  canEditVersions: boolean;
}

export function getAuthContext(event: APIGatewayProxyEvent): AuthContext | null {
  const claims = event.requestContext.authorizer?.claims;

  if (!claims) {
    return null;
  }

  const role = (claims['custom:role'] ?? 'viewer') as UserRole;
  return {
    userId: claims['custom:userId'] ?? claims.sub,
    email: claims.email,
    name: claims.name ?? claims.email,
    role,
    cognitoSub: claims.sub,
    // Admins always have version edit permission; others need explicit grant
    canEditVersions: role === 'admin' || claims['custom:canEditVersions'] === 'true',
  };
}

export function requireAuth(event: APIGatewayProxyEvent): AuthContext {
  const context = getAuthContext(event);
  if (!context) {
    throw new Error('Unauthorized');
  }
  return context;
}

export function requireRole(
  event: APIGatewayProxyEvent,
  allowedRoles: UserRole[]
): AuthContext {
  const context = requireAuth(event);
  if (!allowedRoles.includes(context.role)) {
    throw new Error('Forbidden');
  }
  return context;
}

export function isAdmin(role: UserRole): boolean {
  return role === 'admin';
}

export function isBimCoordinator(role: UserRole): boolean {
  return role === 'admin' || role === 'bim_coordinator';
}

export function isEngineer(role: UserRole): boolean {
  return role === 'engineer';
}

export function isCustomerReviewer(role: UserRole): boolean {
  return role === 'customer_reviewer';
}

export function isViewOnly(role: UserRole): boolean {
  return role === 'view_only';
}

// Roles that can only approve/reject, not work on stages
export function isApprovalOnlyRole(role: UserRole): boolean {
  return role === 'engineer' || role === 'customer_reviewer';
}

// Only admin can create/delete ShowSets
export function canManageShowSets(role: UserRole): boolean {
  return role === 'admin';
}

// Can work on stages (not just approve)
export function canWorkOnStages(role: UserRole): boolean {
  return role === 'admin' || role === 'bim_coordinator' || role === '3d_modeller' || role === '2d_drafter';
}

// Engineer can only approve (complete) or request revision
export function canApproveStages(role: UserRole): boolean {
  return role === 'admin' || role === 'bim_coordinator' || role === 'engineer';
}

export function canManageUsers(role: UserRole): boolean {
  return role === 'admin';
}

// Any operator (except view_only and reviewer) can request upstream revisions
export function canRequestUpstreamRevision(role: UserRole): boolean {
  return role !== 'view_only' && role !== 'reviewer';
}
