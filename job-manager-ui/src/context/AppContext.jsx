import { createContext, useContext, useState, useCallback } from 'react';

const AppContext = createContext(null);

export function AppContextProvider({ children }) {
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [viewMode, setViewMode] = useState('dag'); // 'dag' | 'kanban'

  const selectJob = useCallback((jobId) => {
    setSelectedJobId(jobId);
    setSelectedTaskId(null); // Close drawer when switching jobs
  }, []);

  const selectTask = useCallback((taskId) => {
    setSelectedTaskId(taskId);
  }, []);

  const closeDrawer = useCallback(() => {
    setSelectedTaskId(null);
  }, []);

  return (
    <AppContext.Provider value={{
      selectedJobId,
      selectedTaskId,
      viewMode,
      selectJob,
      selectTask,
      closeDrawer,
      setViewMode,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppContextProvider');
  return ctx;
}
