import { randomUUID } from 'node:crypto';
import { config } from './config.js';

export function buildEvent(eventType, { entityId, entityType, properties }) {
  const timestamp = Date.now();
  const eventId = randomUUID();

  return {
    PK: `TENANT#${config.TENANT_ID}`,
    SK: `TIMESTAMP#${timestamp}#EVENT#${eventId}`,

    GSI1PK: `${entityType}#${entityId}`,
    GSI1SK: `${entityType}#TIMESTAMP#${timestamp}`,

    GSI2PK: `APP#${config.APP_NAME}`,
    GSI2SK: `TIMESTAMP#${timestamp}`,

    GSI3PK: `APP#${config.APP_NAME}`,
    GSI3SK: `${entityType}#${entityId}#TIMESTAMP#${timestamp}`,

    GSI4PK: `EVENT#${eventType}`,
    GSI4SK: `TENANT#${config.TENANT_ID}#TIMESTAMP#${timestamp}`,

    GSI5PK: `EVENT#${eventType}`,
    GSI5SK: `TENANT#${config.TENANT_ID}#${entityType}#${entityId}#TIMESTAMP#${timestamp}`,

    GSI6PK: `EVENT#${eventType}`,
    GSI6SK: `TENANT#${config.TENANT_ID}#APP#${config.APP_NAME}#TIMESTAMP#${timestamp}`,

    GSI7PK: `EVENT#${eventType}`,
    GSI7SK: `TENANT#${config.TENANT_ID}#APP#${config.APP_NAME}#${entityType}#${entityId}#TIMESTAMP#${timestamp}`,

    entityId,
    entityType,
    tenantId: config.TENANT_ID,
    eventType,
    timestamp,
    context: {
      source: 'system',
      environment: process.env.ENVIRONMENT || 'dev',
      origin: 'producer-api',
    },
    properties,
  };
}
