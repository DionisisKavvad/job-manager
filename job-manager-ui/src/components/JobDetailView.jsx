import { useAppContext } from "../context/AppContext";
import { useJobDetail } from "../hooks/useJobDetail";
import { JOB_STATUS_COLORS } from "../utils/task-states";
import ProgressBar from "./ProgressBar";
import ViewToggle from "./ViewToggle";
import KanbanBoard from "./KanbanBoard";
import DagView from "./dag/DagView";

export default function JobDetailView() {
  const { selectedJobId, viewMode, selectTask } = useAppContext();
  const { data: job, loading, error } = useJobDetail(selectedJobId);

  // Empty state: no job selected
  if (!selectedJobId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="text-center">
          <svg className="mx-auto w-12 h-12 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-sm">Select a job to view its tasks</p>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading && !job) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Error state
  if (error && !job) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-red-500">
          <p className="text-sm font-medium">Failed to load job details</p>
          <p className="text-xs mt-1 text-red-400">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!job) return null;

  const statusColors = JOB_STATUS_COLORS[job.status] || JOB_STATUS_COLORS.pending;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 bg-white border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900" title={job.jobId}>
              {job.jobId}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`w-2 h-2 rounded-full ${statusColors.dot}`} />
              <span className={`text-xs font-medium ${statusColors.text}`}>
                {job.status.replace("_", " ")}
              </span>
              <span className="text-xs text-gray-400">
                {job.totalTasks || job.tasks?.length || 0} tasks
              </span>
            </div>
          </div>
          <ViewToggle />
        </div>

        <ProgressBar progress={job.progress} totalTasks={job.totalTasks || job.tasks?.length} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === "dag" && (
          <DagView tasks={job.tasks || []} onTaskClick={selectTask} />
        )}
        {viewMode === "kanban" && (
          <div className="p-4 overflow-auto h-full">
            <KanbanBoard tasks={job.tasks || []} onTaskClick={selectTask} />
          </div>
        )}
      </div>
    </div>
  );
}
