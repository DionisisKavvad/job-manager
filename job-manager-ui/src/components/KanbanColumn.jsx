import TaskCard from "./TaskCard";

export default function KanbanColumn({ column, tasks, onTaskClick }) {
  return (
    <div className="flex flex-col min-w-[220px] w-[260px]">
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-t-lg ${column.headerBg}`}
      >
        <span className={`w-2 h-2 rounded-full ${column.dotColor}`} />
        <h3 className={`text-sm font-semibold ${column.headerText}`}>
          {column.label}
        </h3>
        <span
          className={`ml-auto text-xs font-medium ${column.headerText} opacity-70`}
        >
          {tasks.length}
        </span>
      </div>

      <div className="flex-1 bg-gray-50 rounded-b-lg border border-t-0 border-gray-200 p-2 space-y-2 min-h-[400px]">
        {tasks.map((task) => (
          <TaskCard key={task.taskId} task={task} onClick={onTaskClick} />
        ))}
        {tasks.length === 0 && (
          <p className="text-xs text-gray-400 text-center mt-6">No tasks</p>
        )}
      </div>
    </div>
  );
}
