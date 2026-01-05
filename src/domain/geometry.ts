import type { PartitionDirection, RectHandle, RectShape, PolygonShape, MultiPolygonShape, EllipseShape } from './types';

export const MIN_SIZE = 0.25;

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function cloneRect(rect: RectShape): RectShape {
  return { ...rect };
}

export function rectCenter(rect: RectShape) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function polygonCentroid(points: { x: number; y: number }[]) {
  if (points.length === 0) return { x: 0, y: 0 };
  const area = polygonArea(points) || 1;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const j = (i + 1) % points.length;
    const cross = points[i].x * points[j].y - points[j].x * points[i].y;
    cx += (points[i].x + points[j].x) * cross;
    cy += (points[i].y + points[j].y) * cross;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

export function rotatePoint(point: { x: number; y: number }, center: { x: number; y: number }, angleDeg: number) {
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

export function rotatePolygon(points: { x: number; y: number }[], center: { x: number; y: number }, angle: number) {
  return points.map((p) => rotatePoint(p, center, angle));
}

export function translatePolygon(points: { x: number; y: number }[], delta: { dx: number; dy: number }) {
  return points.map((p) => ({ x: p.x + delta.dx, y: p.y + delta.dy }));
}

export function clampPolygonToBounds(points: { x: number; y: number }[], bounds: { width: number; height: number }) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const dx = clamp(0 - minX, -Infinity, bounds.width - maxX);
  const dy = clamp(0 - minY, -Infinity, bounds.height - maxY);
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function clampDeltaForPolygon(
  points: { x: number; y: number }[],
  bounds: { width: number; height: number },
  delta: { dx: number; dy: number },
) {
  const xs = points.map((p) => p.x + delta.dx);
  const ys = points.map((p) => p.y + delta.dy);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const clampedDx = delta.dx + (minX < 0 ? -minX : 0) + (maxX > bounds.width ? bounds.width - maxX : 0);
  const clampedDy = delta.dy + (minY < 0 ? -minY : 0) + (maxY > bounds.height ? bounds.height - maxY : 0);
  return { dx: clampedDx, dy: clampedDy };
}

export function clampDeltaForMultiPolygon(
  polygons: { x: number; y: number }[][],
  bounds: { width: number; height: number },
  delta: { dx: number; dy: number },
  holes: { x: number; y: number }[][][] = [],
) {
  const pts = polygons.flat().concat(holes.flat(2));
  return clampDeltaForPolygon(pts, bounds, delta);
}

export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): RectShape {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(a.x - b.x);
  const height = Math.abs(a.y - b.y);
  return { type: 'rect', x, y, width, height };
}

export function applyRectResize(
  rect: RectShape,
  handle: RectHandle,
  delta: { dx: number; dy: number },
  bounds: { width: number; height: number },
  min = MIN_SIZE,
): RectShape {
  let { x, y, width, height } = rect;
  const maxWidth = bounds.width;
  const maxHeight = bounds.height;

  if (handle.includes('e')) {
    width = clamp(width + delta.dx, min, maxWidth - x);
  }
  if (handle.includes('s')) {
    height = clamp(height + delta.dy, min, maxHeight - y);
  }
  if (handle.includes('w')) {
    const nextX = clamp(x + delta.dx, 0, x + width - min);
    width = clamp(width - (nextX - x), min, maxWidth - nextX);
    x = nextX;
  }
  if (handle.includes('n')) {
    const nextY = clamp(y + delta.dy, 0, y + height - min);
    height = clamp(height - (nextY - y), min, maxHeight - nextY);
    y = nextY;
  }

  width = Math.max(min, Math.min(width, maxWidth));
  height = Math.max(min, Math.min(height, maxHeight));
  x = clamp(x, 0, maxWidth - width);
  y = clamp(y, 0, maxHeight - height);

  return { ...rect, x, y, width, height };
}

export function constrainRectToBounds(rect: RectShape, bounds: { width: number; height: number }, min = MIN_SIZE) {
  const x = clamp(rect.x, 0, Math.max(0, bounds.width - min));
  const y = clamp(rect.y, 0, Math.max(0, bounds.height - min));
  const width = clamp(rect.width, min, bounds.width - x);
  const height = clamp(rect.height, min, bounds.height - y);
  return { ...rect, x, y, width, height };
}

export function moveRect(rect: RectShape, delta: { dx: number; dy: number }, bounds: { width: number; height: number }) {
  const x = clamp(rect.x + delta.dx, 0, Math.max(0, bounds.width - rect.width));
  const y = clamp(rect.y + delta.dy, 0, Math.max(0, bounds.height - rect.height));
  return { ...rect, x, y };
}

export function rectsOverlap(a: RectShape, b: RectShape) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function snapValue(value: number, grid = 0.25) {
  return Math.round(value / grid) * grid;
}

export function snapRect(rect: RectShape, snapTo: number, neighborEdges: number[] = []) {
  const xSnap = snapValue(rect.x, snapTo);
  const ySnap = snapValue(rect.y, snapTo);
  const wSnap = snapValue(rect.width, snapTo);
  const hSnap = snapValue(rect.height, snapTo);
  const edges = [...neighborEdges];
  const snapEdge = (val: number) => {
    let best = val;
    let minDelta = snapTo * 0.6;
    edges.forEach((edge) => {
      const d = Math.abs(edge - val);
      if (d < minDelta) {
        minDelta = d;
        best = edge;
      }
    });
    return best;
  };
  const x = snapEdge(xSnap);
  const y = snapEdge(ySnap);
  const width = snapEdge(x + wSnap) - x;
  const height = snapEdge(y + hSnap) - y;
  return { ...rect, x, y, width: Math.max(width, MIN_SIZE), height: Math.max(height, MIN_SIZE) };
}

export function splitRectEvenly(rect: RectShape, count: number, direction: PartitionDirection): RectShape[] {
  if (count <= 1) return [cloneRect(rect)];
  const rects: RectShape[] = [];
  if (direction === 'vertical') {
    const slice = rect.width / count;
    for (let i = 0; i < count; i += 1) {
      rects.push({
        type: 'rect',
        x: rect.x + slice * i,
        y: rect.y,
        width: slice,
        height: rect.height,
      });
    }
  } else {
    const slice = rect.height / count;
    for (let i = 0; i < count; i += 1) {
      rects.push({
        type: 'rect',
        x: rect.x,
        y: rect.y + slice * i,
        width: rect.width,
        height: slice,
      });
    }
  }
  return rects;
}

export function pointInRect(point: { x: number; y: number }, rect: RectShape) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function shapeBoundingBox(shape: RectShape | PolygonShape | MultiPolygonShape | EllipseShape) {
  if (shape.type === 'rect') {
    return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  }
  if (shape.type === 'ellipse') {
    return { x: shape.cx - shape.rx, y: shape.cy - shape.ry, width: shape.rx * 2, height: shape.ry * 2 };
  }
  const pts =
    shape.type === 'polygon'
      ? shape.points.concat(shape.holes?.flat() ?? [])
      : shape.polygons.flat().concat(shape.holes?.flat(2) ?? []);
  const xs = pts.map((p: { x: number; y: number }) => p.x);
  const ys = pts.map((p: { x: number; y: number }) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function snapAngle(angle: number, enabled: boolean) {
  if (!enabled) return angle;
  const snaps = [0, 15, 30, 45, 90, 135, 180, 225, 270, 315];
  let best = angle;
  let bestDelta = 360;
  snaps.forEach((s) => {
    const delta = Math.abs(((angle - s + 540) % 360) - 180);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = s;
    }
  });
  return best;
}

export function polygonArea(points: { x: number; y: number }[]) {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonAreaWithHoles(points: { x: number; y: number }[], holes: { x: number; y: number }[][] = []) {
  const outer = polygonArea(points);
  const holeArea = holes.reduce((acc, hole) => acc + polygonArea(hole), 0);
  return Math.max(0, outer - holeArea);
}

export function ellipseToRect(ellipse: EllipseShape): RectShape {
  return { type: 'rect', x: ellipse.cx - ellipse.rx, y: ellipse.cy - ellipse.ry, width: ellipse.rx * 2, height: ellipse.ry * 2 };
}

export function rectToEllipse(rect: RectShape): EllipseShape {
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  return { type: 'ellipse', cx: rect.x + rx, cy: rect.y + ry, rx, ry };
}
