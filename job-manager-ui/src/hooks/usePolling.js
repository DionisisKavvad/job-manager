import { useState, useEffect, useRef, useCallback } from 'react';

export function usePolling(fetchFn, intervalMs, { enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const inFlightRef = useRef(false);
  const intervalRef = useRef(null);

  const execute = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      const result = await fetchFn();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err);
      // Keep stale data visible — don't setData(null)
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [fetchFn]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    // Initial fetch
    setLoading(true);
    execute();

    // Set up polling interval
    intervalRef.current = setInterval(execute, intervalMs);

    // Visibility-aware: pause when tab hidden
    const handleVisibility = () => {
      if (document.hidden) {
        clearInterval(intervalRef.current);
      } else {
        execute(); // Immediate refresh on tab focus
        intervalRef.current = setInterval(execute, intervalMs);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [execute, intervalMs, enabled]);

  return { data, loading, error };
}
