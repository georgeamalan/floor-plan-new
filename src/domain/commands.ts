import {
  applyRectResize,
  constrainRectToBounds,
  moveRect,
  polygonArea,
  polygonAreaWithHoles,
  ellipseToRect,
  splitRectEvenly,
  translatePolygon,
  shapeBoundingBox,
} from './geometry';
import { defaultAreaName, findArea, partitionNames } from './naming';
import { addGroup, deleteGroup, toggleGroupVisibility } from './grouping';
import type { Command, CommandPayloads, MirrorAxis, PartitionDirection, Plan, Selection, RectShape, EllipseShape } from './types';
import polygonClipping from 'polygon-clipping';

type CommandResult = {
  plan: Plan;
  selection?: Selection;
  description?: string;
};

function now() {
  return new Date().toISOString();
}

function clonePlan(plan: Plan): Plan {
  return structuredClone ? structuredClone(plan) : JSON.parse(JSON.stringify(plan));
}

function ensureUpdated(plan: Plan) {
  plan.meta.updatedAt = now();
}

type Ring = [number, number][];
type PolygonRings = Ring[];

function closeRing(points: { x: number; y: number }[]): Ring {
  const ring: Ring = points.map((p) => [p.x, p.y]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

function shapeToPolygons(
  shape:
    | RectShape
    | { type: 'polygon'; points: { x: number; y: number }[]; holes?: { x: number; y: number }[][] }
    | { type: 'multipolygon'; polygons: { x: number; y: number }[][]; holes?: { x: number; y: number }[][][] }
    | EllipseShape,
): PolygonRings[] {
  if (shape.type === 'rect') {
    const { x, y, width, height } = shape;
    const ring: Ring = [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
      [x, y],
    ];
    const polygon: PolygonRings = [ring];
    return [polygon];
  }
  if (shape.type === 'ellipse') {
    const segments = 48;
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      points.push({ x: shape.cx + Math.cos(angle) * shape.rx, y: shape.cy + Math.sin(angle) * shape.ry });
    }
    const polygon: PolygonRings = [closeRing(points)];
    return [polygon];
  }
  if (shape.type === 'polygon') {
    const polygon: PolygonRings = [closeRing(shape.points), ...(shape.holes ?? []).map(closeRing)];
    return [polygon];
  }
  return shape.polygons.map((poly, idx) => [closeRing(poly), ...(shape.holes?.[idx] ?? []).map(closeRing)]);
}

function ringsToPoints(ring: Ring): { x: number; y: number }[] {
  const trimmed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  return trimmed.map(([x, y]) => ({ x, y }));
}

function mirrorPoint(point: { x: number; y: number }, axis: MirrorAxis, center: { x: number; y: number }) {
  if (axis === 'vertical') {
    return { x: center.x * 2 - point.x, y: point.y };
  }
  return { x: point.x, y: center.y * 2 - point.y };
}

function shapeArea(shape: RectShape | { type: 'polygon'; points: { x: number; y: number }[]; holes?: { x: number; y: number }[][] } | { type: 'multipolygon'; polygons: { x: number; y: number }[][]; holes?: { x: number; y: number }[][][] } | EllipseShape) {
  if (shape.type === 'rect') {
    return Math.abs(shape.width * shape.height);
  }
  if (shape.type === 'ellipse') {
    return Math.abs(Math.PI * shape.rx * shape.ry);
  }
  if (shape.type === 'polygon') {
    return polygonAreaWithHoles(shape.points, shape.holes);
  }
  return shape.polygons.reduce((acc, poly, idx) => acc + polygonAreaWithHoles(poly, shape.holes?.[idx]), 0);
}

function updatePlanDimensions(plan: Plan, payload: CommandPayloads['plan/resize-boundary']): CommandResult {
  const next = clonePlan(plan);
  if (typeof payload.width === 'number') next.canvas.width = Math.max(payload.width, 0.5);
  if (typeof payload.height === 'number') next.canvas.height = Math.max(payload.height, 0.5);
  ensureUpdated(next);
  return { plan: next, description: 'Resize plan' };
}

function createPlan(_: Plan, payload: CommandPayloads['plan/create']): CommandResult {
  const next: Plan = {
    version: '1.0',
    units: payload.units,
    canvas: {
      width: payload.width,
      height: payload.height,
      zoom: 1,
      pan: { x: 0, y: 0 },
    },
    areas: [],
    meta: {
      name: payload.name ?? 'New Plan',
      createdAt: now(),
      updatedAt: now(),
    },
  };
  return { plan: next, selection: { areaIds: [] }, description: 'Create plan' };
}

function setViewport(plan: Plan, payload: CommandPayloads['plan/set-viewport']): CommandResult {
  const next = clonePlan(plan);
  if (typeof payload.zoom === 'number') next.canvas.zoom = Math.max(0.1, payload.zoom);
  if (payload.pan) next.canvas.pan = payload.pan;
  ensureUpdated(next);
  return { plan: next, description: 'Viewport change' };
}

function createAreasFromRect(
  plan: Plan,
  payload: CommandPayloads['area/create'],
  baseName: string,
): { plan: Plan; selection?: Selection; description?: string } {
  const next = clonePlan(plan);
  const partitions = Math.max(1, payload.partitions ?? 1);
  const direction: PartitionDirection =
    payload.direction ?? (payload.rect.width >= payload.rect.height ? 'vertical' : 'horizontal');
  const rects = splitRectEvenly(constrainRectToBounds(payload.rect, next.canvas), partitions, direction);
  const names = partitionNames(baseName, partitions);
  const createdIds: string[] = [];

  rects.forEach((rect, idx) => {
    const id = crypto.randomUUID();
    createdIds.push(id);
    next.areas.push({
      id,
      name: names[idx] ?? `${baseName} ${idx + 1}`,
      fill: payload.fill ?? '#bfdbfe',
      stroke: payload.stroke ?? '#1d4ed8',
      strokeWidth: 0.04,
      shape: rect,
      parentId: payload.parentId,
    });
  });
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: createdIds }, description: 'Create area' };
}

