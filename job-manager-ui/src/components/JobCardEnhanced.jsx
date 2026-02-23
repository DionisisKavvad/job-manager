import { JOB_STATUS_COLORS } from "../utils/task-states";

function truncateId(jobId) {
  // Show first 8 chars after "job-" prefix, or first 12 chars total
  if (jobId.startsWith("job-")) {
    return jobId.slice(0, 12) + "...";
  }
  return jobId.length > 16 ? jobId.slice(0, 16) + "..." : jobId;
}

function relativeTime(timestamp) {
  if (!timestamp) return "";
  const now = Date.now();
  const ts = typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
  const diffMs = now - ts;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function JobCardEnhanced({ job, isSelected, onSelect }) {
  const statusColors = JOB_STATUS_COLORS[job.status] || JOB_STATUS_COLORS.pending;

  return (
    <button
      onClick={() => onSelect(job.jobId)}
      className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors cursor-pointer ${
        isSelected
          ? "bg-blue-50 border-l-2 border-l-blue-500"
          : "hover:bg-gray-50 border-l-2 border-l-transparent"
      }`}
    >
      <p className="text-sm font-medium text-gray-900 truncate" title={job.jobId}>
        {truncateId(job.jobId)}
      </p>

      <div className="mt-1 flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${statusColors.dot}`} />
        <span className={`text-xs ${statusColors.text}`}>
          {job.status.replace("_", " ")}
        </span>
        <span className="text-xs text-gray-400">
          {job.totalTasks} task{job.totalTasks !== 1 ? "s" : ""}
        </span>
      </div>

      <p className="mt-0.5 text-xs text-gray-400">
        {relativeTime(job.createdAt)}
      </p>
    </button>
  );
}
