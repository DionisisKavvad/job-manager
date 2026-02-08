const jobs = [
  {
    jobId: "job-brand-analysis",
    name: "Brand Analysis for Store X",
    status: "processing",
    createdAt: "2025-01-15T10:00:00Z",
    tasks: [
      {
        taskId: "scrape-store",
        name: "Scrape Store",
        tag: "scraper",
        status: "completed",
        iteration: 1,
        dependsOn: [],
        requiresReview: false,
        repo: null,
      },
      {
        taskId: "color-tags",
        name: "Color Tags",
        tag: "designer",
        status: "in_review",
        iteration: 1,
        dependsOn: ["scrape-store"],
        requiresReview: true,
        repo: "org/frontend-app",
      },
      {
        taskId: "font-pairing",
        name: "Font Pairing",
        tag: "designer",
        status: "processing",
        iteration: 2,
        dependsOn: ["scrape-store"],
        requiresReview: true,
        repo: "org/frontend-app",
      },
      {
        taskId: "compile-result",
        name: "Compile Result",
        tag: "compiler",
        status: "pending",
        iteration: 1,
        dependsOn: ["color-tags", "font-pairing"],
        requiresReview: false,
        repo: null,
      },
    ],
  },
  {
    jobId: "job-competitor-research",
    name: "Competitor Research",
    status: "completed",
    createdAt: "2025-01-14T08:30:00Z",
    tasks: [
      {
        taskId: "analyze-competitors",
        name: "Analyze Competitors",
        tag: "analyst",
        status: "completed",
        iteration: 1,
        dependsOn: [],
        requiresReview: false,
        repo: null,
      },
      {
        taskId: "compile-report",
        name: "Compile Report",
        tag: "compiler",
        status: "completed",
        iteration: 1,
        dependsOn: ["analyze-competitors"],
        requiresReview: false,
        repo: null,
      },
    ],
  },
  {
    jobId: "job-store-redesign",
    name: "Store Redesign",
    status: "partial_failure",
    createdAt: "2025-01-13T14:00:00Z",
    tasks: [
      {
        taskId: "scrape-store-rd",
        name: "Scrape Store",
        tag: "scraper",
        status: "completed",
        iteration: 1,
        dependsOn: [],
        requiresReview: false,
        repo: null,
      },
      {
        taskId: "generate-layout",
        name: "Generate Layout",
        tag: "designer",
        status: "failed",
        iteration: 1,
        dependsOn: ["scrape-store-rd"],
        requiresReview: false,
        repo: "org/frontend-app",
      },
    ],
  },
];

export function getJobs() {
  return jobs;
}

export function getJobById(id) {
  return jobs.find((job) => job.jobId === id) || null;
}

export function getTasksForJob(jobId) {
  const job = getJobById(jobId);
  return job ? job.tasks : [];
}

export function getAllTasks() {
  return jobs.flatMap((job) =>
    job.tasks.map((task) => ({ ...task, jobName: job.name }))
  );
}