function createArea(plan: Plan, payload: CommandPayloads['area/create']): CommandResult {
  const baseName = payload.name ?? defaultAreaName(plan);
  return createAreasFromRect(plan, payload, baseName);
}

function createPolygon(plan: Plan, payload: CommandPayloads['area/create-polygon']): CommandResult {
  if (payload.points.length < 3) return { plan };
  const next = clonePlan(plan);
  const id = crypto.randomUUID();
  next.areas.push({
    id,
    name: payload.name ?? defaultAreaName(plan),
    fill: payload.fill ?? '#d8b4fe',
    stroke: payload.stroke ?? '#6b21a8',
    strokeWidth: 0.04,
    shape: { type: 'polygon', points: payload.points },
  });
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [id] }, description: 'Create polygon' };
}

function createEllipse(plan: Plan, payload: CommandPayloads['area/create-ellipse']): CommandResult {
  const next = clonePlan(plan);
  const id = crypto.randomUUID();
  next.areas.push({
    id,
    name: payload.name ?? defaultAreaName(plan),
    fill: payload.fill ?? '#fecaca',
    stroke: payload.stroke ?? '#dc2626',
    strokeWidth: 0.04,
    shape: { type: 'ellipse', cx: payload.cx, cy: payload.cy, rx: payload.rx, ry: payload.ry },
  });
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [id] }, description: 'Create ellipse' };
}

