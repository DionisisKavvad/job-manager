import { classifyError } from './error-classifier.js';

const DEFAULT_OPTIONS = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

export async function withRetry(fn, options = {}) {
  const { maxAttempts, baseDelayMs, maxDelayMs } = { ...DEFAULT_OPTIONS, ...options };

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      const classification = classifyError(error);

      if (!classification.retryable || attempt === maxAttempts) {
        throw error;
      }

      // Exponential backoff with jitter
      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000,
        maxDelayMs
      );

      console.log(`Retry ${attempt}/${maxAttempts} after ${Math.round(delay)}ms (${classification.category})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
