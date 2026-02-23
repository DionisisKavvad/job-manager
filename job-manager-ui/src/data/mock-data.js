// Mock data shaped to match the real API responses from producer-api

const jobs = [
  {
    jobId: "job-a1b2c3d4-brand-analysis",
    status: "processing",
    totalTasks: 4,
    createdAt: Date.now() - 3600_000, // 1 hour ago
    completedAt: null,
    progress: { waiting: 0, pending: 1, processing: 1, in_review: 1, completed: 1, failed: 0 },
    tasks: [
      {
        taskId: "scrape-store",
        name: "Scrape Store",
        description: "Crawl the target store website and extract product data, images, and branding elements.",
        tag: "scraper",
        status: "completed",
        iteration: 1,
        dependsOn: [],
        requiresReview: false,
        repo: null,
        lastEventType: "Task Completed",
        lastEventAt: Date.now() - 2400_000,
      },
      {
        taskId: "color-tags",
        name: "Extract Color Palette",
        description: "Analyze scraped images to extract the brand color palette and generate design tokens.",
        tag: "designer",
        status: "in_review",
        iteration: 1,
        dependsOn: ["scrape-store"],
        requiresReview: true,
        repo: "org/frontend-app",
        lastEventType: "Review Requested",
        lastEventAt: Date.now() - 1200_000,
      },
      {
        taskId: "font-pairing",
        name: "Font Pairing",
        description: "Select and validate font pairings based on the brand identity analysis.",
        tag: "designer",
        status: "processing",
        iteration: 2,
        dependsOn: ["scrape-store"],
        requiresReview: true,
        repo: "org/frontend-app",
        lastEventType: "Task Processing",
        lastEventAt: Date.now() - 600_000,
      },
      {
        taskId: "compile-result",
        name: "Compile Brand Guide",
        description: "Combine color palette, typography, and visual assets into a unified brand guide document.",
        tag: "compiler",
        status: "waiting",
        iteration: 1,
        dependsOn: ["color-tags", "font-pairing"],
        requiresReview: false,
        repo: null,
        lastEventType: null,
        lastEventAt: null,
      },
    ],
  },
  {
    jobId: "job-e5f6g7h8-competitor-research",
    status: "completed",
    totalTasks: 2,
    createdAt: Date.now() - 86400_000, // 1 day ago
    completedAt: Date.now() - 82800_000,
    progress: { waiting: 0, pending: 0, processing: 0, in_review: 0, completed: 2, failed: 0 },
    tasks: [
      {
        taskId: "analyze-competitors",
        name: "Analyze Competitors",
        description: "Research and analyze competitor websites, pricing, and market positioning.",
        tag: "analyst",
        status: "completed",
        iteration: 1,
        dependsOn: [],
        requiresReview: false,
        repo: null,
        lastEventType: "Task Completed",
        lastEventAt: Date.now() - 84600_000,
      },
      {
        taskId: "compile-report",
        name: "Compile Report",
        description: "Aggregate competitor analysis into a structured comparison report.",
        tag: "compiler",
        status: "completed",
        iteration: 1,
        dependsOn: ["analyze-competitors"],
        requiresReview: false,
        repo: null,
        lastEventType: "Task Completed",
        lastEventAt: Date.now() - 82800_000,
      },
    ],
  },
  {
    jobId: "job-i9j0k1l2-store-redesign",
    status: "partial_failure",
    totalTasks: 2,
    createdAt: Date.now() - 172800_000, // 2 days ago
    completedAt: null,
    progress: { waiting: 0, pending: 0, processing: 0, in_review: 0, completed: 1, failed: 1 },
    tasks: [
      {
        taskId: "scrape-store-rd",
        name: "Scrape Store",
        description: "Crawl the store for current design assets and layout structure.",
        tag: "scraper",
        status: "completed",
        iteration: 1,
        dependsOn: [],
        requiresReview: false,
        repo: null,
        lastEventType: "Task Completed",
        lastEventAt: Date.now() - 169200_000,
      },
      {
        taskId: "generate-layout",
        name: "Generate Layout",
        description: "Generate a new responsive layout based on the scraped design data.",
        tag: "designer",
        status: "failed",
        iteration: 1,
        dependsOn: ["scrape-store-rd"],
        requiresReview: false,
        repo: "org/frontend-app",
        lastEventType: "Task Failed",
        lastEventAt: Date.now() - 168000_000,
      },
    ],
  },
  {
    // Diamond DAG: 1 → 3 → 1
    jobId: "job-m3n4o5p6-fullstack-feature",
    status: "processing",
    totalTasks: 5,
    createdAt: Date.now() - 7200_000, // 2 hours ago
    completedAt: null,
    progress: { waiting: 2, pending: 0, processing: 2, in_review: 0, completed: 1, failed: 0 },
    tasks: [
      {
        taskId: "gather-requirements",
        name: "Gather Requirements",
        description: "Analyze the feature spec and produce a detailed requirements document.",
        tag: "analyst",
        status: "completed",
        iteration: 1,
        dependsOn: [],
        requiresReview: false,
        repo: null,
        lastEventType: "Task Completed",
        lastEventAt: Date.now() - 5400_000,
      },
      {
        taskId: "backend-api",
        name: "Build Backend API",
        description: "Implement REST API endpoints, database schema, and business logic.",
        tag: "backend-developer",
        status: "processing",
        iteration: 1,
        dependsOn: ["gather-requirements"],
        requiresReview: true,
        repo: "org/backend-api",
        lastEventType: "Task Processing",
        lastEventAt: Date.now() - 3600_000,
      },
      {
        taskId: "frontend-ui",
        name: "Build Frontend UI",
        description: "Create React components, pages, and state management for the feature.",
        tag: "frontend-developer",
        status: "processing",
        iteration: 1,
        dependsOn: ["gather-requirements"],
        requiresReview: true,
        repo: "org/frontend-app",
        lastEventType: "Task Processing",
        lastEventAt: Date.now() - 3000_000,
      },
      {
        taskId: "write-tests",
        name: "Write Integration Tests",
        description: "Create end-to-end tests covering the new feature across frontend and backend.",
        tag: "test-engineer",
        status: "waiting",
        iteration: 1,
        dependsOn: ["backend-api", "frontend-ui"],
        requiresReview: false,
        repo: "org/e2e-tests",
        lastEventType: null,
        lastEventAt: null,
      },
      {
        taskId: "code-review",
        name: "Final Code Review",
        description: "Senior developer reviews all code changes across repositories.",
        tag: "code-reviewer",
        status: "waiting",
        iteration: 1,
        dependsOn: ["backend-api", "frontend-ui"],
        requiresReview: true,
        repo: null,
        lastEventType: null,
        lastEventAt: null,
      },
    ],
  },
  {
    // Parallel tasks (no deps between them)
    jobId: "job-q7r8s9t0-data-pipeline",
    status: "processing",
    totalTasks: 4,
    createdAt: Date.now() - 1800_000, // 30 min ago
    completedAt: null,
    progress: { waiting: 0, pending: 1, processing: 2, in_review: 0, completed: 1, failed: 0 },
    tasks: [
      {
        taskId: "ingest-csv",
        name: "Ingest CSV Data",
        description: "Parse and validate the uploaded CSV files, load into staging tables.",
        tag: "data-engineer",
        status: "completed",
        iteration: 1,
        dependsOn: [],
        requiresReview: false,
        repo: null,
        lastEventType: "Task Completed",
        lastEventAt: Date.now() - 1200_000,
      },
      {
        taskId: "transform-data",
        name: "Transform Data",
        description: "Apply business rules, clean data, and compute derived columns.",
        tag: "data-engineer",
        status: "processing",
        iteration: 1,
        dependsOn: ["ingest-csv"],
        requiresReview: false,
        repo: null,
        lastEventType: "Task Processing",
        lastEventAt: Date.now() - 900_000,
      },
      {
        taskId: "run-analytics",
        name: "Run Analytics",
        description: "Execute analytical queries and generate aggregated metrics.",
        tag: "data-analyst",
        status: "processing",
        iteration: 1,
        dependsOn: ["ingest-csv"],
        requiresReview: false,
        repo: null,
        lastEventType: "Task Processing",
        lastEventAt: Date.now() - 600_000,
      },
      {
        taskId: "generate-dashboard",
        name: "Generate Dashboard",
        description: "Create visualizations and compile the analytics dashboard.",
        tag: "analyst",
        status: "pending",
        iteration: 1,
        dependsOn: ["transform-data", "run-analytics"],
        requiresReview: false,
        repo: null,
        lastEventType: null,
        lastEventAt: null,
      },
    ],
  },
];

/** Returns job list in the shape of GET /jobs response */
export function getMockJobs() {
  return jobs.map(({ jobId, status, totalTasks, createdAt }) => ({
    jobId,
    status,
    totalTasks,
    createdAt,
  }));
}

/** Returns full job detail in the shape of GET /jobs/{jobId} response */
export function getMockJobDetail(jobId) {
  return jobs.find((j) => j.jobId === jobId) || null;
}

// Legacy exports for backward compatibility
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
    job.tasks.map((task) => ({ ...task, jobName: job.jobId }))
  );
}
