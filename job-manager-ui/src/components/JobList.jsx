import JobCard from "./JobCard";

export default function JobList({ jobs, selectedJobId, onSelectJob }) {
  const totalTasks = jobs.reduce((sum, j) => sum + j.tasks.length, 0);
  const totalCompleted = jobs.reduce(
    (sum, j) => sum + j.tasks.filter((t) => t.status === "completed").length,
    0
  );

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      <button
        onClick={() => onSelectJob("all")}
        className={`flex-shrink-0 w-[200px] text-left rounded-lg border p-4 transition-all cursor-pointer ${
          selectedJobId === "all"
            ? "border-blue-500 ring-2 ring-blue-200 bg-blue-50"
            : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
        }`}
      >
        <h3 className="font-semibold text-sm text-gray-900">All Jobs</h3>
        <p className="mt-1 text-xs text-gray-500">
          {totalTasks} tasks &middot; {totalCompleted}/{totalTasks}
        </p>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-400" />
          <span className="text-xs font-medium text-blue-600">overview</span>
        </div>
      </button>

      {jobs.map((job) => (
        <JobCard
          key={job.jobId}
          job={job}
          isSelected={job.jobId === selectedJobId}
          onSelect={onSelectJob}
        />
      ))}
    </div>
  );
}
