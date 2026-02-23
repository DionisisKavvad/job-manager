import { useAppContext } from "./context/AppContext";
import Layout from "./components/Layout";
import JobListSidebar from "./components/JobListSidebar";
import JobDetailView from "./components/JobDetailView";
import TaskDetailDrawer from "./components/TaskDetailDrawer";

export default function App() {
  const { selectedTaskId } = useAppContext();

  return (
    <Layout
      sidebar={<JobListSidebar />}
      drawer={selectedTaskId ? <TaskDetailDrawer /> : null}
    >
      <JobDetailView />
    </Layout>
  );
}
