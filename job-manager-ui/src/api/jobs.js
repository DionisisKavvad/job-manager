import { apiFetch } from './client.js';

export async function fetchJobs() {
  const data = await apiFetch('/jobs?limit=100');
  return data?.jobs ?? null;
}

export async function fetchJob(jobId) {
  return apiFetch(`/jobs/${encodeURIComponent(jobId)}`);
}
