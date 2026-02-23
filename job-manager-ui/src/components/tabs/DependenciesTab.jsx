import { useAppContext } from "../../context/AppContext";
import { STATUS_NODE_COLORS } from "../../utils/task-states";

function TaskLink({ task, onClick }) {
  const colors = STATUS_NODE_COLORS[task.status] || STATUS_NODE_COLORS.pending;

  return (
    <button
      onClick={() => onClick(task.taskId)}
      className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 w-full text-left transition-colors cursor-pointer"
    >
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${colors.dot}`} />
      <span className="text-sm text-gray-900 truncate">{task.name || task.taskId}</span>
      <span className={`ml-auto text-xs ${colors.text}`}>{task.status.replace("_", " ")}</span>
    </button>
  );
}

export default function DependenciesTab({ task, allTasks }) {
  const { selectTask } = useAppContext();

  // Upstream: tasks this task depends on
  const upstream = (task.dependsOn || [])
    .map((id) => allTasks.find((t) => t.taskId === id))
    .filter(Boolean);

  // Downstream: tasks that depend on this task
  const downstream = allTasks.filter(
    (t) => t.dependsOn?.includes(task.taskId)
  );

  return (
    <div className="space-y-4">
      {/* Upstream */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Upstream ({upstream.length})
        </h4>
        {upstream.length === 0 ? (
          <p className="text-xs text-gray-400">No upstream dependencies</p>
        ) : (
          <div className="space-y-1">
            {upstream.map((t) => (
              <TaskLink key={t.taskId} task={t} onClick={selectTask} />
            ))}
          </div>
        )}
      </div>

      {/* Downstream */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Downstream ({downstream.length})
        </h4>
        {downstream.length === 0 ? (
          <p className="text-xs text-gray-400">No downstream dependents</p>
        ) : (
          <div className="space-y-1">
            {downstream.map((t) => (
              <TaskLink key={t.taskId} task={t} onClick={selectTask} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
