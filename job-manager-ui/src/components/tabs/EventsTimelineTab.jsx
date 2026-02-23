const EVENT_DOT_COLORS = {
  'Task Pending': 'bg-yellow-400',
  'Task Processing Started': 'bg-blue-400',
  'Task Processing Failed': 'bg-red-300',
  'Task Updated': 'bg-blue-300',
  'Task Heartbeat': 'bg-gray-300',
  'Task Completed': 'bg-green-500',
  'Task Submitted For Review': 'bg-amber-400',
  'Task Revision Requested': 'bg-orange-400',
  'Task Approved': 'bg-green-500',
  'Task Failed': 'bg-red-500',
  'Task Timeout': 'bg-red-500',
  'Task Saved': 'bg-gray-400',
};

export default function EventsTimelineTab({ task, events }) {
  const timelineEvents = events && events.length > 0 ? events : null;

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        Event Timeline
      </h4>

      {timelineEvents ? (
        <div className="relative pl-4 border-l-2 border-gray-200">
          {timelineEvents.map((evt, i) => (
            <div key={i} className="mb-3 relative">
              <div className={`absolute -left-[5px] w-2 h-2 rounded-full mt-1.5 ${EVENT_DOT_COLORS[evt.eventType] || 'bg-gray-400'}`} />
              <p className="text-sm font-medium text-gray-900">{evt.eventType}</p>
              <p className="text-xs text-gray-400">
                {new Date(evt.timestamp).toLocaleString()}
              </p>
              {evt.context?.workerId && (
                <p className="text-xs text-gray-400">Worker: {evt.context.workerId}</p>
              )}
              {evt.properties?.iteration > 1 && (
                <p className="text-xs text-gray-400">Iteration: {evt.properties.iteration}</p>
              )}
            </div>
          ))}
        </div>
      ) : task.lastEventType ? (
        <div className="relative pl-4 border-l-2 border-gray-200">
          <div className="mb-4 relative">
            <div className={`absolute -left-[5px] w-2 h-2 rounded-full mt-1.5 ${EVENT_DOT_COLORS[task.lastEventType] || 'bg-blue-400'}`} />
            <p className="text-sm font-medium text-gray-900">{task.lastEventType}</p>
            <p className="text-xs text-gray-400">
              {new Date(task.lastEventAt).toLocaleString()}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-400">No events recorded yet.</p>
      )}
    </div>
  );
}
