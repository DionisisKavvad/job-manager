function formatOutput(output) {
  if (output == null) return null;
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

export default function ResultTab({ task }) {
  const formattedOutput = formatOutput(task.output);

  return (
    <div className="space-y-3">
      {task.summary && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Summary
          </h4>
          <p className="text-sm text-gray-700">{task.summary}</p>
        </div>
      )}

      {task.description && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Description
          </h4>
          <p className="text-sm text-gray-700">{task.description}</p>
        </div>
      )}

      {formattedOutput ? (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Output
          </h4>
          <pre className="text-xs text-gray-800 bg-gray-50 rounded-lg border border-gray-200 p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
            {formattedOutput}
          </pre>
        </div>
      ) : (
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-xs text-gray-500">
            Output not yet available.
          </p>
        </div>
      )}
    </div>
  );
}
