export default function FeedbackTab({ task, events }) {
  const revisionEvents = (events || []).filter(e => e.eventType === 'Task Revision Requested');

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Feedback Loop
        </h4>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-500">Iteration</span>
          <span className="font-medium text-gray-900">{task.iteration || 1}</span>
        </div>
      </div>

      {task.feedbackResult && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Feedback Result
          </h4>
          <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm">
            {typeof task.feedbackResult === 'object' ? (
              <pre className="text-xs whitespace-pre-wrap break-words">
                {JSON.stringify(task.feedbackResult, null, 2)}
              </pre>
            ) : (
              <p className="text-gray-700">{String(task.feedbackResult)}</p>
            )}
          </div>
        </div>
      )}

      {revisionEvents.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Revision History
          </h4>
          <div className="space-y-2">
            {revisionEvents.map((evt, i) => (
              <div key={i} className="p-2 bg-amber-50 rounded border border-amber-200">
                <div className="flex justify-between text-xs text-amber-700 mb-1">
                  <span>Iteration {evt.properties?.iteration || i + 1}</span>
                  <span>{new Date(evt.timestamp).toLocaleString()}</span>
                </div>
                {evt.properties?.feedback && (
                  <p className="text-xs text-gray-700">{evt.properties.feedback}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!task.feedbackResult && revisionEvents.length === 0 && task.iteration <= 1 && (
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-xs text-gray-500">
            First iteration — no feedback rounds yet.
          </p>
        </div>
      )}
    </div>
  );
}
