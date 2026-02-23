const SEGMENTS = [
  { key: 'completed',  color: 'bg-green-400',  label: 'Completed' },
  { key: 'in_review',  color: 'bg-amber-400',  label: 'In Review' },
  { key: 'processing', color: 'bg-blue-400',   label: 'Processing' },
  { key: 'pending',    color: 'bg-gray-300',    label: 'Pending' },
  { key: 'waiting',    color: 'bg-slate-300',   label: 'Waiting' },
  { key: 'failed',     color: 'bg-red-400',     label: 'Failed' },
];

export default function ProgressBar({ progress, totalTasks }) {
  if (!progress || !totalTasks) return null;

  return (
    <div>
      <div className="flex h-2 rounded-full overflow-hidden bg-gray-200">
        {SEGMENTS.map(({ key, color }) => {
          const count = progress[key] || 0;
          if (count === 0) return null;
          const pct = (count / totalTasks) * 100;
          return (
            <div
              key={key}
              className={`${color} transition-all duration-300`}
              style={{ width: `${pct}%` }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-1.5">
        {SEGMENTS.map(({ key, color, label }) => {
          const count = progress[key] || 0;
          if (count === 0) return null;
          return (
            <span key={key} className="flex items-center gap-1 text-xs text-gray-500">
              <span className={`w-2 h-2 rounded-full ${color}`} />
              {count} {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
