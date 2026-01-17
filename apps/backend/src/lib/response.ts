import type { APIGatewayProxyResult } from 'aws-lambda';
import type { ErrorCode, ApiError } from '@unisync/shared-types';
import { HTTP_STATUS } from '@unisync/shared-types';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

export function success<T>(data: T, statusCode = 200): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
    body: JSON.stringify({ data }),
  };
}

export function error(
  code: ErrorCode,
  message: string,
  details?: Record<string, string>
): APIGatewayProxyResult {
  const apiError: ApiError = {
    error: {
      code,
      message,
      ...(details && { details }),
    },
  };

  return {
    statusCode: HTTP_STATUS[code],
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
    body: JSON.stringify(apiError),
  };
}

export function validationError(
  message: string,
  details?: Record<string, string>
): APIGatewayProxyResult {
  return error('VALIDATION_ERROR', message, details);
}

export function notFound(resource: string): APIGatewayProxyResult {
  return error('NOT_FOUND', `${resource} not found`);
}

export function forbidden(message = 'Access denied'): APIGatewayProxyResult {
  return error('FORBIDDEN', message);
}

export function unauthorized(message = 'Unauthorized'): APIGatewayProxyResult {
  return error('UNAUTHORIZED', message);
}

export function conflict(message: string): APIGatewayProxyResult {
  return error('CONFLICT', message);
}

export function internalError(message = 'Internal server error'): APIGatewayProxyResult {
  return error('INTERNAL_ERROR', message);
}
