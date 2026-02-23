export const COLUMNS = [
  {
    key: "waiting",
    label: "Waiting",
    color: "slate",
    headerBg: "bg-slate-100",
    headerText: "text-slate-700",
    dotColor: "bg-slate-400",
  },
  {
    key: "pending",
    label: "Pending",
    color: "gray",
    headerBg: "bg-gray-100",
    headerText: "text-gray-700",
    dotColor: "bg-gray-400",
  },
  {
    key: "processing",
    label: "Processing",
    color: "blue",
    headerBg: "bg-blue-100",
    headerText: "text-blue-700",
    dotColor: "bg-blue-400",
  },
  {
    key: "in_review",
    label: "In Review",
    color: "amber",
    headerBg: "bg-amber-100",
    headerText: "text-amber-700",
    dotColor: "bg-amber-400",
  },
  {
    key: "completed",
    label: "Completed",
    color: "green",
    headerBg: "bg-green-100",
    headerText: "text-green-700",
    dotColor: "bg-green-400",
  },
  {
    key: "failed",
    label: "Failed",
    color: "red",
    headerBg: "bg-red-100",
    headerText: "text-red-700",
    dotColor: "bg-red-400",
  },
];

export function groupTasksByState(tasks) {
  const grouped = {};
  for (const col of COLUMNS) {
    grouped[col.key] = [];
  }
  for (const task of tasks) {
    const key = task.status;
    if (grouped[key]) {
      grouped[key].push(task);
    }
  }
  return grouped;
}

export const TAG_COLORS = {
  designer: "bg-purple-100 text-purple-700",
  scraper: "bg-cyan-100 text-cyan-700",
  compiler: "bg-orange-100 text-orange-700",
  analyst: "bg-indigo-100 text-indigo-700",
  "backend-developer": "bg-blue-100 text-blue-700",
  "frontend-developer": "bg-teal-100 text-teal-700",
  developer: "bg-sky-100 text-sky-700",
  "test-engineer": "bg-lime-100 text-lime-700",
  debugger: "bg-rose-100 text-rose-700",
  "technical-writer": "bg-fuchsia-100 text-fuchsia-700",
  "data-engineer": "bg-violet-100 text-violet-700",
  "data-analyst": "bg-emerald-100 text-emerald-700",
  "code-reviewer": "bg-amber-100 text-amber-700",
  "senior-developer": "bg-blue-100 text-blue-800",
  "qa-engineer": "bg-lime-100 text-lime-800",
  architect: "bg-stone-100 text-stone-700",
};

export function getTagColor(tag) {
  return TAG_COLORS[tag] || "bg-gray-100 text-gray-700";
}

export const JOB_STATUS_COLORS = {
  pending: { dot: "bg-gray-400", text: "text-gray-600" },
  processing: { dot: "bg-blue-400", text: "text-blue-600" },
  completed: { dot: "bg-green-400", text: "text-green-600" },
  partial_failure: { dot: "bg-red-400", text: "text-red-600" },
  failed: { dot: "bg-red-400", text: "text-red-600" },
};

export const STATUS_NODE_COLORS = {
  waiting:    { bg: "bg-slate-50",  border: "border-slate-300", text: "text-slate-700", dot: "bg-slate-400" },
  pending:    { bg: "bg-gray-50",   border: "border-gray-300",  text: "text-gray-700",  dot: "bg-gray-400" },
  processing: { bg: "bg-blue-50",   border: "border-blue-400",  text: "text-blue-700",  dot: "bg-blue-400" },
  in_review:  { bg: "bg-amber-50",  border: "border-amber-400", text: "text-amber-700", dot: "bg-amber-400" },
  completed:  { bg: "bg-green-50",  border: "border-green-400", text: "text-green-700", dot: "bg-green-400" },
  failed:     { bg: "bg-red-50",    border: "border-red-400",   text: "text-red-700",   dot: "bg-red-400" },
};

export const STATUS_EDGE_COLORS = {
  waiting:    "#94a3b8",
  pending:    "#9ca3af",
  processing: "#3b82f6",
  in_review:  "#f59e0b",
  completed:  "#22c55e",
  failed:     "#ef4444",
};
