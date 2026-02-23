export default function ResultTab({ task }) {
  return (
    <div className="space-y-3">
      {task.lastEventType && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Last Event
          </h4>
          <p className="text-sm text-gray-900">{task.lastEventType}</p>
          {task.lastEventAt && (
            <p className="text-xs text-gray-400 mt-0.5">
              {new Date(task.lastEventAt).toLocaleString()}
            </p>
          )}
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

      <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-xs text-gray-500">
          Detailed task output will be available when the API is extended to include result data.
        </p>
      </div>
    </div>
  );
}
