export async function handler(event) {
  for (const record of event.Records) {
    const failedEvent = JSON.parse(record.body);

    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: [
          ':rotating_light: *EventBridge delivery failure*',
          `*Event type:* ${failedEvent.detail?.eventType || 'unknown'}`,
          `*Detail type:* ${failedEvent['detail-type'] || 'unknown'}`,
          `*Task:* ${failedEvent.detail?.GSI1PK || 'unknown'}`,
          `*Time:* ${failedEvent.time || 'unknown'}`,
          `*Message ID:* ${record.messageId}`,
        ].join('\n'),
      }),
    });
  }
}
