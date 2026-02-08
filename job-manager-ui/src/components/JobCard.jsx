import { JOB_STATUS_COLORS } from "../utils/task-states";

export default function JobCard({ job, isSelected, onSelect }) {
  const totalTasks = job.tasks.length;
  const completedTasks = job.tasks.filter(
    (t) => t.status === "completed"
  ).length;
  const allDone = completedTasks === totalTasks;
  const statusColors = JOB_STATUS_COLORS[job.status] || JOB_STATUS_COLORS.pending;

  return (
    <button
      onClick={() => onSelect(job.jobId)}
      className={`flex-shrink-0 w-[200px] text-left rounded-lg border p-4 transition-all cursor-pointer ${
        isSelected
          ? "border-blue-500 ring-2 ring-blue-200 bg-blue-50"
          : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
      }`}
    >
      <h3 className="font-semibold text-sm text-gray-900 truncate">
        {job.name}
      </h3>

      <p className="mt-1 text-xs text-gray-500">
        {totalTasks} task{totalTasks !== 1 ? "s" : ""} &middot;{" "}
        {allDone ? "done" : `${completedTasks}/${totalTasks}`}
      </p>

      <div className="mt-2 flex items-center gap-1.5">
        <span
          className={`w-2 h-2 rounded-full ${statusColors.dot}`}
        />
        <span className={`text-xs font-medium ${statusColors.text}`}>
          {job.status.replace("_", " ")}
        </span>
      </div>
    </button>
  );
}