function pasteAreas(plan: Plan, payload: CommandPayloads['area/paste']): CommandResult {
  const next = clonePlan(plan);
  const createdIds: string[] = [];

  payload.areas.forEach((area) => {
    let shape = area.shape;

    if (shape.type === 'rect') {
      const rect = constrainRectToBounds(
        { ...shape, x: shape.x + payload.dx, y: shape.y + payload.dy },
        next.canvas,
      );
      shape = rect;
    } else if (shape.type === 'ellipse') {
      shape = { ...shape, cx: shape.cx + payload.dx, cy: shape.cy + payload.dy };
    } else if (shape.type === 'polygon') {
      const points = shape.points.map((p) => ({ x: p.x + payload.dx, y: p.y + payload.dy }));
      if (points.length < 3) return;
      const holes = shape.holes?.map((hole) => hole.map((p) => ({ x: p.x + payload.dx, y: p.y + payload.dy })));
      shape = { type: 'polygon', points, holes };
    } else {
      const polygons = shape.polygons.map((poly) => poly.map((p) => ({ x: p.x + payload.dx, y: p.y + payload.dy })));
      const holes = shape.holes?.map((holeList) => holeList.map((hole) => hole.map((p) => ({ x: p.x + payload.dx, y: p.y + payload.dy }))));
      if (!polygons.length || polygons.some((poly) => poly.length < 3)) return;
      shape = { type: 'multipolygon', polygons, holes };
    }

    const id = crypto.randomUUID();
    const name = payload.nameSuffix ? `${area.name} ${payload.nameSuffix}` : area.name;
    next.areas.push({
      id,
      name,
      fill: area.fill,
      stroke: area.stroke,
      strokeWidth: area.strokeWidth,
      shape,
      labelOffset: area.labelOffset,
      edgeLabelOffsets: area.edgeLabelOffsets,
      radiusLabelOffset: area.radiusLabelOffset,
    });
    createdIds.push(id);
  });

  if (!createdIds.length) return { plan };
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: createdIds }, description: 'Paste areas' };
}

function moveArea(plan: Plan, payload: CommandPayloads['area/move']): CommandResult {
  const target = findArea(plan, payload.id);
  if (!target || target.shape.type !== 'rect') return { plan };
  const next = clonePlan(plan);
  const area = findArea(next, payload.id);
  if (!area || area.shape.type !== 'rect') return { plan };
  area.shape = moveRect(area.shape, { dx: payload.dx, dy: payload.dy }, next.canvas);
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [payload.id] }, description: 'Move area' };
}

function movePolygonArea(plan: Plan, payload: CommandPayloads['area/move-polygon']): CommandResult {
  const next = clonePlan(plan);
  const area = findArea(next, payload.id);
  if (!area) return { plan };
  if (area.shape.type === 'polygon') {
    area.shape = {
      ...area.shape,
      points: translatePolygon(area.shape.points, { dx: payload.dx, dy: payload.dy }),
      holes: area.shape.holes?.map((hole) => translatePolygon(hole, { dx: payload.dx, dy: payload.dy })),
    };
  } else if (area.shape.type === 'multipolygon') {
    area.shape = {
      ...area.shape,
      polygons: area.shape.polygons.map((poly) => translatePolygon(poly, { dx: payload.dx, dy: payload.dy })),
      holes: area.shape.holes?.map((holeList) => holeList.map((hole) => translatePolygon(hole, { dx: payload.dx, dy: payload.dy }))),
    };
  } else {
    return { plan };
  }
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [payload.id] }, description: 'Move polygon' };
}

function resizeArea(plan: Plan, payload: CommandPayloads['area/resize']): CommandResult {
  const target = findArea(plan, payload.id);
  if (!target || target.shape.type !== 'rect') return { plan };
  const next = clonePlan(plan);
  const area = findArea(next, payload.id);
  if (!area || area.shape.type !== 'rect') return { plan };
  area.shape = applyRectResize(area.shape, payload.handle, { dx: payload.dx, dy: payload.dy }, next.canvas);
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [payload.id] }, description: 'Resize area' };
}

function setAreaRect(plan: Plan, payload: CommandPayloads['area/set-rect']): CommandResult {
  const target = findArea(plan, payload.id);
  if (!target) return { plan };
  const next = clonePlan(plan);
  const area = findArea(next, payload.id);
  if (!area || area.shape.type !== 'rect') return { plan };
  const rect = constrainRectToBounds(payload.rect, next.canvas);
  area.shape = rect;
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [payload.id] }, description: 'Update area' };
}

function setPolygon(plan: Plan, payload: CommandPayloads['area/set-polygon']): CommandResult {
  const next = clonePlan(plan);
  const area = findArea(next, payload.id);
  if (!area || (area.shape.type !== 'polygon' && area.shape.type !== 'rect')) return { plan };
  area.shape = {
    type: 'polygon',
    points: payload.points,
    holes: area.shape.type === 'polygon' ? area.shape.holes : undefined,
  };
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [payload.id] }, description: 'Edit polygon' };
}

