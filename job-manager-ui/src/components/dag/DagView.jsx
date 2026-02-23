import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import DagNode from './DagNode';
import DagEdge from './DagEdge';
import { useDagLayout } from './useDagLayout';

const nodeTypes = { dagNode: DagNode };
const edgeTypes = { dagEdge: DagEdge };

export default function DagView({ tasks, onTaskClick }) {
  const { nodes, edges } = useDagLayout(tasks);

  const onNodeClick = useCallback(
    (_event, node) => {
      onTaskClick?.(node.id);
    },
    [onTaskClick]
  );

  const defaultViewport = useMemo(() => ({ x: 0, y: 0, zoom: 1 }), []);

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        No tasks to display
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        defaultViewport={defaultViewport}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        minZoom={0.3}
        maxZoom={1.5}
      >
        <Background color="#e5e7eb" gap={16} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeStrokeWidth={3}
          nodeColor={(node) => {
            const status = node.data?.task?.status;
            const colors = {
              waiting: '#94a3b8',
              pending: '#9ca3af',
              processing: '#3b82f6',
              in_review: '#f59e0b',
              completed: '#22c55e',
              failed: '#ef4444',
            };
            return colors[status] || '#9ca3af';
          }}
          zoomable
          pannable
        />
      </ReactFlow>
    </div>
  );
}
