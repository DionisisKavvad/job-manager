import { BezierEdge } from '@xyflow/react';
import { STATUS_EDGE_COLORS } from '../../utils/task-states';

export default function DagEdge(props) {
  const { data } = props;
  const sourceStatus = data?.sourceTask?.status || 'pending';
  const color = STATUS_EDGE_COLORS[sourceStatus] || STATUS_EDGE_COLORS.pending;
  const isAnimated = sourceStatus === 'processing';

  return (
    <BezierEdge
      {...props}
      style={{
        stroke: color,
        strokeWidth: 2,
        ...(isAnimated && { strokeDasharray: '5 5' }),
      }}
      animated={isAnimated}
    />
  );
}
