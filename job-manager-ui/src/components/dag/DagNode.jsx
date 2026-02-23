import { Handle, Position } from '@xyflow/react';
import { STATUS_NODE_COLORS, getTagColor } from '../../utils/task-states';

export default function DagNode({ data }) {
  const { task } = data;
  const colors = STATUS_NODE_COLORS[task.status] || STATUS_NODE_COLORS.pending;
  const tagClass = getTagColor(task.tag);

  return (
    <div
      className={`w-[220px] rounded-lg border-2 px-3 py-2.5 shadow-sm ${colors.bg} ${colors.border}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400 !w-2 !h-2" />

      <div className="flex items-start justify-between gap-2">
        <p className={`text-sm font-medium truncate ${colors.text}`}>
          {task.name || task.taskId}
        </p>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${colors.dot}`} />
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className={`text-xs px-1.5 py-0.5 rounded-full ${tagClass}`}>
          {task.tag}
        </span>
        {task.requiresReview && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
            review
          </span>
        )}
      </div>

      {task.repo && (
        <p className="mt-1 text-xs text-gray-500 truncate">{task.repo}</p>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-gray-400 !w-2 !h-2" />
    </div>
  );
}
