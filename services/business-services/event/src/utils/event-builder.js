import { randomUUID } from 'node:crypto';

const TENANT_ID = process.env.TENANT_ID || 'gbInnovations';
const APP_NAME = process.env.APP_NAME || 'task-workflow';

export function buildEvent(eventType, { entityId, entityType, properties }) {
  const timestamp = Date.now();
  const eventId = randomUUID();

  return {
    PK: `TENANT#${TENANT_ID}`,
    SK: `TIMESTAMP#${timestamp}#EVENT#${eventId}`,

    GSI1PK: `${entityType}#${entityId}`,
    GSI1SK: `${entityType}#TIMESTAMP#${timestamp}`,

    GSI2PK: `APP#${APP_NAME}`,
    GSI2SK: `TIMESTAMP#${timestamp}`,

    GSI3PK: `APP#${APP_NAME}`,
    GSI3SK: `${entityType}#${entityId}#TIMESTAMP#${timestamp}`,

    GSI4PK: `EVENT#${eventType}`,
    GSI4SK: `TENANT#${TENANT_ID}#TIMESTAMP#${timestamp}`,

    GSI5PK: `EVENT#${eventType}`,
    GSI5SK: `TENANT#${TENANT_ID}#${entityType}#${entityId}#TIMESTAMP#${timestamp}`,

    GSI6PK: `EVENT#${eventType}`,
    GSI6SK: `TENANT#${TENANT_ID}#APP#${APP_NAME}#TIMESTAMP#${timestamp}`,

    GSI7PK: `EVENT#${eventType}`,
    GSI7SK: `TENANT#${TENANT_ID}#APP#${APP_NAME}#${entityType}#${entityId}#TIMESTAMP#${timestamp}`,

    entityId,
    entityType,
    tenantId: TENANT_ID,
    eventType,
    timestamp,
    context: {
      source: 'system',
      environment: process.env.ENVIRONMENT || 'dev',
      origin: 'event-service',
    },
    properties,
  };
}
