import type React from 'react';
import type { RectHandle, RectShape } from '../domain/types';

type Props = {
  rect: RectShape;
  onPointerDown: (handle: RectHandle, event: React.PointerEvent) => void;
};

const positions: { handle: RectHandle; x: (r: RectShape) => number; y: (r: RectShape) => number }[] = [
  { handle: 'nw', x: (r) => r.x, y: (r) => r.y },
  { handle: 'n', x: (r) => r.x + r.width / 2, y: (r) => r.y },
  { handle: 'ne', x: (r) => r.x + r.width, y: (r) => r.y },
  { handle: 'w', x: (r) => r.x, y: (r) => r.y + r.height / 2 },
  { handle: 'e', x: (r) => r.x + r.width, y: (r) => r.y + r.height / 2 },
  { handle: 'sw', x: (r) => r.x, y: (r) => r.y + r.height },
  { handle: 's', x: (r) => r.x + r.width / 2, y: (r) => r.y + r.height },
  { handle: 'se', x: (r) => r.x + r.width, y: (r) => r.y + r.height },
];

export default function TransformHandles({ rect, onPointerDown }: Props) {
  return (
    <>
      {positions.map((pos) => (
        <rect
          key={pos.handle}
          x={pos.x(rect) - 0.12}
          y={pos.y(rect) - 0.12}
          width={0.24}
          height={0.24}
          rx={0.04}
          fill="#fff"
          stroke="#2563eb"
          strokeWidth={0.04}
          onPointerDown={(e) => onPointerDown(pos.handle, e)}
        />
      ))}
    </>
  );
}
