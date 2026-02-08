import { TAG_COLORS } from "../utils/task-states";

export default function TaskCard({ task }) {
  const tagClass = TAG_COLORS[task.tag] || "bg-gray-100 text-gray-700";

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
      <p className="font-medium text-sm text-gray-900">{task.taskId}</p>
      {task.jobName && (
        <p className="text-xs text-gray-400 truncate">{task.jobName}</p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <span
          className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${tagClass}`}
        >
          {task.tag}
        </span>
        {task.requiresReview && (
          <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
            review
          </span>
        )}
      </div>

      {task.iteration > 1 && (
        <p className="mt-2 text-xs text-gray-500">iter: {task.iteration}</p>
      )}

      {task.repo && (
        <p className="mt-1 text-xs text-gray-500 truncate">
          repo: {task.repo}
        </p>
      )}

      {task.dependsOn.length > 0 && (
        <p className="mt-1 text-xs text-gray-400">
          depends: {task.dependsOn.join(", ")}
        </p>
      )}
    </div>
  );
}
