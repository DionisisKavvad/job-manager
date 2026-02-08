export const config = {
  TABLE_NAME: process.env.EVENTS_TABLE,
  TASK_DEFINITIONS_TABLE: process.env.TASK_DEFINITIONS_TABLE,
  TASK_QUEUE_URL: process.env.TASK_QUEUE_URL,
  EVENT_BUS_NAME: process.env.EVENT_BUS_NAME,
  TENANT_ID: process.env.TENANT_ID || 'gbInnovations',
  APP_NAME: process.env.APP_NAME || 'task-workflow',
};
