import { useCallback, useMemo } from 'react';
import { usePolling } from './usePolling.js';
import { fetchJob } from '../api/jobs.js';
import { getMockJobDetail } from '../data/mock-data.js';

const HAS_API = !!import.meta.env.VITE_API_URL;

export function useJobDetail(jobId) {
  const fetchFn = useCallback(() => {
    if (!jobId) return Promise.resolve(null);
    if (!HAS_API) {
      return Promise.resolve(getMockJobDetail(jobId));
    }
    return fetchJob(jobId);
  }, [jobId]);

  const { data, loading, error } = usePolling(fetchFn, 5_000, {
    enabled: !!jobId,
  });

  // Compute progress from tasks if not provided by API
  const jobWithProgress = useMemo(() => {
    if (!data) return null;
    if (data.progress) return data;

    // Derive progress from tasks
    const progress = { waiting: 0, pending: 0, processing: 0, in_review: 0, completed: 0, failed: 0 };
    for (const task of data.tasks || []) {
      if (progress[task.status] !== undefined) {
        progress[task.status]++;
      }
    }
    return { ...data, progress };
  }, [data]);

  return { data: jobWithProgress, loading, error };
}
