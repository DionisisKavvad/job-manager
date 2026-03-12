import { useState } from "react";
import Markdown from "react-markdown";

function formatOutput(output) {
  if (output == null) return null;
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

function formatError(error) {
  if (!error) return null;
  try {
    const parsed = JSON.parse(error);
    return parsed.error || error;
  } catch {
    return error;
  }
}

function downloadMarkdown(content, filename) {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ResultTab({ task }) {
  const formattedOutput = formatOutput(task.output);
  const errorMessage = formatError(task.error);
  const [viewMode, setViewMode] = useState("preview"); // "preview" | "raw"

  return (
    <div className="space-y-3">
      {errorMessage && (
        <div>
          <h4 className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-1">
            Error
          </h4>
          <pre className="text-xs text-red-700 bg-red-50 rounded-lg border border-red-200 p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
            {errorMessage}
          </pre>
        </div>
      )}

      {formattedOutput ? (
        <div>
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Output
            </h4>
            <div className="flex items-center gap-1">
              <div className="flex bg-gray-100 rounded p-0.5">
                <button
                  onClick={() => setViewMode("preview")}
                  className={`px-2 py-0.5 text-[10px] font-medium rounded cursor-pointer transition-colors ${
                    viewMode === "preview"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Preview
                </button>
                <button
                  onClick={() => setViewMode("raw")}
                  className={`px-2 py-0.5 text-[10px] font-medium rounded cursor-pointer transition-colors ${
                    viewMode === "raw"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Raw
                </button>
              </div>
              <button
                onClick={() => downloadMarkdown(formattedOutput, `${task.taskId}-output.md`)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded cursor-pointer"
                title="Download as Markdown"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
            </div>
          </div>

          {viewMode === "preview" ? (
            <div className="prose prose-sm max-w-none bg-white rounded-lg border border-gray-200 p-3 overflow-y-auto max-h-[600px] [&_pre]:bg-gray-900 [&_pre]:text-gray-100 [&_pre]:text-xs [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:overflow-x-auto [&_code]:text-xs [&_p]:text-gray-700 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-xs [&_li]:text-gray-700 [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_th]:bg-gray-50">
              <Markdown>{formattedOutput}</Markdown>
            </div>
          ) : (
            <pre className="text-xs text-gray-800 bg-gray-50 rounded-lg border border-gray-200 p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-[600px] overflow-y-auto">
              {formattedOutput}
            </pre>
          )}
        </div>
      ) : !errorMessage ? (
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-xs text-gray-500">
            Output not yet available.
          </p>
        </div>
      ) : null}
    </div>
  );
}
