export const config = {
  TABLE_NAME: process.env.EVENTS_TABLE,
  EVENT_BUS_NAME: process.env.EVENT_BUS_NAME,
  TENANT_ID: process.env.TENANT_ID || 'gbInnovations',
  APP_NAME: process.env.APP_NAME || 'task-workflow',
};
