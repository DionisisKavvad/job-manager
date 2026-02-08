import { COLUMNS, groupTasksByState } from "../utils/task-states";
import KanbanColumn from "./KanbanColumn";

export default function KanbanBoard({ tasks }) {
  const grouped = groupTasksByState(tasks);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {COLUMNS.map((column) => {
        if (column.key === "failed" && grouped.failed.length === 0) {
          return null;
        }
        return (
          <KanbanColumn
            key={column.key}
            column={column}
            tasks={grouped[column.key]}
          />
        );
      })}
    </div>
  );
}
