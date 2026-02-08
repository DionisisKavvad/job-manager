const SENSITIVE_PATTERNS = [
  { pattern: /AWS[A-Z0-9]{16,}/g, replacement: '[AWS_KEY]' },
  { pattern: /[a-zA-Z0-9/+=]{40,}/g, replacement: '[REDACTED]' },
  { pattern: /Bearer\s+[^\s]+/gi, replacement: 'Bearer [REDACTED]' },
  { pattern: /x-api-key[:\s]+[^\s]+/gi, replacement: 'x-api-key: [REDACTED]' },
  { pattern: /password[:\s]*[^\s,}]+/gi, replacement: 'password: [REDACTED]' },
  { pattern: /token[:\s]*[^\s,}]+/gi, replacement: 'token: [REDACTED]' },
];

export function sanitizeErrorMessage(message) {
  if (typeof message !== 'string') return String(message);

  let sanitized = message;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}
