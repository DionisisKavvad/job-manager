import { useAppContext } from "../context/AppContext";
import { useJobs } from "../hooks/useJobs";
import JobCardEnhanced from "./JobCardEnhanced";

export default function JobListSidebar() {
  const { data: jobs, loading, error } = useJobs();
  const { selectedJobId, selectJob } = useAppContext();

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Jobs
        </h2>
      </div>

      {loading && !jobs && (
        <div className="flex items-center justify-center py-12">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && !jobs && (
        <div className="px-4 py-3 text-sm text-red-600 bg-red-50">
          Failed to load jobs
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {jobs?.map((job) => (
          <JobCardEnhanced
            key={job.jobId}
            job={job}
            isSelected={job.jobId === selectedJobId}
            onSelect={selectJob}
          />
        ))}

        {jobs?.length === 0 && (
          <p className="px-4 py-8 text-sm text-gray-400 text-center">
            No jobs found
          </p>
        )}
      </div>
    </div>
  );
}
