import { ApiError } from '@/api';

export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code === 'http_error' ? error.message : `${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
