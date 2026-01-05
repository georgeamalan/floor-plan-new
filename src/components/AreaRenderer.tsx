import type React from 'react';
import TransformHandles from './TransformHandles';
import type { Area, Plan, RectHandle, RectShape, PolygonShape, MultiPolygonShape, EllipseShape } from '../domain/types';
import { polygonAreaWithHoles, shapeBoundingBox, ellipseToRect } from '../domain/geometry';

type Props = {
  area: Area;
  plan: Plan;
  selected: boolean;
  draftShape?: RectShape | PolygonShape | MultiPolygonShape | EllipseShape;
  labelOffset?: { x: number; y: number };
  edgeLabelOffsets?: Record<string, { x: number; y: number }>;
  radiusLabelOffset?: { x: number; y: number };
  showDimensions?: boolean;
  onSelect: (id: string) => void;
  onPointerDown: (event: React.PointerEvent, area: Area) => void;
  onHandlePointerDown: (handle: RectHandle, event: React.PointerEvent) => void;
  onLabelPointerDown?: (event: React.PointerEvent, area: Area) => void;
  onEdgeLabelPointerDown?: (event: React.PointerEvent, area: Area, edgeKey: string) => void;
  onRadiusLabelPointerDown?: (event: React.PointerEvent, area: Area) => void;
  onEdgeHover?: (event: React.PointerEvent, area: Area, edgeKey: string, a: { x: number; y: number }, b: { x: number; y: number }) => void;
  onEdgeHoverEnd?: () => void;
  onPolygonPointPointerDown?: (index: number, event: React.PointerEvent) => void;
  onPolygonEdgePointerDown?: (index: number, event: React.PointerEvent) => void;
  onMultiPolygonPointPointerDown?: (polyIndex: number, pointIndex: number, event: React.PointerEvent) => void;
  onMultiPolygonEdgePointerDown?: (polyIndex: number, index: number, event: React.PointerEvent) => void;
};

