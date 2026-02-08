const NON_RETRYABLE_PATTERNS = {
  auth: [
    /401/i, /403/i, /AuthenticationError/i, /AuthorizationError/i,
    /InvalidCredentials/i, /AccessDenied/i,
  ],
  validation: [
    /400/i, /ValidationError/i, /Invalid.*format/i,
    /Unknown task type/i, /not found in task registry/i,
  ],
  parse: [
    /SyntaxError/i, /JSON.*parse/i, /Unexpected token/i,
  ],
  not_found: [
    /ENOENT/i, /MODULE_NOT_FOUND/i, /Cannot find module/i,
  ],
  programming: [
    /TypeError/i, /ReferenceError/i, /RangeError/i,
  ],
};

const RETRYABLE_PATTERNS = {
  timeout: [
    /TIMEOUT/i, /AbortError/i, /ETIMEDOUT/i, /ESOCKETTIMEDOUT/i,
  ],
  network: [
    /ECONNREFUSED/i, /ENOTFOUND/i, /ECONNRESET/i, /EPIPE/i,
    /EAI_AGAIN/i, /socket hang up/i, /network/i,
  ],
  rate_limit: [
    /429/i, /RateLimitError/i, /Too Many Requests/i, /rate.?limit/i,
  ],
  server_error: [
    /5\d{2}/i, /InternalServerError/i, /ServiceUnavailable/i,
    /BadGateway/i,
  ],
};

export function classifyError(error) {
  const message = error?.message || String(error);
  const code = error?.code || '';
  const status = error?.status || error?.statusCode || 0;
  const combined = `${message} ${code} ${status}`;

  // Check non-retryable first
  for (const [category, patterns] of Object.entries(NON_RETRYABLE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(combined)) {
        return { retryable: false, category };
      }
    }
  }

  // Check retryable
  for (const [category, patterns] of Object.entries(RETRYABLE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(combined)) {
        return { retryable: true, category };
      }
    }
  }

  // Default: non-retryable (safer to fail fast than retry forever)
  return { retryable: false, category: 'unknown' };
}
