export function buildExecutionSummary({ requestId, taskName, startTime, endTime, result, usage, error: err }) {
  const durationMs = endTime - startTime;

  return {
    requestId,
    taskName,
    durationMs,
    startedAt: new Date(startTime).toISOString(),
    completedAt: new Date(endTime).toISOString(),
    success: !err,
    ...(result && { outputPreview: truncateOutput(result) }),
    ...(usage && { usage }),
    ...(err && { error: { message: err.message, category: err.category } }),
  };
}

function truncateOutput(output) {
  const str = typeof output === 'string' ? output : JSON.stringify(output);
  if (str.length <= 500) return str;
  return str.substring(0, 500) + '...';
}
