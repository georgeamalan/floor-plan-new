import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyRectResize,
  MIN_SIZE,
  moveRect,
  rectFromPoints,
  rectsOverlap,
  snapValue,
  snapRect,
  translatePolygon,
  clampDeltaForPolygon,
  clampDeltaForMultiPolygon,
  clamp,
} from '../domain/geometry';
import type { Area, BoundaryHandle, PolygonShape, RectHandle, RectShape, MultiPolygonShape } from '../domain/types';
import { usePlanStore } from '../store/usePlanStore';
import { usePromptStore } from '../store/usePromptStore';
import AreaRenderer from './AreaRenderer';
import polygonClipping from 'polygon-clipping';

type Interaction =
  | { kind: 'panning'; start: { x: number; y: number }; panStart: { x: number; y: number } }
  | { kind: 'dragging-area'; areaId: string; origin: RectShape; start: { x: number; y: number } }
  | { kind: 'dragging-polygon'; areaId: string; points: { x: number; y: number }[]; start: { x: number; y: number } }
  | { kind: 'dragging-multipolygon'; areaId: string; polygons: { x: number; y: number }[][]; start: { x: number; y: number } }
  | { kind: 'polygon-point'; areaId: string; index: number; start: { x: number; y: number }; points: { x: number; y: number }[] }
  | {
      kind: 'multipolygon-point';
      areaId: string;
      polyIndex: number;
      pointIndex: number;
      start: { x: number; y: number };
      polygons: { x: number; y: number }[][];
    }
  | {
      kind: 'resizing-area';
      areaId: string;
      handle: RectHandle;
      origin: RectShape;
      start: { x: number; y: number };
    }
  | {
      kind: 'resizing-multi';
      ids: string[];
      handle: RectHandle;
      origins: Record<string, RectShape>;
      start: { x: number; y: number };
    }
  | { kind: 'resizing-boundary'; handle: BoundaryHandle; start: { x: number; y: number }; origin: { width: number; height: number } }
  | { kind: 'drawing'; start: { x: number; y: number }; current: { x: number; y: number } }
  | { kind: 'drawing-polygon'; points: { x: number; y: number }[]; hover?: { x: number; y: number } };

const paddingPx = 36;
type Ring = [number, number][];
type PolygonRings = Ring[];

const closeRing = (points: { x: number; y: number }[]): Ring => {
  const ring: Ring = points.map((p) => [p.x, p.y]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push([first[0], first[1]]);
  }
  return ring;
};

const shapeToPolygons = (shape: RectShape | PolygonShape | MultiPolygonShape): PolygonRings[] => {
  if (shape.type === 'rect') {
    const { x, y, width, height } = shape;
    return [
      [
        [
          [x, y],
          [x + width, y],
          [x + width, y + height],
          [x, y + height],
          [x, y],
        ],
      ],
    ];
  }
  if (shape.type === 'polygon') {
    return [[closeRing(shape.points)]];
  }
  return shape.polygons.map((poly) => [closeRing(poly)]);
};

const ringToPoints = (ring: Ring) => {
  const trimmed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring;
  return trimmed.map(([x, y]) => ({ x, y }));
};

