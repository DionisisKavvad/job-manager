import { getTagColor } from "../utils/task-states";

export default function TaskCard({ task, onClick }) {
  const tagClass = getTagColor(task.tag);

  return (
    <div
      onClick={() => onClick?.(task.taskId)}
      className={`bg-white rounded-lg border border-gray-200 p-3 shadow-sm transition-shadow ${
        onClick ? "cursor-pointer hover:shadow-md hover:border-gray-300" : ""
      }`}
    >
      <p className="font-medium text-sm text-gray-900">{task.name || task.taskId}</p>

      {task.description && (
        <p className="mt-1 text-xs text-gray-500 line-clamp-2">{task.description}</p>
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

      {task.dependsOn?.length > 0 && (
        <p className="mt-1 text-xs text-gray-400">
          depends: {task.dependsOn.join(", ")}
        </p>
      )}
    </div>
  );
}
