import { WebClient } from '@slack/web-api';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { config } from './config.js';

const slack = config.SLACK_BOT_TOKEN ? new WebClient(config.SLACK_BOT_TOKEN) : null;
const ebClient = new EventBridgeClient({});

export async function sendAlerts({ level, message, tasks }) {
  if (!slack || !config.ALERT_CHANNEL) {
    console.warn('Slack not configured — skipping alert');
    return;
  }

  const emoji = level === 'critical' ? ':red_circle:' : ':warning:';

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} Task Health: ${message}` },
    },
    {
      type: 'divider',
    },
    ...tasks.map(t => ({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*${t.requestId}*`,
          `Health: \`${t.health}\``,
          `Elapsed: ${Math.round(t.elapsed / 60000)}min`,
          `Last event: ${t.lastEventType} (${Math.round(t.timeSinceLastEvent / 60000)}min ago)`,
          `Worker: ${t.workerId || 'unknown'}`,
        ].join('\n'),
      },
    })),
  ];

  try {
    await slack.chat.postMessage({
      channel: config.ALERT_CHANNEL,
      text: `${emoji} ${level.toUpperCase()}: ${message}`,
      blocks,
    });
  } catch (error) {
    console.error('Failed to send Slack alert:', error.message);
  }
}

export async function emitHealthCheckEvent(summary) {
  if (!process.env.EVENT_BUS_NAME) return;

  await ebClient.send(new PutEventsCommand({
    Entries: [{
      EventBusName: process.env.EVENT_BUS_NAME,
      Source: 'task-health-check',
      DetailType: 'log-event',
      Detail: JSON.stringify({
        eventType: 'Task Health Check',
        tenantId: config.TENANT_ID,
        properties: { summary },
      }),
      Time: new Date(),
    }],
  }));
}