function setEllipse(plan: Plan, payload: CommandPayloads['area/set-ellipse']): CommandResult {
  const next = clonePlan(plan);
  const area = findArea(next, payload.id);
  if (!area || area.shape.type !== 'ellipse') return { plan };
  area.shape = payload.ellipse;
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [payload.id] }, description: 'Edit ellipse' };
}

function setMultiPolygon(plan: Plan, payload: CommandPayloads['area/set-multipolygon']): CommandResult {
  const next = clonePlan(plan);
  const area = findArea(next, payload.id);
  if (!area || area.shape.type !== 'multipolygon') return { plan };
  area.shape = { ...area.shape, polygons: payload.polygons };
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [payload.id] }, description: 'Edit multipolygon' };
}

function setAreaRectBatch(plan: Plan, payload: CommandPayloads['area/set-rect-batch']): CommandResult {
  const next = clonePlan(plan);
  const validUpdates = payload.updates.filter((u) => {
    const area = findArea(next, u.id);
    return area && area.shape.type === 'rect';
  });
  validUpdates.forEach((u) => {
    const area = findArea(next, u.id);
    if (!area || area.shape.type !== 'rect') return;
    const rect = constrainRectToBounds(u.rect, next.canvas);
    area.shape = rect;
  });
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: validUpdates.map((u) => u.id) }, description: 'Update areas' };
}

function renameArea(plan: Plan, payload: CommandPayloads['area/rename']): CommandResult {
  const next = clonePlan(plan);
  const area = findArea(next, payload.id);
  if (!area) return { plan };
  area.name = payload.name;
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [payload.id] }, description: 'Rename area' };
}

function recolorArea(plan: Plan, payload: CommandPayloads['area/recolor']): CommandResult {
  const next = clonePlan(plan);
  const area = findArea(next, payload.id);
  if (!area) return { plan };
  area.fill = payload.fill;
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [payload.id] }, description: 'Recolor area' };
}

function mirrorArea(plan: Plan, payload: CommandPayloads['area/mirror']): CommandResult {
  const next = clonePlan(plan);
  const area = findArea(next, payload.id);
  if (!area) return { plan };
  if (area.shape.type === 'polygon') {
    const bbox = shapeBoundingBox(area.shape);
    const center = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
    area.shape = {
      ...area.shape,
      points: area.shape.points.map((p) => mirrorPoint(p, payload.axis, center)),
      holes: area.shape.holes?.map((hole) => hole.map((p) => mirrorPoint(p, payload.axis, center))),
    };
  } else if (area.shape.type === 'multipolygon') {
    const bbox = shapeBoundingBox(area.shape);
    const center = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
    area.shape = {
      ...area.shape,
      polygons: area.shape.polygons.map((poly) => poly.map((p) => mirrorPoint(p, payload.axis, center))),
      holes: area.shape.holes?.map((holeList) => holeList.map((hole) => hole.map((p) => mirrorPoint(p, payload.axis, center)))),
    };
  } else if (area.shape.type === 'rect') {
    // Mirroring a rectangle around its own bounds yields the same shape.
    area.shape = { ...area.shape };
  } else if (area.shape.type === 'ellipse') {
    area.shape = { ...area.shape };
  }
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [payload.id] }, description: 'Mirror area' };
}

function deleteArea(plan: Plan, payload: CommandPayloads['area/delete']): CommandResult {
  const next = clonePlan(plan);
  next.areas = next.areas.filter((a) => a.id !== payload.id);
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [] }, description: 'Delete area' };
}

