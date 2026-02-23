import { apiFetch } from './client.js';

export async function fetchJobs() {
  const data = await apiFetch('/jobs?limit=100');
  return data?.jobs ?? null;
}

export async function fetchJob(jobId) {
  return apiFetch(`/jobs/${encodeURIComponent(jobId)}`);
}

export async function fetchTaskEvents(jobId, taskId) {
  return apiFetch(`/jobs/${encodeURIComponent(jobId)}/tasks/${encodeURIComponent(taskId)}/events`);
}

export async function approveTask(jobId, taskId) {
  return apiFetch(`/jobs/${encodeURIComponent(jobId)}/tasks/${encodeURIComponent(taskId)}/approve`, {
    method: 'POST',
  });
}

export async function requestRevision(jobId, taskId, feedback) {
  return apiFetch(`/jobs/${encodeURIComponent(jobId)}/tasks/${encodeURIComponent(taskId)}/request-revision`, {
    method: 'POST',
    body: JSON.stringify({ feedback }),
  });
}
