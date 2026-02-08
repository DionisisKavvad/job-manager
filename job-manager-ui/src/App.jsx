import { useState } from "react";
import { getJobs, getTasksForJob, getAllTasks } from "./data/mock-data";
import JobList from "./components/JobList";
import KanbanBoard from "./components/KanbanBoard";

export default function App() {
  const jobs = getJobs();
  const [selectedJobId, setSelectedJobId] = useState("all");

  const isAll = selectedJobId === "all";
  const selectedJob = isAll ? null : jobs.find((j) => j.jobId === selectedJobId);
  const tasks = isAll ? getAllTasks() : getTasksForJob(selectedJobId);

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900">Job Manager</h1>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Jobs
          </h2>
          <JobList
            jobs={jobs}
            selectedJobId={selectedJobId}
            onSelectJob={setSelectedJobId}
          />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Tasks for: {isAll ? "All Jobs" : selectedJob?.name || "\u2014"}
          </h2>
          <KanbanBoard tasks={tasks} />
        </section>
      </main>
    </div>
  );
}
