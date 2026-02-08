export const config = {
  HEARTBEAT_MAX_AGE_MS: 5 * 60 * 1000,      // 5 minutes
  ALERT_THRESHOLD_MS: 10 * 60 * 1000,        // 10 minutes
  TASK_MAX_DURATION_MS: 60 * 60 * 1000,      // 1 hour
  LOOKBACK_WINDOW_MS: 24 * 60 * 60 * 1000,   // 24 hours

  TABLE_NAME: process.env.EVENTS_TABLE,
  TENANT_ID: process.env.TENANT_ID || 'gbInnovations',
  APP_NAME: process.env.APP_NAME || 'task-workflow',

  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  ALERT_CHANNEL: process.env.ALERT_CHANNEL,
};