function subtractAreas(plan: Plan, payload: CommandPayloads['area/subtract']): CommandResult {
  if (payload.ids.length < 2) return { plan };
  const next = clonePlan(plan);
  const targets = payload.ids
    .map((id) => findArea(next, id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));
  if (targets.length < 2) return { plan };
  const base = targets.reduce((largest, area) => (shapeArea(area.shape) > shapeArea(largest.shape) ? area : largest));
  const cutters = targets.filter((area) => area.id !== base.id);
  const subject = shapeToPolygons(base.shape);
  const clips = cutters.flatMap((area) => shapeToPolygons(area.shape));
  const diff = polygonClipping.difference(subject, ...clips);
  const polygons: { x: number; y: number }[][] = [];
  const holes: { x: number; y: number }[][][] = [];
  (diff ?? []).forEach((poly: Ring[]) => {
    const ring = poly?.[0];
    if (ring && ring.length >= 3) {
      polygons.push(ringsToPoints(ring));
      holes.push(poly.slice(1).map((hole) => ringsToPoints(hole)));
    }
  });
  if (!polygons.length) {
    next.areas = next.areas.filter((a) => !payload.ids.includes(a.id));
    ensureUpdated(next);
    return { plan: next, selection: { areaIds: [] }, description: 'Subtract areas' };
  }
  next.areas = next.areas.filter((a) => a.id === base.id || !payload.ids.includes(a.id));
  const baseArea = findArea(next, base.id);
  if (!baseArea) return { plan };
  baseArea.shape =
    polygons.length === 1
      ? { type: 'polygon', points: polygons[0], holes: holes[0] }
      : { type: 'multipolygon', polygons, holes };
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [base.id] }, description: 'Subtract areas' };
}

function mergeAreas(plan: Plan, payload: CommandPayloads['area/merge']): CommandResult {
  if (payload.ids.length < 2) return { plan };
  const next = clonePlan(plan);
  const targets = payload.ids
    .map((id) => findArea(next, id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));
  if (targets.length < 2) return { plan };
  const polygonInputs = targets.flatMap((area) => shapeToPolygons(area.shape));
  const merged = polygonClipping.union(...polygonInputs);
  const polygons: { x: number; y: number }[][] = [];
  const holes: { x: number; y: number }[][][] = [];
  (merged ?? []).forEach((poly: Ring[]) => {
    const ring = poly?.[0];
    if (ring && ring.length >= 3) {
      polygons.push(ringsToPoints(ring));
      holes.push(poly.slice(1).map((hole) => ringsToPoints(hole)));
    }
  });
  if (!polygons.length) return { plan };
  next.areas = next.areas.filter((a) => !payload.ids.includes(a.id));
  const mergedId = crypto.randomUUID();
  next.areas.push({
    id: mergedId,
    name: payload.name ?? 'Area',
    fill: payload.fill ?? targets[0].fill,
    stroke: payload.stroke ?? targets[0].stroke,
    strokeWidth: targets[0].strokeWidth,
    shape:
      polygons.length === 1
        ? { type: 'polygon', points: polygons[0], holes: holes[0] }
        : { type: 'multipolygon', polygons, holes },
  });
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [mergedId] }, description: 'Merge areas' };
}

function convertToPolygon(plan: Plan, payload: CommandPayloads['area/convert-to-polygon']): CommandResult {
  if (payload.ids.length < 1) return { plan };
  const next = clonePlan(plan);
  const targets = payload.ids
    .map((id) => findArea(next, id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));
  if (!targets.length) return { plan };
  const polygons: { x: number; y: number }[][] = [];
  targets.forEach((a) => {
    if (a.shape.type === 'rect') {
      const { x, y, width, height } = a.shape;
      polygons.push([
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ]);
    } else if (a.shape.type === 'ellipse') {
      const rect = ellipseToRect(a.shape);
      const segments = 48;
      const points: { x: number; y: number }[] = [];
      for (let i = 0; i < segments; i += 1) {
        const angle = (i / segments) * Math.PI * 2;
        points.push({ x: rect.x + rect.width / 2 + Math.cos(angle) * rect.width / 2, y: rect.y + rect.height / 2 + Math.sin(angle) * rect.height / 2 });
      }
      polygons.push(points);
    } else if (a.shape.type === 'polygon') {
      polygons.push(a.shape.points);
    } else {
      polygons.push(...a.shape.polygons);
    }
  });
  if (!polygons.length) return { plan };
  next.areas = next.areas.filter((a) => !payload.ids.includes(a.id));
  const id = crypto.randomUUID();
  next.areas.push({
    id,
    name: payload.name ?? `Polygon ${targets.length}`,
    fill: payload.fill ?? targets[0].fill,
    stroke: payload.stroke ?? targets[0].stroke,
    strokeWidth: targets[0].strokeWidth,
    shape: polygons.length === 1 ? { type: 'polygon', points: polygons[0] } : { type: 'multipolygon', polygons },
  });
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [id] }, description: 'Convert to polygon' };
}

