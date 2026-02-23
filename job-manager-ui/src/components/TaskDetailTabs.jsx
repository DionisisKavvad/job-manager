import { useState } from 'react';
import DependenciesTab from './tabs/DependenciesTab';
import ResultTab from './tabs/ResultTab';
import FeedbackTab from './tabs/FeedbackTab';
import ExecutionTab from './tabs/ExecutionTab';
import EventsTimelineTab from './tabs/EventsTimelineTab';

const ALL_TABS = [
  { key: 'dependencies', label: 'Dependencies' },
  { key: 'result', label: 'Result' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'execution', label: 'Execution' },
  { key: 'events', label: 'Events' },
];

export default function TaskDetailTabs({ task, allTasks }) {
  // Filter tabs: only show feedback if task has review
  const tabs = ALL_TABS.filter((tab) => {
    if (tab.key === 'feedback' && !task.requiresReview) return false;
    return true;
  });

  const [activeTab, setActiveTab] = useState(tabs[0]?.key || 'dependencies');

  // Reset to first tab if current tab is not in filtered list
  const currentTab = tabs.find((t) => t.key === activeTab) ? activeTab : tabs[0]?.key;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-gray-200 px-4 flex-shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              currentTab === tab.key
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {currentTab === 'dependencies' && <DependenciesTab task={task} allTasks={allTasks} />}
        {currentTab === 'result' && <ResultTab task={task} />}
        {currentTab === 'feedback' && <FeedbackTab task={task} />}
        {currentTab === 'execution' && <ExecutionTab task={task} />}
        {currentTab === 'events' && <EventsTimelineTab task={task} />}
      </div>
    </div>
  );
}
