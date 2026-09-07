import { ProviderError } from '../providers/types';

export type HttpError = Error & { statusCode: number; code: string; retryAfterMs?: number };

export function httpError(
  statusCode: number,
  code: string,
  message: string,
  retryAfterMs?: number,
): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  error.code = code;
  if (retryAfterMs !== undefined) error.retryAfterMs = retryAfterMs;
  return error;
}

const PROVIDER_CODE_STATUS: Record<string, number> = {
  invalid_key: 400,
  no_key: 400,
  insufficient_credits: 402,
  rate_limited: 429,
  upstream_error: 502,
  network_error: 502,
  malformed_response: 502,
};

/** Maps a ProviderError onto the API's error envelope (statusCode + code). */
export function toHttpError(error: unknown): HttpError {
  if (error instanceof ProviderError) {
    const statusCode = error.statusCode ?? PROVIDER_CODE_STATUS[error.code] ?? 502;
    return httpError(statusCode, error.code, error.message, error.retryAfterMs);
  }
  if (error instanceof Error) {
    const withStatus = error as Error & { statusCode?: number; code?: string };
    if (typeof withStatus.statusCode === 'number') {
      return error as HttpError;
    }
    return httpError(500, 'internal_error', error.message);
  }
  return httpError(500, 'internal_error', 'Unexpected error');
}
