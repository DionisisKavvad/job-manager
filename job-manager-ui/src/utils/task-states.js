export const COLUMNS = [
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
};

export const JOB_STATUS_COLORS = {
  pending: { dot: "bg-gray-400", text: "text-gray-600" },
  processing: { dot: "bg-blue-400", text: "text-blue-600" },
  completed: { dot: "bg-green-400", text: "text-green-600" },
  partial_failure: { dot: "bg-red-400", text: "text-red-600" },
  failed: { dot: "bg-red-400", text: "text-red-600" },
};
