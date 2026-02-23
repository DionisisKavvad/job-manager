import { useCallback } from 'react';
import { usePolling } from './usePolling.js';
import { fetchTaskEvents } from '../api/jobs.js';

const HAS_API = !!import.meta.env.VITE_API_URL;

export function useTaskEvents(jobId, taskId) {
  const fetchFn = useCallback(() => {
    if (!jobId || !taskId || !HAS_API) return Promise.resolve(null);
    return fetchTaskEvents(jobId, taskId);
  }, [jobId, taskId]);

  return usePolling(fetchFn, 10_000, {
    enabled: !!jobId && !!taskId && HAS_API,
  });
}
