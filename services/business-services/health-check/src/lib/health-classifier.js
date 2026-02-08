import { config } from './config.js';

export function classifyHealth({ elapsed, timeSinceLastEvent }) {
  if (elapsed > config.TASK_MAX_DURATION_MS) {
    return 'overtime';
  }

  if (timeSinceLastEvent <= config.HEARTBEAT_MAX_AGE_MS) {
    return 'healthy';
  }

  if (timeSinceLastEvent <= config.ALERT_THRESHOLD_MS) {
    return 'warning';
  }

  return 'critical';
}