const polygonCentroid = (points: { x: number; y: number }[]) => {
  if (!points.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  points.forEach((p) => {
    x += p.x;
    y += p.y;
  });
  return { x: x / points.length, y: y / points.length };
};

export default function CanvasStage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const plan = usePlanStore((s) => s.plan);
  const selection = usePlanStore((s) => s.selection);
  const setSelection = usePlanStore((s) => s.setSelection);
  const activeTool = usePlanStore((s) => s.activeTool);
  const paletteColor = usePlanStore((s) => s.paletteColor);
  const snapEnabled = usePlanStore((s) => s.snapEnabled);
  const apply = usePlanStore((s) => s.apply);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [draftShapes, setDraftShapes] = useState<Record<string, RectShape | PolygonShape | MultiPolygonShape>>({});
  const [draftNew, setDraftNew] = useState<RectShape | null>(null);
  const [draftBoundary, setDraftBoundary] = useState<{ width: number; height: number } | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [size, setSize] = useState({ width: 900, height: 700 });
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; targetId?: string }>({
    visible: false,
    x: 0,
    y: 0,
    targetId: undefined,
  });
  const openPrompt = usePromptStore((s) => s.openPrompt);
  const longPressTimer = useRef<number | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggered = useRef(false);

  const completePolygon = useCallback(() => {
    if (interaction?.kind !== 'drawing-polygon') return;
    if (interaction.points.length < 3) {
      setInteraction(null);
      return;
    }
    apply({ type: 'area/create-polygon', payload: { points: interaction.points } });
    setInteraction(null);
  }, [apply, interaction]);

  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  const projectPointToSegment = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const ap = { x: p.x - a.x, y: p.y - a.y };
    const abLenSq = ab.x * ab.x + ab.y * ab.y;
    const t = abLenSq === 0 ? 0 : Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y) / abLenSq));
    return { x: a.x + ab.x * t, y: a.y + ab.y * t };
  };

  // Track container size for scaling
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const baseScale = useMemo(() => {
    const wScale = (size.width - paddingPx * 2) / plan.canvas.width;
    const hScale = (size.height - paddingPx * 2) / plan.canvas.height;
    return Math.max(2, Math.min(wScale, hScale));
  }, [plan.canvas.height, plan.canvas.width, size.height, size.width]);

  const scale = baseScale * plan.canvas.zoom;

  const availablePolygons = useMemo(() => {
    const canvasPoly: PolygonRings = [
      [
        [0, 0],
        [plan.canvas.width, 0],
        [plan.canvas.width, plan.canvas.height],
        [0, plan.canvas.height],
        [0, 0],
      ],
    ];
    const occupied = plan.areas.flatMap((area) => shapeToPolygons(area.shape));
    const diff = occupied.length ? polygonClipping.difference(canvasPoly, ...occupied) : [canvasPoly];
    return (diff ?? [])
      .map((poly: Ring[]) => ringToPoints(poly[0] ?? []))
      .filter((points) => points.length >= 3);
  }, [plan.areas, plan.canvas.height, plan.canvas.width]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(true);
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.areaIds.length) {
      selection.areaIds.forEach((id) => apply({ type: 'area/delete', payload: { id } }));
    }
      if (selection.areaIds.length && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const stepPx = e.shiftKey ? 10 : 1;
        const step = stepPx / scale;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        apply({ type: 'area/move-multi', payload: { ids: selection.areaIds, dx, dy } });
      }
      if (e.key === 'Enter') {
        completePolygon();
      }
      if (e.key === 'Escape' && interaction?.kind === 'drawing-polygon') {
        setInteraction(null);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [apply, selection.areaIds, completePolygon, interaction, scale]);

  const toWorld = (evt: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const x = (evt.clientX - rect.left - paddingPx - plan.canvas.pan.x) / scale;
    const y = (evt.clientY - rect.top - paddingPx - plan.canvas.pan.y) / scale;
    return { x, y };
  };

  const pointerToScreen = (evt: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  };

  const startLongPress = (evt: { clientX: number; clientY: number }, areaId: string) => {
    longPressTriggered.current = false;
    longPressStart.current = { x: evt.clientX, y: evt.clientY };
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true;
      setContextMenu({ visible: true, x: evt.clientX, y: evt.clientY, targetId: areaId });
      setInteraction(null);
    }, 500);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    longPressStart.current = null;
    longPressTriggered.current = false;
  };

  const handleWheel = useCallback(
    (evt: WheelEvent) => {
      evt.preventDefault();
      const world = toWorld(evt);
      const screen = pointerToScreen(evt);
      const delta = evt.deltaY > 0 ? 0.9 : 1.1;
      const nextZoom = Math.max(0.3, Math.min(6, plan.canvas.zoom * delta));
      const newScale = baseScale * nextZoom;
      const newPan = {
        x: screen.x - paddingPx - world.x * newScale,
        y: screen.y - paddingPx - world.y * newScale,
      };
      apply({ type: 'plan/set-viewport', payload: { zoom: nextZoom, pan: newPan } });
    },
    [apply, baseScale, paddingPx, plan.canvas.zoom, toWorld, pointerToScreen],
  );

  const startPan = (evt: React.PointerEvent) => {
    evt.preventDefault();
    setInteraction({
      kind: 'panning',
      start: { x: evt.clientX, y: evt.clientY },
      panStart: { ...plan.canvas.pan },
    });
  };

  const onAreaPointerDown = (event: React.PointerEvent, area: Area) => {
    if (event.button === 2) {
      // Allow native context menu
      return;
    }
    if (activeTool === 'select' && event.button === 0) {
      startLongPress(event, area.id);
    }
    if (activeTool === 'fill') {
      apply({ type: 'area/recolor', payload: { id: area.id, fill: paletteColor } });
      return;
    }
    if (activeTool === 'label') {
      openPrompt('Rename area', area.name, (val) => apply({ type: 'area/rename', payload: { id: area.id, name: val } }));
      return;
    }
    if (activeTool === 'divide') {
      openPrompt('Divide into partitions (number)', '2', (val) => {
        const partitions = parseInt(val, 10);
        if (Number.isFinite(partitions) && partitions > 1) {
          apply({ type: 'area/divide', payload: { id: area.id, partitions, direction: 'vertical' } });
        }
      });
      return;
    }
    if (activeTool === 'delete') {
      apply({ type: 'area/delete', payload: { id: area.id } });
      return;
    }
    if (area.shape.type === 'polygon' && activeTool === 'select' && event.altKey) {
      const world = toWorld(event);
      insertPolygonPoint(area as Area & { shape: PolygonShape }, world);
      return;
    }
    if (area.shape.type === 'polygon' && activeTool === 'select' && event.altKey) {
      const world = toWorld(event);
      insertPolygonPoint(area as Area & { shape: PolygonShape }, world);
      return;
    }
    const currentlySelected = selection.areaIds;
    const alreadySelected = currentlySelected.includes(area.id);
    const nextSelection = event.shiftKey
      ? Array.from(new Set([...currentlySelected, area.id]))
      : alreadySelected
        ? currentlySelected
        : [area.id];
    setSelection({ areaIds: nextSelection });
    const world = toWorld(event);
    if (area.shape.type === 'rect') {
      setInteraction({
        kind: 'dragging-area',
        areaId: area.id,
        origin: area.shape,
        start: world,
      });
    } else if (area.shape.type === 'polygon') {
      setInteraction({
        kind: 'dragging-polygon',
        areaId: area.id,
        points: area.shape.points,
        start: world,
      });
    } else if (area.shape.type === 'multipolygon') {
      setInteraction({
        kind: 'dragging-multipolygon',
        areaId: area.id,
        polygons: area.shape.polygons,
        start: world,
      });
    }
  };

  const onHandlePointerDown = (handle: RectHandle, event: React.PointerEvent, area: Area) => {
    if (area.shape.type !== 'rect') return;
    const world = toWorld(event);
    if (selection.areaIds.length > 1 && selection.areaIds.includes(area.id)) {
      const origins: Record<string, RectShape> = {};
      selection.areaIds.forEach((id) => {
        const found = plan.areas.find((a) => a.id === id && a.shape.type === 'rect') as Area & {
          shape: RectShape;
        } | undefined;
        if (found) origins[id] = found.shape;
      });
      setInteraction({
        kind: 'resizing-multi',
        ids: Object.keys(origins),
        handle,
        origins,
        start: world,
      });
    } else {
      setSelection({ areaIds: [area.id] });
      setInteraction({
        kind: 'resizing-area',
        areaId: area.id,
        handle,
        origin: area.shape,
        start: world,
      });
    }
  };

  const startDrawing = (evt: React.PointerEvent) => {
    const world = toWorld(evt);
    setInteraction({ kind: 'drawing', start: world, current: world });
    setDraftNew({ type: 'rect', x: world.x, y: world.y, width: MIN_SIZE, height: MIN_SIZE });
  };

  const insertPolygonPoint = (area: Area & { shape: PolygonShape }, world: { x: number; y: number }) => {
    const { points } = area.shape;
    if (points.length < 2) return;
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    let bestPoint = world;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const proj = projectPointToSegment(world, a, b);
      const dist = distance(world, proj);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i + 1;
        bestPoint = proj;
      }
    }
    const nextPoints = [...points.slice(0, bestIdx), bestPoint, ...points.slice(bestIdx)];
    apply({ type: 'area/set-polygon', payload: { id: area.id, points: nextPoints } });
  };

  const addPolygonPoint = (evt: React.PointerEvent) => {
    const world = toWorld(evt);
    if (interaction?.kind === 'drawing-polygon') {
      setInteraction({ kind: 'drawing-polygon', points: [...interaction.points, world] });
    } else {
      setInteraction({ kind: 'drawing-polygon', points: [world] });
    }
  };

  const startPolygonVertexDrag = (areaId: string, index: number, evt: React.PointerEvent) => {
    const area = plan.areas.find((a) => a.id === areaId && a.shape.type === 'polygon') as
      | (Area & { shape: PolygonShape })
      | undefined;
    if (!area) return;
    const world = toWorld(evt);
    setInteraction({
      kind: 'polygon-point',
      areaId,
      index,
      start: world,
      points: area.shape.points,
    });
  };

  const startMultipolygonVertexDrag = (areaId: string, polyIndex: number, pointIndex: number, evt: React.PointerEvent) => {
    const area = plan.areas.find((a) => a.id === areaId && a.shape.type === 'multipolygon') as
      | (Area & { shape: MultiPolygonShape })
      | undefined;
    if (!area) return;
    const world = toWorld(evt);
    setInteraction({
      kind: 'multipolygon-point',
      areaId,
      polyIndex,
      pointIndex,
      start: world,
      polygons: area.shape.polygons,
    });
  };


  const startResizeBoundary = (handle: BoundaryHandle, evt: React.PointerEvent) => {
    const world = toWorld(evt);
    setInteraction({
      kind: 'resizing-boundary',
      handle,
      start: world,
      origin: { width: plan.canvas.width, height: plan.canvas.height },
    });
  };

  const onPointerMove = (evt: PointerEvent) => {
    if (!interaction) return;
    const world = toWorld(evt);
    if (!world) return;
    if (longPressTimer.current && longPressStart.current) {
      const dist = Math.hypot(evt.clientX - longPressStart.current.x, evt.clientY - longPressStart.current.y);
      if (dist > 1) {
        cancelLongPress();
      }
    }
    if (longPressTriggered.current) return;
    if (interaction.kind === 'panning') {
      const dx = evt.clientX - interaction.start.x;
      const dy = evt.clientY - interaction.start.y;
      apply({
        type: 'plan/set-viewport',
        payload: { pan: { x: interaction.panStart.x + dx, y: interaction.panStart.y + dy } },
      });
      return;
    }
    if (interaction.kind === 'dragging-area') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      const ids = selection.areaIds.length ? selection.areaIds : [interaction.areaId];
      const drafts: Record<string, RectShape | PolygonShape> = {};
      ids.forEach((id) => {
        const area = plan.areas.find((a) => a.id === id);
        if (area && area.shape.type === 'rect') {
          const moved = moveRect(area.shape, { dx, dy }, plan.canvas);
          const neighborEdges = plan.areas
            .filter((a): a is Area & { shape: RectShape } => a.id !== id && a.shape.type === 'rect')
            .flatMap((a) => [a.shape.x, a.shape.x + a.shape.width, a.shape.y, a.shape.y + a.shape.height]);
          const snapped = snapEnabled ? snapRect(moved, 0.25, neighborEdges) : moved;
          drafts[id] = snapped;
        }
      });
      setDraftShapes(drafts);
      return;
    }
    if (interaction.kind === 'dragging-polygon') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      const area = plan.areas.find((a) => a.id === interaction.areaId);
      if (area && area.shape.type === 'polygon') {
        const snapDx = snapEnabled ? snapValue(dx, 0.25) : dx;
        const snapDy = snapEnabled ? snapValue(dy, 0.25) : dy;
        const clamped = clampDeltaForPolygon(interaction.points, plan.canvas, { dx: snapDx, dy: snapDy });
        const snappedPoints = translatePolygon(interaction.points, clamped);
        setDraftShapes({ [interaction.areaId]: { ...area.shape, points: snappedPoints } });
      }
      return;
    }
    if (interaction.kind === 'dragging-multipolygon') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      const area = plan.areas.find((a) => a.id === interaction.areaId);
      if (area && area.shape.type === 'multipolygon') {
        const snapDx = snapEnabled ? snapValue(dx, 0.25) : dx;
        const snapDy = snapEnabled ? snapValue(dy, 0.25) : dy;
        const clamped = clampDeltaForMultiPolygon(interaction.polygons, plan.canvas, { dx: snapDx, dy: snapDy });
        const translated = interaction.polygons.map((poly) => translatePolygon(poly, clamped));
        setDraftShapes({ [interaction.areaId]: { ...area.shape, polygons: translated } });
      }
      return;
    }
    if (interaction.kind === 'polygon-point') {
      const dx = snapEnabled ? snapValue(world.x - interaction.start.x, 0.25) : world.x - interaction.start.x;
      const dy = snapEnabled ? snapValue(world.y - interaction.start.y, 0.25) : world.y - interaction.start.y;
      const points = interaction.points.map((p, idx) =>
        idx === interaction.index
          ? { x: clamp(p.x + dx, 0, plan.canvas.width), y: clamp(p.y + dy, 0, plan.canvas.height) }
          : p,
      );
      setDraftShapes({ [interaction.areaId]: { type: 'polygon', points } as PolygonShape });
      return;
    }
    if (interaction.kind === 'multipolygon-point') {
      const dx = snapEnabled ? snapValue(world.x - interaction.start.x, 0.25) : world.x - interaction.start.x;
      const dy = snapEnabled ? snapValue(world.y - interaction.start.y, 0.25) : world.y - interaction.start.y;
      const polygons = interaction.polygons.map((poly, pIdx) =>
        poly.map((p, idx) =>
          pIdx === interaction.polyIndex && idx === interaction.pointIndex
            ? { x: clamp(p.x + dx, 0, plan.canvas.width), y: clamp(p.y + dy, 0, plan.canvas.height) }
            : p,
        ),
      );
      setDraftShapes({ [interaction.areaId]: { type: 'multipolygon', polygons } as MultiPolygonShape });
      return;
    }
    if (interaction.kind === 'resizing-area') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      const rect = applyRectResize(interaction.origin, interaction.handle, { dx, dy }, plan.canvas);
      const snapped = snapEnabled
        ? snapRect(
            rect,
            0.25,
            plan.areas
              .filter((a): a is Area & { shape: RectShape } => a.id !== interaction.areaId && a.shape.type === 'rect')
              .flatMap((a) => [a.shape.x, a.shape.x + a.shape.width, a.shape.y, a.shape.y + a.shape.height]),
          )
        : rect;
      setDraftShapes({ [interaction.areaId]: snapped });
      return;
    }
    if (interaction.kind === 'resizing-multi') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      const drafts: Record<string, RectShape> = {};
      interaction.ids.forEach((id) => {
        const origin = interaction.origins[id];
        if (origin) {
          const rect = applyRectResize(origin, interaction.handle, { dx, dy }, plan.canvas);
          const neighborEdges = plan.areas
            .filter((a): a is Area & { shape: RectShape } => a.id !== id && a.shape.type === 'rect')
            .flatMap((a) => [a.shape.x, a.shape.x + a.shape.width, a.shape.y, a.shape.y + a.shape.height]);
          drafts[id] = snapEnabled ? snapRect(rect, 0.25, neighborEdges) : rect;
        }
      });
      setDraftShapes(drafts);
      return;
    }
    if (interaction.kind === 'drawing') {
      const rect = rectFromPoints(interaction.start, world);
      const snapped = snapEnabled
        ? snapRect(
            rect,
            0.25,
            plan.areas
              .filter((a): a is Area & { shape: RectShape } => a.shape.type === 'rect')
              .flatMap((a) => [a.shape.x, a.shape.x + a.shape.width, a.shape.y, a.shape.y + a.shape.height]),
          )
        : rect;
      setDraftNew(snapped);
      setInteraction({ ...interaction, current: world });
      return;
    }
    if (interaction.kind === 'resizing-boundary') {
      let width = interaction.origin.width;
      let height = interaction.origin.height;
      if (interaction.handle === 'right') width = Math.max(MIN_SIZE, world.x);
      if (interaction.handle === 'left') width = Math.max(MIN_SIZE, interaction.origin.width + (interaction.start.x - world.x));
      if (interaction.handle === 'bottom') height = Math.max(MIN_SIZE, world.y);
      if (interaction.handle === 'top')
        height = Math.max(MIN_SIZE, interaction.origin.height + (interaction.start.y - world.y));
      setDraftBoundary({ width, height });
    }
    if (interaction.kind === 'drawing-polygon') {
      setInteraction({ ...interaction, hover: world });
      return;
    }
  };

  const finishInteraction = (evt: PointerEvent) => {
    cancelLongPress();
    if (!interaction) return;
    const world = toWorld(evt);
    if (!world) {
      setInteraction(null);
      return;
    }
    if (interaction.kind === 'dragging-area') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      const ids = selection.areaIds.length ? selection.areaIds : [interaction.areaId];
      const first = plan.areas.find((a) => a.id === interaction.areaId);
      const rect = first && first.shape.type === 'rect' ? moveRect(interaction.origin, { dx, dy }, plan.canvas) : null;
      const neighborEdges = plan.areas
        .filter((a): a is Area & { shape: RectShape } => !ids.includes(a.id) && a.shape.type === 'rect')
        .flatMap((a) => [a.shape.x, a.shape.x + a.shape.width, a.shape.y, a.shape.y + a.shape.height]);
      const snapRectIf = (r: RectShape) => (snapEnabled ? snapRect(r, 0.25, neighborEdges) : r);
      if (ids.length > 1) {
        apply({ type: 'area/move-multi', payload: { ids, dx, dy } });
      } else if (rect) {
        apply({ type: 'area/set-rect', payload: { id: interaction.areaId, rect: snapRectIf(rect) } });
      }
      setDraftShapes({});
    }
    if (interaction.kind === 'dragging-polygon') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      const snapDx = snapEnabled ? snapValue(dx, 0.25) : dx;
      const snapDy = snapEnabled ? snapValue(dy, 0.25) : dy;
      const clamped = clampDeltaForPolygon(interaction.points, plan.canvas, { dx: snapDx, dy: snapDy });
      apply({ type: 'area/move-polygon', payload: { id: interaction.areaId, dx: clamped.dx, dy: clamped.dy } });
      setDraftShapes({});
    }
    if (interaction.kind === 'dragging-multipolygon') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      const snapDx = snapEnabled ? snapValue(dx, 0.25) : dx;
      const snapDy = snapEnabled ? snapValue(dy, 0.25) : dy;
      const clamped = clampDeltaForMultiPolygon(interaction.polygons, plan.canvas, { dx: snapDx, dy: snapDy });
      apply({ type: 'area/move-multi', payload: { ids: [interaction.areaId], dx: clamped.dx, dy: clamped.dy } });
      setDraftShapes({});
    }
    if (interaction.kind === 'polygon-point') {
      const dx = snapEnabled ? snapValue(world.x - interaction.start.x, 0.25) : world.x - interaction.start.x;
      const dy = snapEnabled ? snapValue(world.y - interaction.start.y, 0.25) : world.y - interaction.start.y;
      const points = interaction.points.map((p, idx) =>
        idx === interaction.index
          ? { x: clamp(p.x + dx, 0, plan.canvas.width), y: clamp(p.y + dy, 0, plan.canvas.height) }
          : p,
      );
      apply({ type: 'area/set-polygon', payload: { id: interaction.areaId, points } });
      setDraftShapes({});
    }
    if (interaction.kind === 'multipolygon-point') {
      const dx = snapEnabled ? snapValue(world.x - interaction.start.x, 0.25) : world.x - interaction.start.x;
      const dy = snapEnabled ? snapValue(world.y - interaction.start.y, 0.25) : world.y - interaction.start.y;
      const polygons = interaction.polygons.map((poly, pIdx) =>
        poly.map((p, idx) =>
          pIdx === interaction.polyIndex && idx === interaction.pointIndex
            ? { x: clamp(p.x + dx, 0, plan.canvas.width), y: clamp(p.y + dy, 0, plan.canvas.height) }
            : p,
        ),
      );
      apply({ type: 'area/set-multipolygon', payload: { id: interaction.areaId, polygons } });
      setDraftShapes({});
    }
    if (interaction.kind === 'resizing-area') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      const rect = applyRectResize(interaction.origin, interaction.handle, { dx, dy }, plan.canvas);
      const neighborEdges = plan.areas
        .filter((a): a is Area & { shape: RectShape } => a.id !== interaction.areaId && a.shape.type === 'rect')
        .flatMap((a) => [a.shape.x, a.shape.x + a.shape.width, a.shape.y, a.shape.y + a.shape.height]);
      const snapped = snapEnabled ? snapRect(rect, 0.25, neighborEdges) : rect;
      apply({ type: 'area/set-rect', payload: { id: interaction.areaId, rect: snapped } });
      setDraftShapes({});
    }
    if (interaction.kind === 'resizing-multi') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      const updates: { id: string; rect: RectShape }[] = [];
      interaction.ids.forEach((id) => {
        const origin = interaction.origins[id];
        if (origin) {
          const rect = applyRectResize(origin, interaction.handle, { dx, dy }, plan.canvas);
          const neighborEdges = plan.areas
            .filter((a): a is Area & { shape: RectShape } => a.id !== id && a.shape.type === 'rect')
            .flatMap((a) => [a.shape.x, a.shape.x + a.shape.width, a.shape.y, a.shape.y + a.shape.height]);
          updates.push({ id, rect: snapEnabled ? snapRect(rect, 0.25, neighborEdges) : rect });
        }
      });
      if (updates.length) {
        apply({ type: 'area/set-rect-batch', payload: { updates } });
      }
      setDraftShapes({});
    }
    if (interaction.kind === 'drawing') {
      const rectRaw = rectFromPoints(interaction.start, world);
      const neighborEdges = plan.areas
        .filter((a): a is Area & { shape: RectShape } => a.shape.type === 'rect')
        .flatMap((a) => [a.shape.x, a.shape.x + a.shape.width, a.shape.y, a.shape.y + a.shape.height]);
      const rect = snapEnabled ? snapRect(rectRaw, 0.25, neighborEdges) : rectRaw;
      const overlaps = plan.areas.some((a): a is Area & { shape: RectShape } => a.shape.type === 'rect' && rectsOverlap(rect, a.shape));
      if (!overlaps && rect.width >= MIN_SIZE && rect.height >= MIN_SIZE) {
        apply({
          type: 'area/create',
          payload: { rect, partitions: 1, direction: 'vertical' },
        });
      }
      setDraftNew(null);
    }
    if (interaction.kind === 'resizing-boundary') {
      apply({
        type: 'plan/resize-boundary',
        payload: { width: draftBoundary?.width ?? interaction.origin.width, height: draftBoundary?.height ?? interaction.origin.height },
      });
      setDraftBoundary(null);
    }
    setInteraction(null);
  };

  useEffect(() => {
    const move = (e: PointerEvent) => onPointerMove(e);
    const up = (e: PointerEvent) => {
      cancelLongPress();
      if (interaction?.kind === 'drawing-polygon') return;
      finishInteraction(e);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  });

  useEffect(() => {
    const node = svgRef.current;
    if (!node) return;
    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handleCanvasPointerDown: React.PointerEventHandler<SVGSVGElement> = (evt) => {
    const world = toWorld(evt);
    if (!world) return;
    setContextMenu({ visible: false, x: 0, y: 0, targetId: undefined });
    const shouldPan = activeTool === 'pan' || spacePressed || evt.button === 1;
    if (shouldPan) {
      startPan(evt);
      return;
    }
    if (activeTool === 'draw-polygon') {
      addPolygonPoint(evt);
      return;
    }
    if (activeTool === 'draw-rect') {
      startDrawing(evt);
      return;
    }
    setSelection({ areaIds: [] });
  };

  const boundaryWidth = draftBoundary?.width ?? plan.canvas.width;
  const boundaryHeight = draftBoundary?.height ?? plan.canvas.height;
  const unitsLabel = plan.units;

  const displayAreas = plan.areas.map((area) => {
    const draft = draftShapes[area.id];
    return { area, draft };
  });

  const boundaryHandles: { handle: BoundaryHandle; x: number; y: number; cursor: string }[] = [
    { handle: 'left', x: 0, y: boundaryHeight / 2, cursor: 'ew-resize' },
    { handle: 'right', x: boundaryWidth, y: boundaryHeight / 2, cursor: 'ew-resize' },
    { handle: 'top', x: boundaryWidth / 2, y: 0, cursor: 'ns-resize' },
    { handle: 'bottom', x: boundaryWidth / 2, y: boundaryHeight, cursor: 'ns-resize' },
  ];

  return (
    <>
      <div
        ref={containerRef}
        className="relative h-full w-full"
      >
        <svg
          ref={svgRef}
          className="h-full w-full touch-none"
          onPointerDown={handleCanvasPointerDown}
          onDoubleClick={() => {
            if (interaction?.kind === 'drawing-polygon') completePolygon();
          }}
        >
          <g transform={`translate(${paddingPx + plan.canvas.pan.x}, ${paddingPx + plan.canvas.pan.y}) scale(${scale})`}>
          <defs>
            <pattern id="grid" width={1} height={1} patternUnits="userSpaceOnUse">
              <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#e2e8f0" strokeWidth="0.02" />
            </pattern>
            <pattern
              id="hatch"
              width={0.5}
              height={0.5}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="0.5" stroke="rgba(15,23,42,0.35)" strokeWidth="0.04" />
            </pattern>
          </defs>
          <rect
            x={-paddingPx / scale}
            y={-paddingPx / scale}
            width={(size.width / scale) + (paddingPx * 2) / scale}
            height={(size.height / scale) + (paddingPx * 2) / scale}
            fill="#f8fafc"
          />
          <rect
            x={0}
            y={0}
            width={boundaryWidth}
            height={boundaryHeight}
            fill="url(#grid)"
            stroke="#cbd5e1"
            strokeWidth={0.05}
            rx={0.1}
          />
          {availablePolygons.map((poly, idx) => {
            const center = polygonCentroid(poly);
            return (
              <g key={`avail-${idx}`} pointerEvents="none">
                <polygon points={poly.map((p) => `${p.x},${p.y}`).join(' ')} fill="url(#hatch)" opacity={0.12} />
                <text
                  x={center.x}
                  y={center.y}
                  fontSize={0.35}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="rgba(15,23,42,0.45)"
                  style={{ userSelect: 'none' }}
                >
                  Available
                </text>
              </g>
            );
          })}
          <text
            x={boundaryWidth / 2}
            y={-0.4}
            textAnchor="middle"
            fontSize={0.4}
            fill="#0f172a"
            style={{ userSelect: 'none' }}
          >
            {boundaryWidth.toFixed(2)} {unitsLabel}
          </text>
          <text
            x={boundaryWidth + 0.2}
            y={boundaryHeight / 2}
            textAnchor="start"
            dominantBaseline="middle"
            fontSize={0.4}
            fill="#0f172a"
            style={{ userSelect: 'none' }}
          >
            {boundaryHeight.toFixed(2)} {unitsLabel}
          </text>
          {boundaryHandles.map((h) => (
            <rect
              key={h.handle}
              x={h.x - 0.18}
              y={h.y - 0.18}
              width={0.36}
              height={0.36}
              rx={0.04}
              fill="#0ea5e9"
              opacity={0.8}
              style={{ cursor: h.cursor }}
              onPointerDown={(evt) => {
                evt.stopPropagation();
                startResizeBoundary(h.handle, evt);
              }}
            />
          ))}
          {displayAreas.map(({ area, draft }) => (
            <AreaRenderer
              key={area.id}
              area={area}
              plan={plan}
              draftShape={draft ?? (selection.areaIds.includes(area.id) ? draftShapes[area.id] : undefined)}
              selected={selection.areaIds.includes(area.id)}
              onSelect={(id) => setSelection({ areaIds: [id] })}
              onPointerDown={(e, a) => onAreaPointerDown(e, a)}
              onHandlePointerDown={(handle, e) => onHandlePointerDown(handle, e, area)}
              onPolygonPointPointerDown={(idx, e) => {
                e.stopPropagation();
                startPolygonVertexDrag(area.id, idx, e);
              }}
              onMultiPolygonPointPointerDown={(polyIdx, pointIdx, e) => {
                e.stopPropagation();
                startMultipolygonVertexDrag(area.id, polyIdx, pointIdx, e);
              }}
            />
          ))}

          {draftNew && (
            <g pointerEvents="none">
              <rect
                x={draftNew.x}
                y={draftNew.y}
                width={draftNew.width}
                height={draftNew.height}
                fill="rgba(59,130,246,0.15)"
                stroke="#2563eb"
                strokeDasharray="0.4 0.2"
                strokeWidth={0.06}
              />
            </g>
          )}
          {interaction?.kind === 'drawing-polygon' && (
            <g pointerEvents="none">
              <polyline
                points={[
                  ...interaction.points,
                  ...(interaction.hover ? [interaction.hover] : []),
                ]
                  .map((p) => `${p.x},${p.y}`)
                  .join(' ')}
                fill="rgba(59,130,246,0.12)"
                stroke="#2563eb"
                strokeWidth={0.08}
              />
              {interaction.points.map((p, idx) => (
                <circle key={`${p.x}-${p.y}-${idx}`} cx={p.x} cy={p.y} r={0.12} fill="#2563eb" />
              ))}
            </g>
          )}
        </g>
      </svg>
      </div>
    {contextMenu.visible && contextMenu.targetId && (
      <div
        className="fixed z-50 w-44 rounded-lg bg-white shadow-lg ring-1 ring-slate-200"
        style={{ top: contextMenu.y, left: contextMenu.x }}
        onPointerDown={(e) => e.stopPropagation()}
        >
        <button
          className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
          onClick={() => {
            const target = plan.areas.find((a) => a.id === contextMenu.targetId);
            if (target) {
              openPrompt('Rename area', target.name, (val) => apply({ type: 'area/rename', payload: { id: target.id, name: val || target.name } }));
            }
            setContextMenu({ visible: false, x: 0, y: 0, targetId: undefined });
          }}
        >
          Rename
        </button>
        <div className="relative group">
          <button className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100">Divide into...</button>
          <div className="invisible absolute left-full top-0 ml-1 w-40 rounded-lg bg-white shadow-lg ring-1 ring-slate-200 group-hover:visible">
            <button
              className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
              onClick={() => {
                if (!contextMenu.targetId) return;
                openPrompt('Divide into partitions (number)', '2', (val) => {
                  const partitions = parseInt(val, 10);
                  if (Number.isFinite(partitions) && partitions > 1 && contextMenu.targetId) {
                    apply({ type: 'area/divide', payload: { id: contextMenu.targetId, partitions, direction: 'vertical' } });
                  }
                });
                setContextMenu({ visible: false, x: 0, y: 0, targetId: undefined });
              }}
            >
              Vertical
            </button>
            <button
              className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
              onClick={() => {
                if (!contextMenu.targetId) return;
                openPrompt('Divide into partitions (number)', '2', (val) => {
                  const partitions = parseInt(val, 10);
                  if (Number.isFinite(partitions) && partitions > 1 && contextMenu.targetId) {
                    apply({ type: 'area/divide', payload: { id: contextMenu.targetId, partitions, direction: 'horizontal' } });
                  }
                });
                setContextMenu({ visible: false, x: 0, y: 0, targetId: undefined });
              }}
            >
              Horizontal
            </button>
          </div>
        </div>
        <button
          className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
          onClick={() => {
            if (!contextMenu.targetId) return;
            const target = plan.areas.find((a) => a.id === contextMenu.targetId);
            if (!target) return;
            const cloneName = `${target.name} copy`;
            if (target.shape.type === 'polygon') {
              apply({
                type: 'area/create-polygon',
                payload: { points: target.shape.points, fill: target.fill, stroke: target.stroke, name: cloneName },
              });
            } else if (target.shape.type === 'multipolygon') {
              target.shape.polygons.forEach((poly, idx) => {
                apply({
                  type: 'area/create-polygon',
                  payload: { points: poly, fill: target.fill, stroke: target.stroke, name: idx === 0 ? cloneName : `${cloneName}-${idx + 1}` },
                });
              });
            } else {
              const pts = [
                { x: target.shape.x, y: target.shape.y },
                { x: target.shape.x + target.shape.width, y: target.shape.y },
                { x: target.shape.x + target.shape.width, y: target.shape.y + target.shape.height },
                { x: target.shape.x, y: target.shape.y + target.shape.height },
              ];
              apply({ type: 'area/create-polygon', payload: { points: pts, fill: target.fill, stroke: target.stroke, name: cloneName } });
            }
            setContextMenu({ visible: false, x: 0, y: 0, targetId: undefined });
          }}
        >
          Duplicate
        </button>
        <button
          className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
          onClick={() => {
            const ids = selection.areaIds.length > 1 ? selection.areaIds : contextMenu.targetId ? [contextMenu.targetId] : [];
            if (ids.length < 2) {
              openPrompt('Select at least two areas to merge', '', () => {});
              return;
            }
            apply({ type: 'area/merge', payload: { ids } });
            setContextMenu({ visible: false, x: 0, y: 0, targetId: undefined });
          }}
        >
          Merge selection
        </button>
        <button
          className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
          onClick={() => {
            const ids = selection.areaIds.length ? selection.areaIds : contextMenu.targetId ? [contextMenu.targetId] : [];
            if (!ids.length) return;
            openPrompt('Group name', `Group ${Date.now() % 1000}`, (val: string) =>
              apply({ type: 'group/create', payload: { name: val || 'Group', areaIds: ids } }),
            );
            setContextMenu({ visible: false, x: 0, y: 0, targetId: undefined });
          }}
        >
          Group selection
        </button>
        <button
          className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
          onClick={() => {
            const ids = selection.areaIds.length ? selection.areaIds : contextMenu.targetId ? [contextMenu.targetId] : [];
            if (ids.length < 1) return;
            apply({ type: 'area/convert-to-polygon', payload: { ids } });
            setContextMenu({ visible: false, x: 0, y: 0, targetId: undefined });
          }}
        >
          Convert to polygon
        </button>
        <button
          className="block w-full px-3 py-2 text-left text-sm hover:bg-red-50 hover:text-red-600"
          onClick={() => {
            if (!contextMenu.targetId) return;
            apply({ type: 'area/delete', payload: { id: contextMenu.targetId } });
            setContextMenu({ visible: false, x: 0, y: 0, targetId: undefined });
          }}
        >
          Delete
        </button>
      </div>
      )}
    </>
  );
}
