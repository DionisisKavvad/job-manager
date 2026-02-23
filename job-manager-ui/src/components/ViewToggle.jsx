import { useAppContext } from "../context/AppContext";

const MODES = [
  { key: "dag", label: "DAG" },
  { key: "kanban", label: "Kanban" },
];

export default function ViewToggle() {
  const { viewMode, setViewMode } = useAppContext();

  return (
    <div className="inline-flex rounded-lg bg-gray-200 p-0.5">
      {MODES.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => setViewMode(key)}
          className={`px-3 py-1 text-sm font-medium rounded-md transition-colors cursor-pointer ${
            viewMode === key
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