export default function AreaRenderer({
  area,
  plan,
  draftShape,
  selected,
  labelOffset,
  edgeLabelOffsets,
  radiusLabelOffset,
  showDimensions = true,
  onSelect,
  onPointerDown,
  onHandlePointerDown,
  onLabelPointerDown,
  onEdgeLabelPointerDown,
  onRadiusLabelPointerDown,
  onEdgeHover,
  onEdgeHoverEnd,
  onPolygonPointPointerDown,
  onPolygonEdgePointerDown,
  onMultiPolygonPointPointerDown,
  onMultiPolygonEdgePointerDown,
}: Props) {
  const shape = draftShape ?? area.shape;
  const isRect = shape.type === 'rect';
  const isEllipse = shape.type === 'ellipse';
  const isPolygon = shape.type === 'polygon';
  const baseOpacity = draftShape ? 0.6 : 0.9;
  const hatchOpacity = draftShape ? 0.35 : 0.25;

  const areaSize =
    shape.type === 'rect'
      ? shape.width * shape.height
      : shape.type === 'ellipse'
        ? Math.PI * shape.rx * shape.ry
        : shape.type === 'polygon'
          ? polygonAreaWithHoles(shape.points, shape.holes)
          : shape.polygons.reduce((acc, poly, idx) => acc + polygonAreaWithHoles(poly, shape.holes?.[idx]), 0);

  const bounds = shapeBoundingBox(shape);
  const labelOffsetX = labelOffset?.x ?? 0;
  const labelOffsetY = labelOffset?.y ?? 0;
  const labelInset = 0.18;
  const labelX = bounds.x + labelInset + labelOffsetX;
  const labelY = bounds.y + labelInset + labelOffsetY;
  const nameFontSize = 0.22;
  const areaFontSize = 0.17;
  const labelLineHeight = 0.22;
  const labelGap = 0.03;
  const labelPaddingX = 0.03;
  const labelPaddingY = 0.02;
  const areaText = `${areaSize.toFixed(2)} ${plan.units}²`;
  const nameWidth = area.name.length * nameFontSize * 0.6;
  const areaWidth = areaText.length * areaFontSize * 0.6;
  const labelWidth = Math.max(nameWidth, areaWidth) + labelPaddingX * 2;
  const labelHeight = labelLineHeight + labelGap + areaFontSize + labelPaddingY * 2;
  const labelRect = {
    x: labelX - labelPaddingX,
    y: labelY - labelPaddingY,
    width: labelWidth,
    height: labelHeight,
  };
  const labelCenter = { x: labelRect.x + labelRect.width / 2, y: labelRect.y + labelRect.height / 2 };
  const boundsRight = bounds.x + bounds.width;
  const boundsBottom = bounds.y + bounds.height;
  const labelOutside =
    labelRect.x < bounds.x ||
    labelRect.y < bounds.y ||
    labelRect.x + labelRect.width > boundsRight ||
    labelRect.y + labelRect.height > boundsBottom;
  const leaderArrowSize = 0.12;
  const leader = labelOutside ? getLabelLeader(labelCenter, bounds) : null;

  const textColor = getTextColor(area.fill);
  const isCircle = isEllipse && Math.abs((shape as EllipseShape).rx - (shape as EllipseShape).ry) < 0.0001;
  const radius = isCircle ? (shape as EllipseShape).rx : null;
  const radiusOffsetX = radiusLabelOffset?.x ?? 0;
  const radiusOffsetY = radiusLabelOffset?.y ?? 0;
  const radiusLabelFontSize = 0.15;
  const radiusPaddingX = 0.05;
  const radiusPaddingY = 0.03;
  const radiusLabelText = radius !== null ? `R ${radius.toFixed(2)} ${plan.units}` : '';
  const radiusLabelWidth = radiusLabelText.length * radiusLabelFontSize * 0.6 + radiusPaddingX * 2;
  const radiusLabelHeight = radiusLabelFontSize + radiusPaddingY * 2;
  const polygonPath = (points: { x: number; y: number }[], holes: { x: number; y: number }[][] = []) => {
    const ringToPath = (ring: { x: number; y: number }[]) =>
      ring.length ? `M ${ring.map((p) => `${p.x} ${p.y}`).join(' L ')} Z` : '';
    return [ringToPath(points), ...holes.map(ringToPath)].filter(Boolean).join(' ');
  };
  const multiPolygonPath = (polygons: { x: number; y: number }[][], holes: { x: number; y: number }[][][] = []) =>
    polygons.map((poly, idx) => polygonPath(poly, holes[idx] ?? [])).join(' ');

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
          {showDimensions && (
            <>
              <line
                x1={shape.x}
                y1={shape.y}
                x2={shape.x + shape.width}
                y2={shape.y}
                stroke="transparent"
                strokeWidth={0.3}
                pointerEvents="stroke"
                onPointerMove={(e) => onEdgeHover?.(e, area, 'rect-top', { x: shape.x, y: shape.y }, { x: shape.x + shape.width, y: shape.y })}
                onPointerLeave={onEdgeHoverEnd}
              />
              <line
                x1={shape.x + shape.width}
                y1={shape.y}
                x2={shape.x + shape.width}
                y2={shape.y + shape.height}
                stroke="transparent"
                strokeWidth={0.3}
                pointerEvents="stroke"
                onPointerMove={(e) =>
                  onEdgeHover?.(
                    e,
                    area,
                    'rect-right',
                    { x: shape.x + shape.width, y: shape.y },
                    { x: shape.x + shape.width, y: shape.y + shape.height },
                  )
                }
                onPointerLeave={onEdgeHoverEnd}
              />
              <line
                x1={shape.x + shape.width}
                y1={shape.y + shape.height}
                x2={shape.x}
                y2={shape.y + shape.height}
                stroke="transparent"
                strokeWidth={0.3}
                pointerEvents="stroke"
                onPointerMove={(e) =>
                  onEdgeHover?.(
                    e,
                    area,
                    'rect-bottom',
                    { x: shape.x + shape.width, y: shape.y + shape.height },
                    { x: shape.x, y: shape.y + shape.height },
                  )
                }
                onPointerLeave={onEdgeHoverEnd}
              />
              <line
                x1={shape.x}
                y1={shape.y + shape.height}
                x2={shape.x}
                y2={shape.y}
                stroke="transparent"
                strokeWidth={0.3}
                pointerEvents="stroke"
                onPointerMove={(e) =>
                  onEdgeHover?.(
                    e,
                    area,
                    'rect-left',
                    { x: shape.x, y: shape.y + shape.height },
                    { x: shape.x, y: shape.y },
                  )
                }
                onPointerLeave={onEdgeHoverEnd}
              />
            </>
          )}
        </g>
      ) : isEllipse ? (
        <g>
          <ellipse
            cx={shape.cx}
            cy={shape.cy}
            rx={shape.rx}
            ry={shape.ry}
            fill={area.fill}
            stroke={selected ? '#111827' : area.stroke}
            strokeWidth={area.strokeWidth}
            opacity={baseOpacity}
          />
          {!selected && (
            <ellipse
              cx={shape.cx}
              cy={shape.cy}
              rx={shape.rx}
              ry={shape.ry}
              fill="url(#hatch)"
              opacity={hatchOpacity}
            />
          )}
        </g>
      ) : isPolygon ? (
        <g>
          <path
            d={polygonPath(shape.points, shape.holes)}
            fill={area.fill}
            stroke={selected ? '#111827' : area.stroke}
            strokeWidth={area.strokeWidth}
            opacity={baseOpacity}
            fillRule="evenodd"
          />
          {!selected && (
            <path
              d={polygonPath(shape.points, shape.holes)}
              fill="url(#hatch)"
              opacity={hatchOpacity}
              fillRule="evenodd"
            />
          )}
          {showDimensions &&
            shape.points.map((point, idx) => {
              const next = shape.points[(idx + 1) % shape.points.length];
              return (
                <line
                  key={`edge-${idx}`}
                  x1={point.x}
                  y1={point.y}
                  x2={next.x}
                  y2={next.y}
                  stroke="transparent"
                  strokeWidth={0.3}
                  pointerEvents="stroke"
                  onPointerDown={(e) => {
                    if (selected) onPolygonEdgePointerDown?.(idx, e);
                  }}
                  onPointerMove={(e) => onEdgeHover?.(e, area, `edge-${idx}`, point, next)}
                  onPointerLeave={onEdgeHoverEnd}
                />
              );
            })}
        </g>
      ) : (
        <g>
          <path
            d={multiPolygonPath(shape.polygons, shape.holes)}
            fill={area.fill}
            stroke="none"
            opacity={baseOpacity}
            fillRule="evenodd"
          />
          {!selected && (
            <path
              d={multiPolygonPath(shape.polygons, shape.holes)}
              fill="url(#hatch)"
              opacity={hatchOpacity}
              fillRule="evenodd"
            />
          )}
          {showDimensions &&
            shape.polygons.map((poly, idx) =>
              poly.map((point, edgeIdx) => {
                const next = poly[(edgeIdx + 1) % poly.length];
                return (
                  <line
                    key={`edge-${idx}-${edgeIdx}`}
                    x1={point.x}
                    y1={point.y}
                    x2={next.x}
                    y2={next.y}
                    stroke="transparent"
                    strokeWidth={0.3}
                    pointerEvents="stroke"
                    onPointerDown={(e) => {
                      if (selected) onMultiPolygonEdgePointerDown?.(idx, edgeIdx, e);
                    }}
                    onPointerMove={(e) => onEdgeHover?.(e, area, `poly-${idx}-edge-${edgeIdx}`, point, next)}
                    onPointerLeave={onEdgeHoverEnd}
                  />
                );
              }),
            )}
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

      <g
        onPointerDown={(e) => {
          e.stopPropagation();
          onLabelPointerDown?.(e, area);
        }}
        style={{ cursor: 'grab' }}
      >
        {leader && (
          <>
            <line
              x1={labelCenter.x}
              y1={labelCenter.y}
              x2={leader.lineEnd.x}
              y2={leader.lineEnd.y}
              stroke="rgba(15,23,42,0.5)"
              strokeWidth={0.02}
            />
            <polygon
              points={leader.arrowPoints.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="rgba(15,23,42,0.85)"
              stroke="none"
            />
          </>
        )}
        <rect
          x={labelRect.x}
          y={labelRect.y}
          width={labelRect.width}
          height={labelRect.height}
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
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >
          {area.name}
        </text>
        <text
          x={labelX}
          y={labelY + labelLineHeight + labelGap}
          fontSize={areaFontSize}
          textAnchor="start"
          fill={textColor}
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >
          {areaText}
        </text>
      </g>

      {selected && (
        <>
          {showDimensions && isRect && (
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
                y={shape.y - 0.28}
                fontSize={0.3}
                textAnchor="middle"
                fill="#0f172a"
                style={{ userSelect: 'none', pointerEvents: 'none' }}
              >
                {shape.width.toFixed(2)} {plan.units}
              </text>
              <text
                x={shape.x + shape.width + 0.16}
                y={shape.y + shape.height / 2}
                fontSize={0.3}
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
          {showDimensions && (isPolygon || shape.type === 'multipolygon') &&
            getEdgeLabels(shape, edgeLabelOffsets ?? {}, plan.units).map((edge) => (
              <g
                key={edge.key}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onEdgeLabelPointerDown?.(e, area, edge.key);
                }}
                style={{ cursor: 'grab' }}
              >
                <line
                  x1={edge.x}
                  y1={edge.y}
                  x2={edge.lineEnd.x}
                  y2={edge.lineEnd.y}
                  stroke="rgba(15,23,42,0.5)"
                  strokeWidth={0.02}
                />
                <polygon
                  points={edge.arrowPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="rgba(15,23,42,0.85)"
                  stroke="none"
                />
                <rect
                  x={edge.x - edge.width / 2}
                  y={edge.y - edge.height / 2}
                  width={edge.width}
                  height={edge.height}
                  rx={0.05}
                  fill="rgba(255,255,255,0.85)"
                  stroke="rgba(15,23,42,0.25)"
                  strokeWidth={0.02}
                />
                <text
                  x={edge.x}
                  y={edge.y}
                  fontSize={edge.fontSize}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#0f172a"
                  style={{ userSelect: 'none', pointerEvents: 'none' }}
                >
                  {edge.label}
                </text>
              </g>
            ))}
          {showDimensions && isCircle && (
            <g
              onPointerDown={(e) => {
                e.stopPropagation();
                onRadiusLabelPointerDown?.(e, area);
              }}
              style={{ cursor: 'grab' }}
            >
              {(() => {
                const circleRadius = radius ?? 0;
                return (
                  <>
                    <rect
                      x={shape.cx + circleRadius + 0.3 + radiusOffsetX - radiusLabelWidth / 2}
                      y={shape.cy + radiusOffsetY - radiusLabelHeight / 2}
                      width={radiusLabelWidth}
                      height={radiusLabelHeight}
                      rx={0.06}
                      fill="rgba(255,255,255,0.85)"
                      stroke="rgba(15,23,42,0.25)"
                      strokeWidth={0.02}
                    />
                    <text
                      x={shape.cx + circleRadius + 0.3 + radiusOffsetX}
                      y={shape.cy + radiusOffsetY}
                      fontSize={radiusLabelFontSize}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#0f172a"
                      style={{ userSelect: 'none', pointerEvents: 'none' }}
                    >
                      {radiusLabelText}
                    </text>
                  </>
                );
              })()}
            </g>
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

function getEdgeLabels(
  shape: PolygonShape | MultiPolygonShape,
  edgeLabelOffsets: Record<string, { x: number; y: number }>,
  units: Plan['units'],
) {
  const fontSize = 0.14;
  const paddingX = 0.05;
  const paddingY = 0.03;
  const offsetDistance = 0.22;
  const arrowSize = 0.12;
  const polygons = shape.type === 'polygon' ? [shape.points] : shape.polygons;
  const edges: {
    key: string;
    x: number;
    y: number;
    label: string;
    width: number;
    height: number;
    fontSize: number;
    arrowPoints: { x: number; y: number }[];
    lineEnd: { x: number; y: number };
  }[] = [];

  polygons.forEach((points, polyIdx) => {
    points.forEach((point, idx) => {
      const next = points[(idx + 1) % points.length];
      const dx = next.x - point.x;
      const dy = next.y - point.y;
      const length = Math.hypot(dx, dy);
      if (!Number.isFinite(length) || length <= 0) return;
      const mid = { x: point.x + dx / 2, y: point.y + dy / 2 };
      const nx = -dy / length;
      const ny = dx / length;
      const key = shape.type === 'polygon' ? `edge-${idx}` : `poly-${polyIdx}-edge-${idx}`;
      const offset = edgeLabelOffsets[key] ?? { x: 0, y: 0 };
      const label = `${length.toFixed(2)} ${units}`;
      const width = label.length * fontSize * 0.6 + paddingX * 2;
      const height = fontSize + paddingY * 2;
      const labelX = mid.x + nx * offsetDistance + offset.x;
      const labelY = mid.y + ny * offsetDistance + offset.y;
      const toEdge = { x: mid.x - labelX, y: mid.y - labelY };
      const toEdgeLen = Math.hypot(toEdge.x, toEdge.y);
      const dir = toEdgeLen > 0 ? { x: toEdge.x / toEdgeLen, y: toEdge.y / toEdgeLen } : { x: 0, y: 0 };
      const perp = { x: -dir.y, y: dir.x };
      const tip = {
        x: mid.x,
        y: mid.y,
      };
      const base = {
        x: tip.x - dir.x * arrowSize,
        y: tip.y - dir.y * arrowSize,
      };
      const arrowPoints = [
        tip,
        { x: base.x + perp.x * (arrowSize * 0.5), y: base.y + perp.y * (arrowSize * 0.5) },
        { x: base.x - perp.x * (arrowSize * 0.5), y: base.y - perp.y * (arrowSize * 0.5) },
      ];
      const lineEnd = base;
      edges.push({
        key,
        x: labelX,
        y: labelY,
        label,
        width,
        height,
        fontSize,
        arrowPoints,
        lineEnd,
      });
    });
  });

  return edges;
}

function getLabelLeader(
  labelCenter: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
) {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const insideX = labelCenter.x >= bounds.x && labelCenter.x <= right;
  const insideY = labelCenter.y >= bounds.y && labelCenter.y <= bottom;
  let anchor = { x: labelCenter.x, y: labelCenter.y };

  if (insideX && insideY) {
    const distances = [
      { edge: 'left', d: Math.abs(labelCenter.x - bounds.x) },
      { edge: 'right', d: Math.abs(right - labelCenter.x) },
      { edge: 'top', d: Math.abs(labelCenter.y - bounds.y) },
      { edge: 'bottom', d: Math.abs(bottom - labelCenter.y) },
    ];
    distances.sort((a, b) => a.d - b.d);
    const edge = distances[0].edge;
    if (edge === 'left') anchor = { x: bounds.x, y: labelCenter.y };
    if (edge === 'right') anchor = { x: right, y: labelCenter.y };
    if (edge === 'top') anchor = { x: labelCenter.x, y: bounds.y };
    if (edge === 'bottom') anchor = { x: labelCenter.x, y: bottom };
  } else {
    const clampedX = Math.min(right, Math.max(bounds.x, labelCenter.x));
    const clampedY = Math.min(bottom, Math.max(bounds.y, labelCenter.y));
    anchor = { x: clampedX, y: clampedY };
  }

  const toEdge = { x: anchor.x - labelCenter.x, y: anchor.y - labelCenter.y };
  const len = Math.hypot(toEdge.x, toEdge.y);
  if (len <= 0.0001) return null;
  const dir = { x: toEdge.x / len, y: toEdge.y / len };
  const perp = { x: -dir.y, y: dir.x };
  const arrowSize = 0.12;
  const tip = anchor;
  const base = { x: tip.x - dir.x * arrowSize, y: tip.y - dir.y * arrowSize };
  return {
    lineEnd: base,
    arrowPoints: [
      tip,
      { x: base.x + perp.x * (arrowSize * 0.5), y: base.y + perp.y * (arrowSize * 0.5) },
      { x: base.x - perp.x * (arrowSize * 0.5), y: base.y - perp.y * (arrowSize * 0.5) },
    ],
  };
}
