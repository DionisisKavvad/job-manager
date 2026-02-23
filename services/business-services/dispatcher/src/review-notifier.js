export async function handler(event) {
  const detail = event.detail;
  const props = detail.properties;

  const taskId = props.requestId;
  const jobId = props.jobId;
  const name = props.name || null;
  const summary = props.summary || null;
  const iteration = props.iteration || 1;

  // Log review notification (Slack/email integration can be added via SLACK_WEBHOOK_URL)
  console.log(`[REVIEW-NOTIFIER] Task ${taskId} (job: ${jobId}) submitted for review`, {
    taskId,
    jobId,
    name,
    summary,
    iteration,
  });

  if (process.env.SLACK_WEBHOOK_URL) {
    try {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `Task *${name || taskId}* (iteration ${iteration}) is ready for review.\nJob: ${jobId}\nSummary: ${summary || 'N/A'}`,
        }),
      });
    } catch (err) {
      console.error(`[REVIEW-NOTIFIER] Slack notification failed:`, err.message);
    }
  }
}
