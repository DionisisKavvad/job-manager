import { useCallback } from 'react';
import { usePolling } from './usePolling.js';
import { fetchJobs } from '../api/jobs.js';
import { getMockJobs } from '../data/mock-data.js';

const HAS_API = !!import.meta.env.VITE_API_URL;

export function useJobs() {
  const fetchFn = useCallback(() => {
    if (!HAS_API) {
      return Promise.resolve(getMockJobs());
    }
    return fetchJobs();
  }, []);

  return usePolling(fetchFn, 10_000);
}
