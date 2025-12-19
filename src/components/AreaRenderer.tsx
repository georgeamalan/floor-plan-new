import type React from 'react';
import TransformHandles from './TransformHandles';
import type { Area, Plan, RectHandle, RectShape, PolygonShape, MultiPolygonShape } from '../domain/types';
import { polygonArea, shapeBoundingBox } from '../domain/geometry';

type Props = {
  area: Area;
  plan: Plan;
  selected: boolean;
  draftShape?: RectShape | PolygonShape | MultiPolygonShape;
  onSelect: (id: string) => void;
  onPointerDown: (event: React.PointerEvent, area: Area) => void;
  onHandlePointerDown: (handle: RectHandle, event: React.PointerEvent) => void;
  onPolygonPointPointerDown?: (index: number, event: React.PointerEvent) => void;
  onMultiPolygonPointPointerDown?: (polyIndex: number, pointIndex: number, event: React.PointerEvent) => void;
};

export default function AreaRenderer({
  area,
  plan,
  draftShape,
  selected,
  onSelect,
  onPointerDown,
  onHandlePointerDown,
  onPolygonPointPointerDown,
  onMultiPolygonPointPointerDown,
}: Props) {
  const shape = draftShape ?? area.shape;
  const isRect = shape.type === 'rect';
  const isPolygon = shape.type === 'polygon';
  const baseOpacity = draftShape ? 0.6 : 0.9;
  const hatchOpacity = draftShape ? 0.35 : 0.25;

  const areaSize =
    shape.type === 'rect'
      ? shape.width * shape.height
      : shape.type === 'polygon'
        ? polygonArea(shape.points)
        : shape.polygons.reduce((acc, poly) => acc + polygonArea(poly), 0);

  const bounds = shapeBoundingBox(shape);
  const labelX = bounds.x + 0.12;
  const labelY = bounds.y + 0.12;
  const nameFontSize = 0.26;
  const areaFontSize = 0.2;
  const labelLineHeight = 0.3;
  const labelPaddingX = 0.08;
  const labelPaddingY = 0.06;
  const areaText = `${areaSize.toFixed(2)} ${plan.units}²`;
  const nameWidth = area.name.length * nameFontSize * 0.6;
  const areaWidth = areaText.length * areaFontSize * 0.6;
  const labelWidth = Math.max(nameWidth, areaWidth) + labelPaddingX * 2;
  const labelHeight = labelLineHeight + areaFontSize + labelPaddingY * 2;

  const textColor = getTextColor(area.fill);
  const polygonsForEdges =
    shape.type === 'polygon'
      ? [shape.points]
      : shape.type === 'multipolygon'
        ? shape.polygons
        : [];

  return (
    <g
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect(area.id);
        onPointerDown(e, area);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onSelect(area.id);
        onPointerDown(e as any, area);
      }}
      className="cursor-pointer transition"
    >
      {isRect ? (
        <g>
          <rect
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
            fill={area.fill}
            stroke={selected ? '#111827' : area.stroke}
            strokeWidth={area.strokeWidth}
            opacity={baseOpacity}
            rx={0.04}
          />
          {!selected && (
            <rect
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              fill="url(#hatch)"
              opacity={hatchOpacity}
              rx={0.04}
            />
          )}
        </g>
      ) : isPolygon ? (
        <g>
          <polygon
            points={shape.points.map((p) => `${p.x},${p.y}`).join(' ')}
            fill={area.fill}
            stroke={selected ? '#111827' : area.stroke}
            strokeWidth={area.strokeWidth}
            opacity={baseOpacity}
          />
          {!selected && (
            <polygon
              points={shape.points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="url(#hatch)"
              opacity={hatchOpacity}
            />
          )}
        </g>
      ) : (
        <g>
          {shape.polygons.map((poly, idx) => (
            <g key={idx}>
              <polygon
                points={poly.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={area.fill}
                stroke="none"
                opacity={baseOpacity}
              />
              {!selected && (
                <polygon
                  points={poly.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="url(#hatch)"
                  opacity={hatchOpacity}
                />
              )}
            </g>
          ))}
          {getBoundarySegments(shape.polygons).map((seg, idx) => (
            <line
              key={idx}
              x1={seg.a.x}
              y1={seg.a.y}
              x2={seg.b.x}
              y2={seg.b.y}
              stroke={selected ? '#111827' : area.stroke}
              strokeWidth={area.strokeWidth}
              strokeLinecap="round"
            />
          ))}
        </g>
      )}

      {polygonsForEdges.length > 0 &&
        polygonsForEdges.flatMap((poly, pIdx) =>
          poly.map((point, idx) => {
            const next = poly[(idx + 1) % poly.length];
            const mid = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
            const length = Math.hypot(next.x - point.x, next.y - point.y);
            return (
              <g key={`${pIdx}-${idx}`} pointerEvents="none">
                <rect
                  x={mid.x - 0.45}
                  y={mid.y - 0.25}
                  width={0.9}
                  height={0.5}
                  rx={0.08}
                  fill="rgba(255,255,255,0.9)"
                  stroke="rgba(15,23,42,0.08)"
                  strokeWidth={0.02}
                />
                <text
                  x={mid.x}
                  y={mid.y}
                  fontSize={0.22}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#0f172a"
                  style={{ userSelect: 'none' }}
                >
                  {length.toFixed(2)} {plan.units}
                </text>
              </g>
            );
          }),
        )}

      <g pointerEvents="none">
        <rect
          x={labelX - labelPaddingX}
          y={labelY - labelPaddingY}
          width={labelWidth}
          height={labelHeight}
          rx={0.12}
          fill="rgba(255,255,255,0.85)"
          stroke="rgba(15,23,42,0.08)"
          strokeWidth={0.02}
        />
        <text
          x={labelX}
          y={labelY}
          fontSize={nameFontSize}
          textAnchor="start"
          dominantBaseline="hanging"
          fill={textColor}
          style={{ userSelect: 'none' }}
        >
          {area.name}
        </text>
        <text
          x={labelX}
          y={labelY + labelLineHeight}
          fontSize={areaFontSize}
          textAnchor="start"
          fill={textColor}
          style={{ userSelect: 'none' }}
        >
          {areaText}
        </text>
      </g>

      {selected && (
        <>
          {isRect && (
            <>
              <rect
                x={shape.x}
                y={shape.y}
                width={shape.width}
                height={shape.height}
                fill="none"
                stroke="#2563eb"
                strokeWidth={0.06}
                strokeDasharray="0.3 0.18"
                pointerEvents="none"
                filter="drop-shadow(0 0 0.2px rgba(37,99,235,0.4))"
              />
              <TransformHandles
                rect={shape}
                onPointerDown={(handle, e) => {
                  e.stopPropagation();
                  onHandlePointerDown(handle, e);
                }}
              />
              <text
                x={shape.x + shape.width / 2}
                y={shape.y - 0.3}
                fontSize={0.36}
                textAnchor="middle"
                fill="#0f172a"
                style={{ userSelect: 'none', pointerEvents: 'none' }}
              >
                {shape.width.toFixed(2)} {plan.units}
              </text>
              <text
                x={shape.x + shape.width + 0.2}
                y={shape.y + shape.height / 2}
                fontSize={0.36}
                textAnchor="start"
                dominantBaseline="middle"
                fill="#0f172a"
                style={{ userSelect: 'none', pointerEvents: 'none' }}
              >
                {shape.height.toFixed(2)} {plan.units}
              </text>
            </>
          )}
          {isPolygon &&
            (shape as PolygonShape).points.map((p, idx) => (
              <circle
                key={`${p.x}-${p.y}-${idx}`}
                cx={p.x}
                cy={p.y}
                r={0.18}
                fill="#fff"
                stroke="#2563eb"
                strokeWidth={0.06}
                onPointerDown={(e) => onPolygonPointPointerDown?.(idx, e)}
                style={{ cursor: 'grab' }}
              />
            ))}
          {shape.type === 'multipolygon' &&
            shape.polygons.map((poly, pIdx) =>
              poly.map((p, idx) => (
                <circle
                  key={`${p.x}-${p.y}-${pIdx}-${idx}`}
                  cx={p.x}
                  cy={p.y}
                  r={0.18}
                  fill="#fff"
                  stroke="#2563eb"
                  strokeWidth={0.06}
                  onPointerDown={(e) => onMultiPolygonPointPointerDown?.(pIdx, idx, e)}
                  style={{ cursor: 'grab' }}
                />
              )),
            )}
        </>
      )}
    </g>
  );
}

function getBoundarySegments(polygons: { x: number; y: number }[][]) {
  const edges: Record<
    string,
    {
      a: { x: number; y: number };
      b: { x: number; y: number };
      count: number;
    }
  > = {};
  const edgeKey = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const minX = Math.min(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxX = Math.max(a.x, b.x);
    const maxY = Math.max(a.y, b.y);
    return `${minX},${minY}-${maxX},${maxY}`;
  };
  polygons.forEach((poly) => {
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const key = edgeKey(a, b);
      if (!edges[key]) {
        edges[key] = { a, b, count: 0 };
      }
      edges[key].count += 1;
    }
  });
  return Object.values(edges).filter((e) => e.count === 1);
}

function getTextColor(hex: string) {
  const v = hex.replace('#', '');
  const r = parseInt(v.substring(0, 2), 16);
  const g = parseInt(v.substring(2, 4), 16);
  const b = parseInt(v.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#0f172a' : '#f8fafc';
}
