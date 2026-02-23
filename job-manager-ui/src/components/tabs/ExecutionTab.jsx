export default function ExecutionTab({ task }) {
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Execution Details
        </h4>
        <div className="space-y-2">
          {task.lastEventAt && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Last Activity</span>
              <span className="text-gray-900">{new Date(task.lastEventAt).toLocaleString()}</span>
            </div>
          )}
          {task.iteration && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Iteration</span>
              <span className="text-gray-900">{task.iteration}</span>
            </div>
          )}
          {task.status && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Status</span>
              <span className="text-gray-900">{task.status.replace("_", " ")}</span>
            </div>
          )}
        </div>
      </div>

      <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-xs text-gray-500">
          Duration, token usage, and cache metrics will be available when the API is extended
          to include execution telemetry.
        </p>
      </div>
    </div>
  );
}
