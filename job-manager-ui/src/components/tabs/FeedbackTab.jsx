export default function FeedbackTab({ task }) {
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Feedback Loop
        </h4>
        {task.iteration > 1 ? (
          <p className="text-sm text-gray-700">
            Currently on iteration <span className="font-medium">{task.iteration}</span>
          </p>
        ) : (
          <p className="text-sm text-gray-500">First iteration — no feedback rounds yet.</p>
        )}
      </div>

      <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-xs text-gray-500">
          Detailed feedback data (pass/fail per command, review comments, iteration history) will
          be available when the API is extended to include feedback result data.
        </p>
      </div>
    </div>
  );
}
