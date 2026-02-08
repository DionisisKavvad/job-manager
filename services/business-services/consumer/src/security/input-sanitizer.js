const DANGEROUS_PATTERNS = [
  /\{\{.*\}\}/g,        // template injection
  /<script[\s>]/gi,     // XSS
  /javascript:/gi,      // XSS via protocol
  /on\w+\s*=/gi,        // event handler injection
];

export function sanitizePromptInput(input) {
  if (typeof input === 'string') {
    let sanitized = input;
    for (const pattern of DANGEROUS_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[REMOVED]');
    }
    return sanitized;
  }

  if (typeof input === 'object' && input !== null) {
    if (Array.isArray(input)) {
      return input.map(item => sanitizePromptInput(item));
    }
    const sanitized = {};
    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = sanitizePromptInput(value);
    }
    return sanitized;
  }

  return input;
}