function createGroup(plan: Plan, payload: CommandPayloads['group/create']): CommandResult {
  const next = addGroup(plan, payload.name, payload.areaIds);
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: payload.areaIds }, description: 'Create group' };
}

function removeGroup(plan: Plan, payload: CommandPayloads['group/delete']): CommandResult {
  const next = deleteGroup(plan, payload.id);
  ensureUpdated(next);
  return { plan: next, description: 'Delete group' };
}

function setGroupVisibility(plan: Plan, payload: CommandPayloads['group/visibility']): CommandResult {
  const next = toggleGroupVisibility(plan, payload.id, payload.visible);
  ensureUpdated(next);
  return { plan: next, description: 'Toggle group visibility' };
}

function divideArea(plan: Plan, payload: CommandPayloads['area/divide']): CommandResult {
  const target = findArea(plan, payload.id);
  if (!target) return { plan };
  const partitions = Math.max(2, payload.partitions);
  const next = clonePlan(plan);
  const baseArea = findArea(next, payload.id);
  if (!baseArea) return { plan };
  const direction: PartitionDirection =
    payload.direction ??
    (baseArea.shape.type === 'rect' && baseArea.shape.width >= baseArea.shape.height ? 'vertical' : 'horizontal');
  next.areas = next.areas.filter((a) => a.id !== payload.id);
  const names = partitionNames(baseArea.name, partitions);
  const created: string[] = [];
  if (baseArea.shape.type === 'rect') {
    const rects = splitRectEvenly(baseArea.shape, partitions, direction);
    rects.forEach((rect, idx) => {
      const id = crypto.randomUUID();
      created.push(id);
      next.areas.push({
        id,
        name: names[idx],
        fill: baseArea.fill,
        stroke: baseArea.stroke,
        strokeWidth: baseArea.strokeWidth,
        shape: rect,
        parentId: baseArea.id,
      });
    });
  } else {
    const bbox = shapeBoundingBox(baseArea.shape);
    const slices = splitRectEvenly(
      { type: 'rect', x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
      partitions,
      direction,
    );
    slices.forEach((rect, idx) => {
      const poly = {
        type: 'polygon' as const,
        points: [
          { x: rect.x, y: rect.y },
          { x: rect.x + rect.width, y: rect.y },
          { x: rect.x + rect.width, y: rect.y + rect.height },
          { x: rect.x, y: rect.y + rect.height },
        ],
      };
      const id = crypto.randomUUID();
      created.push(id);
      next.areas.push({
        id,
        name: names[idx],
        fill: baseArea.fill,
        stroke: baseArea.stroke,
        strokeWidth: baseArea.strokeWidth,
        shape: poly,
        parentId: baseArea.id,
      });
    });
  }
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: created }, description: 'Divide area' };
}

function loadPlan(_: Plan, payload: CommandPayloads['plan/load']): CommandResult {
  return { plan: payload.plan, selection: { areaIds: [] }, description: 'Load plan' };
}

function setSelection(plan: Plan, payload: CommandPayloads['selection/set']): CommandResult {
  return { plan, selection: payload, description: 'Select' };
}

function moveMany(plan: Plan, payload: CommandPayloads['area/move-multi']): CommandResult {
  const next = clonePlan(plan);
  payload.ids.forEach((id) => {
    const area = findArea(next, id);
    if (area && area.shape.type === 'rect') {
      const moved = moveRect(area.shape, { dx: payload.dx, dy: payload.dy }, next.canvas);
      area.shape = moved;
    }
    if (area && area.shape.type === 'ellipse') {
      area.shape = { ...area.shape, cx: area.shape.cx + payload.dx, cy: area.shape.cy + payload.dy };
    }
    if (area && area.shape.type === 'polygon') {
      area.shape = {
        ...area.shape,
        points: translatePolygon(area.shape.points, { dx: payload.dx, dy: payload.dy }),
        holes: area.shape.holes?.map((hole) => translatePolygon(hole, { dx: payload.dx, dy: payload.dy })),
      };
    }
    if (area && area.shape.type === 'multipolygon') {
      area.shape = {
        ...area.shape,
        polygons: area.shape.polygons.map((poly) => translatePolygon(poly, { dx: payload.dx, dy: payload.dy })),
        holes: area.shape.holes?.map((holeList) => holeList.map((hole) => translatePolygon(hole, { dx: payload.dx, dy: payload.dy }))),
      };
    }
  });
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: payload.ids }, description: 'Move areas' };
}

