import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { UserRole } from '@unisync/shared-types';

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  cognitoSub: string;
}

export function getAuthContext(event: APIGatewayProxyEvent): AuthContext | null {
  const claims = event.requestContext.authorizer?.claims;

  if (!claims) {
    return null;
  }

  return {
    userId: claims['custom:userId'] ?? claims.sub,
    email: claims.email,
    name: claims.name ?? claims.email,
    role: (claims['custom:role'] ?? 'viewer') as UserRole,
    cognitoSub: claims.sub,
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

export function canManageShowSets(role: UserRole): boolean {
  return role === 'admin' || role === 'bim_coordinator';
}

export function canManageUsers(role: UserRole): boolean {
  return role === 'admin';
}
