import { useState } from "react";
import { useAppContext } from "../context/AppContext";
import { useJobDetail } from "../hooks/useJobDetail";
import { STATUS_NODE_COLORS, getTagColor } from "../utils/task-states";
import { approveTask, requestRevision } from "../api/jobs";
import TaskDetailTabs from "./TaskDetailTabs";

const HAS_API = !!import.meta.env.VITE_API_URL;

function formatTimestamp(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function ReviewActions({ jobId, task }) {
  const [loading, setLoading] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [result, setResult] = useState(null);

  if (!HAS_API) return null;
  if (task.status !== "in_review" || !task.requiresReview) return null;

  async function handleApprove() {
    setLoading(true);
    setResult(null);
    try {
      await approveTask(jobId, task.taskId);
      setResult({ type: "success", message: "Task approved" });
    } catch (err) {
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleRevision() {
    if (!feedback.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await requestRevision(jobId, task.taskId, feedback.trim());
      setResult({ type: "success", message: `Revision requested (iteration ${res.iteration})` });
      setShowFeedback(false);
      setFeedback("");
    } catch (err) {
      setResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-4 py-2 border-b border-gray-200 flex-shrink-0">
      <div className="flex gap-2">
        <button
          onClick={handleApprove}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded disabled:opacity-50 cursor-pointer"
        >
          {loading ? "..." : "Approve"}
        </button>
        <button
          onClick={() => setShowFeedback(!showFeedback)}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded disabled:opacity-50 cursor-pointer"
        >
          Request Revision
        </button>
      </div>
      {showFeedback && (
        <div className="mt-2">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Describe what needs to be changed..."
            maxLength={5000}
            className="w-full text-xs border border-gray-300 rounded p-2 h-20 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={handleRevision}
            disabled={loading || !feedback.trim()}
            className="mt-1 px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded disabled:opacity-50 cursor-pointer"
          >
            Submit Feedback
          </button>
        </div>
      )}
      {result && (
        <p className={`mt-1 text-xs ${result.type === "success" ? "text-green-600" : "text-red-600"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}

export default function TaskDetailDrawer() {
  const { selectedJobId, selectedTaskId, closeDrawer } = useAppContext();
  const { data: job } = useJobDetail(selectedJobId);

  const task = job?.tasks?.find((t) => t.taskId === selectedTaskId);
  const allTasks = job?.tasks || [];

  if (!task) {
    return (
      <div className="w-[600px] flex-shrink-0 border-l border-gray-200 bg-white flex items-center justify-center">
        <p className="text-sm text-gray-400">Task not found</p>
      </div>
    );
  }

  const colors = STATUS_NODE_COLORS[task.status] || STATUS_NODE_COLORS.pending;
  const tagClass = getTagColor(task.tag);

  return (
    <div className="w-[600px] flex-shrink-0 border-l border-gray-200 bg-white flex flex-col overflow-hidden">
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

      {/* Review Actions */}
      <ReviewActions jobId={selectedJobId} task={task} />

      {/* Tabs */}
      <TaskDetailTabs task={task} allTasks={allTasks} jobId={selectedJobId} />
    </div>
  );
}