function setAreaLabelOffset(plan: Plan, payload: CommandPayloads['area/set-label-offset']): CommandResult {
  const next = clonePlan(plan);
  const area = findArea(next, payload.id);
  if (!area) return { plan };
  area.labelOffset = payload.offset;
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [payload.id] }, description: 'Move area label' };
}

function setEdgeLabelOffset(plan: Plan, payload: CommandPayloads['area/set-edge-label-offset']): CommandResult {
  const next = clonePlan(plan);
  const area = findArea(next, payload.id);
  if (!area) return { plan };
  area.edgeLabelOffsets = { ...(area.edgeLabelOffsets ?? {}), [payload.edgeKey]: payload.offset };
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [payload.id] }, description: 'Move edge label' };
}

function setRadiusLabelOffset(plan: Plan, payload: CommandPayloads['area/set-radius-label-offset']): CommandResult {
  const next = clonePlan(plan);
  const area = findArea(next, payload.id);
  if (!area) return { plan };
  area.radiusLabelOffset = payload.offset;
  ensureUpdated(next);
  return { plan: next, selection: { areaIds: [payload.id] }, description: 'Move radius label' };
}

export function performCommand(plan: Plan, command: Command): CommandResult {
  switch (command.type) {
    case 'plan/create':
      return createPlan(plan, command.payload);
    case 'plan/resize-boundary':
      return updatePlanDimensions(plan, command.payload);
    case 'plan/set-viewport':
      return setViewport(plan, command.payload);
    case 'plan/load':
      return loadPlan(plan, command.payload);
    case 'area/create':
      return createArea(plan, command.payload);
    case 'area/create-polygon':
      return createPolygon(plan, command.payload);
    case 'area/create-ellipse':
      return createEllipse(plan, command.payload);
    case 'area/paste':
      return pasteAreas(plan, command.payload);
    case 'area/move':
      return moveArea(plan, command.payload);
    case 'area/move-polygon':
      return movePolygonArea(plan, command.payload);
    case 'area/resize':
      return resizeArea(plan, command.payload);
    case 'area/set-rect':
      return setAreaRect(plan, command.payload);
    case 'area/set-ellipse':
      return setEllipse(plan, command.payload);
    case 'area/set-rect-batch':
      return setAreaRectBatch(plan, command.payload);
    case 'area/set-polygon':
      return setPolygon(plan, command.payload);
    case 'area/set-multipolygon':
      return setMultiPolygon(plan, command.payload);
    case 'area/rename':
      return renameArea(plan, command.payload);
    case 'area/recolor':
      return recolorArea(plan, command.payload);
    case 'area/delete':
      return deleteArea(plan, command.payload);
    case 'area/mirror':
      return mirrorArea(plan, command.payload);
    case 'area/subtract':
      return subtractAreas(plan, command.payload);
    case 'area/divide':
      return divideArea(plan, command.payload);
    case 'area/merge':
      return mergeAreas(plan, command.payload);
    case 'group/create':
      return createGroup(plan, command.payload);
    case 'group/delete':
      return removeGroup(plan, command.payload);
    case 'group/visibility':
      return setGroupVisibility(plan, command.payload);
    case 'area/convert-to-polygon':
      return convertToPolygon(plan, command.payload);
    case 'area/move-multi':
      return moveMany(plan, command.payload);
    case 'area/set-label-offset':
      return setAreaLabelOffset(plan, command.payload);
    case 'area/set-edge-label-offset':
      return setEdgeLabelOffset(plan, command.payload);
    case 'area/set-radius-label-offset':
      return setRadiusLabelOffset(plan, command.payload);
    case 'selection/set':
      return setSelection(plan, command.payload);
    default:
      return { plan };
  }
}
