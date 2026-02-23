export default function EventsTimelineTab({ task }) {
  const hasEvent = task.lastEventType && task.lastEventAt;

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        Event Timeline
      </h4>

      {hasEvent ? (
        <div className="relative pl-4 border-l-2 border-gray-200">
          <div className="mb-4">
            <div className="absolute -left-[5px] w-2 h-2 rounded-full bg-blue-400 mt-1.5" />
            <p className="text-sm font-medium text-gray-900">{task.lastEventType}</p>
            <p className="text-xs text-gray-400">
              {new Date(task.lastEventAt).toLocaleString()}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-400">No events recorded yet.</p>
      )}

      <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-xs text-gray-500">
          A full chronological event timeline will be available when the API is extended
          to return all task events.
        </p>
      </div>
    </div>
  );
}
