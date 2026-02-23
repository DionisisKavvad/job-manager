import { useAppContext } from "../context/AppContext";
import { useJobDetail } from "../hooks/useJobDetail";
import { STATUS_NODE_COLORS, getTagColor } from "../utils/task-states";
import TaskDetailTabs from "./TaskDetailTabs";

function formatTimestamp(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

export default function TaskDetailDrawer() {
  const { selectedJobId, selectedTaskId, closeDrawer } = useAppContext();
  const { data: job } = useJobDetail(selectedJobId);

  const task = job?.tasks?.find((t) => t.taskId === selectedTaskId);
  const allTasks = job?.tasks || [];

  if (!task) {
    return (
      <div className="w-[420px] flex-shrink-0 border-l border-gray-200 bg-white flex items-center justify-center">
        <p className="text-sm text-gray-400">Task not found</p>
      </div>
    );
  }

  const colors = STATUS_NODE_COLORS[task.status] || STATUS_NODE_COLORS.pending;
  const tagClass = getTagColor(task.tag);

  return (
    <div className="w-[420px] flex-shrink-0 border-l border-gray-200 bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 truncate">
              {task.name || task.taskId}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5 truncate">{task.taskId}</p>
          </div>
          <button
            onClick={closeDrawer}
            className="ml-2 p-1 text-gray-400 hover:text-gray-600 rounded cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Status row */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${colors.bg} ${colors.border} border`}>
            <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
            <span className={colors.text}>{task.status.replace("_", " ")}</span>
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${tagClass}`}>
            {task.tag}
          </span>
          {task.requiresReview && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              review
            </span>
          )}
        </div>

        {/* Metadata */}
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
          {task.repo && (
            <>
              <span className="text-gray-400">Repo</span>
              <span className="truncate">{task.repo}</span>
            </>
          )}
          {task.iteration > 1 && (
            <>
              <span className="text-gray-400">Iteration</span>
              <span>{task.iteration}</span>
            </>
          )}
          {task.lastEventType && (
            <>
              <span className="text-gray-400">Last Event</span>
              <span>{task.lastEventType}</span>
            </>
          )}
          {task.lastEventAt && (
            <>
              <span className="text-gray-400">Event At</span>
              <span>{formatTimestamp(task.lastEventAt)}</span>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <TaskDetailTabs task={task} allTasks={allTasks} />
    </div>
  );
}
