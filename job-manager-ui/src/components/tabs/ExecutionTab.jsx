function formatDuration(ms) {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatNumber(n) {
  if (n == null) return '—';
  return n.toLocaleString();
}

export default function ExecutionTab({ task }) {
  const usage = task.usage;
  const hasUsage = usage && typeof usage === 'object' && Object.keys(usage).length > 0;

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Execution Details
        </h4>
        <div className="space-y-2">
          {task.durationMs != null && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Duration</span>
              <span className="text-gray-900">{formatDuration(task.durationMs)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Iteration</span>
            <span className="text-gray-900">{task.iteration || 1}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Status</span>
            <span className="text-gray-900">{(task.status || 'unknown').replace("_", " ")}</span>
          </div>
          {task.lastEventAt && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Last Activity</span>
              <span className="text-gray-900">{new Date(task.lastEventAt).toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>

      {hasUsage && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Token Usage
          </h4>
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Input Tokens</span>
              <span className="text-gray-900">{formatNumber(usage.inputTokens)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Output Tokens</span>
              <span className="text-gray-900">{formatNumber(usage.outputTokens)}</span>
            </div>
            {usage.cacheReadInputTokens != null && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Cache Read</span>
                <span className="text-gray-900">{formatNumber(usage.cacheReadInputTokens)}</span>
              </div>
            )}
            {usage.cacheCreationInputTokens != null && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Cache Creation</span>
                <span className="text-gray-900">{formatNumber(usage.cacheCreationInputTokens)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {!task.durationMs && !hasUsage && (
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-xs text-gray-500">
            Duration and token usage will appear after the task completes.
          </p>
        </div>
      )}
    </div>
  );
}
