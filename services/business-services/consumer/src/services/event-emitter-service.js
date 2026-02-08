import { randomUUID } from 'node:crypto';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getAwsConfig } from '../utils/aws-credentials.js';

const ebClient = new EventBridgeClient(getAwsConfig());

const TENANT_ID = process.env.TENANT_ID || 'gbInnovations';
const APP_NAME = process.env.APP_NAME || 'task-workflow';
const EVENT_BUS_NAME = process.env.EVENTBRIDGE_BUS_NAME || 'default';

function buildEvent(eventType, { entityId, entityType, properties, context: extraContext }) {
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
      environment: process.env.NODE_ENV || 'dev',
      origin: 'sqs-worker',
      ...extraContext,
    },
    properties,
  };
}

export async function emitEvent(eventType, { entityId, entityType, properties, context }) {
  const event = buildEvent(eventType, { entityId, entityType, properties, context });

  await ebClient.send(new PutEventsCommand({
    Entries: [{
      EventBusName: EVENT_BUS_NAME,
      Source: `task-workflow.${APP_NAME}`,
      DetailType: 'log-event',
      Detail: JSON.stringify(event),
      Time: new Date(event.timestamp),
    }],
  }));

  return event;
}
