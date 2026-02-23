import { useMemo, useRef } from 'react';
import dagre from 'dagre';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

function getStructuralFingerprint(tasks) {
  return JSON.stringify(
    tasks.map((t) => t.taskId + ':' + (t.dependsOn || []).join(','))
  );
}

function computeLayout(tasks) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 });

  for (const task of tasks) {
    g.setNode(task.taskId, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const task of tasks) {
    for (const dep of task.dependsOn || []) {
      g.setEdge(dep, task.taskId);
    }
  }

  dagre.layout(g);

  const nodes = tasks.map((task) => {
    const pos = g.node(task.taskId);
    return {
      id: task.taskId,
      type: 'dagNode',
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
      data: { task },
    };
  });

  const edges = [];
  for (const task of tasks) {
    for (const dep of task.dependsOn || []) {
      edges.push({
        id: `${dep}->${task.taskId}`,
        source: dep,
        target: task.taskId,
        type: 'dagEdge',
        data: {
          sourceTask: tasks.find((t) => t.taskId === dep),
          targetTask: task,
        },
      });
    }
  }

  return { nodes, edges };
}

export function useDagLayout(tasks) {
  const fingerprint = getStructuralFingerprint(tasks);
  const layoutRef = useRef({ fingerprint: null, positions: null });

  // Recompute positions only when structure changes
  const positions = useMemo(() => {
    if (layoutRef.current.fingerprint === fingerprint) {
      return layoutRef.current.positions;
    }
    const { nodes, edges } = computeLayout(tasks);
    const posMap = {};
    for (const n of nodes) {
      posMap[n.id] = n.position;
    }
    layoutRef.current = { fingerprint, positions: posMap };
    return posMap;
  }, [fingerprint, tasks]);

  // Always rebuild nodes with latest task data, but use stable positions
  const nodes = useMemo(
    () =>
      tasks.map((task) => ({
        id: task.taskId,
        type: 'dagNode',
        position: positions[task.taskId] || { x: 0, y: 0 },
        data: { task },
      })),
    [tasks, positions]
  );

  const edges = useMemo(() => {
    const result = [];
    for (const task of tasks) {
      for (const dep of task.dependsOn || []) {
        result.push({
          id: `${dep}->${task.taskId}`,
          source: dep,
          target: task.taskId,
          type: 'dagEdge',
          data: {
            sourceTask: tasks.find((t) => t.taskId === dep),
            targetTask: task,
          },
        });
      }
    }
    return result;
  }, [tasks]);

  return { nodes, edges };
}
