import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyRectResize,
  MIN_SIZE,
  moveRect,
  rectFromPoints,
  snapValue,
  snapRect,
  translatePolygon,
  clampDeltaForPolygon,
  clampDeltaForMultiPolygon,
  clamp,
  polygonArea,
  ellipseToRect,
  rectToEllipse,
} from '../domain/geometry';
import type { Area, BoundaryHandle, EllipseShape, PolygonShape, RectHandle, RectShape, MultiPolygonShape } from '../domain/types';
import { usePlanStore } from '../store/usePlanStore';
import { usePromptStore } from '../store/usePromptStore';
import AreaRenderer from './AreaRenderer';
import polygonClipping from 'polygon-clipping';

type Interaction =
  | { kind: 'panning'; start: { x: number; y: number }; panStart: { x: number; y: number } }
  | { kind: 'dragging-area'; areaId: string; origin: RectShape; start: { x: number; y: number } }
  | { kind: 'dragging-ellipse'; areaId: string; origin: EllipseShape; start: { x: number; y: number } }
  | { kind: 'dragging-polygon'; areaId: string; points: { x: number; y: number }[]; start: { x: number; y: number } }
  | { kind: 'dragging-multipolygon'; areaId: string; polygons: { x: number; y: number }[][]; holes?: { x: number; y: number }[][][]; start: { x: number; y: number } }
  | { kind: 'dragging-label'; areaId: string; start: { x: number; y: number }; origin: { x: number; y: number } }
  | { kind: 'dragging-edge-label'; areaId: string; edgeKey: string; start: { x: number; y: number }; origin: { x: number; y: number } }
  | { kind: 'dragging-radius-label'; areaId: string; start: { x: number; y: number }; origin: { x: number; y: number } }
  | { kind: 'dragging-polygon-edge'; areaId: string; index: number; start: { x: number; y: number }; points: { x: number; y: number }[]; normal: { x: number; y: number } }
  | { kind: 'dragging-multipolygon-edge'; areaId: string; polyIndex: number; edgeIndex: number; start: { x: number; y: number }; polygons: { x: number; y: number }[][]; holes?: { x: number; y: number }[][][]; normal: { x: number; y: number } }
  | { kind: 'polygon-point'; areaId: string; index: number; start: { x: number; y: number }; points: { x: number; y: number }[]; holes?: { x: number; y: number }[][] }
  | {
      kind: 'multipolygon-point';
      areaId: string;
      polyIndex: number;
      pointIndex: number;
      start: { x: number; y: number };
      polygons: { x: number; y: number }[][];
      holes?: { x: number; y: number }[][][];
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
  | {
      kind: 'resizing-ellipse';
      areaId: string;
      handle: RectHandle;
      origin: EllipseShape;
      start: { x: number; y: number };
    }
  | { kind: 'resizing-boundary'; handle: BoundaryHandle; start: { x: number; y: number }; origin: { width: number; height: number } }
  | { kind: 'drawing'; start: { x: number; y: number }; current: { x: number; y: number } }
  | { kind: 'drawing-ellipse'; start: { x: number; y: number }; current: { x: number; y: number } }
  | { kind: 'drawing-circle'; start: { x: number; y: number }; current: { x: number; y: number } }
  | { kind: 'drawing-semi-circle'; start: { x: number; y: number }; current: { x: number; y: number } }
  | { kind: 'drawing-quadrant'; start: { x: number; y: number }; current: { x: number; y: number } }
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

const shapeToPolygons = (shape: RectShape | PolygonShape | MultiPolygonShape | EllipseShape): PolygonRings[] => {
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
  if (shape.type === 'ellipse') {
    const segments = 48;
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      points.push({ x: shape.cx + Math.cos(angle) * shape.rx, y: shape.cy + Math.sin(angle) * shape.ry });
    }
    return [[closeRing(points)]];
  }
  if (shape.type === 'polygon') {
    return [[closeRing(shape.points), ...(shape.holes ?? []).map(closeRing)]];
  }
  return shape.polygons.map((poly, idx) => [closeRing(poly), ...(shape.holes?.[idx] ?? []).map(closeRing)]);
};

const ringToPoints = (ring: Ring) => {
  const trimmed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring;
  return trimmed.map(([x, y]) => ({ x, y }));
};

const polygonRingsArea = (polys: PolygonRings[]) => {
  return polys.reduce((sum, poly) => {
    if (!poly.length) return sum;
    const outer = polygonArea(ringToPoints(poly[0]));
    const holes = poly.slice(1).reduce((acc, ring) => acc + polygonArea(ringToPoints(ring)), 0);
    return sum + Math.max(0, outer - holes);
  }, 0);
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
  const showDimensions = usePlanStore((s) => s.showDimensions);
  const showGrid = usePlanStore((s) => s.showGrid);
  const apply = usePlanStore((s) => s.apply);
  const undo = usePlanStore((s) => s.undo);
  const history = usePlanStore((s) => s.history);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [draftShapes, setDraftShapes] = useState<Record<string, RectShape | PolygonShape | MultiPolygonShape | EllipseShape>>({});
  const [draftLabelOffsets, setDraftLabelOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [draftEdgeLabelOffsets, setDraftEdgeLabelOffsets] = useState<Record<string, Record<string, { x: number; y: number }>>>({});
  const [draftRadiusLabelOffsets, setDraftRadiusLabelOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [hoverSplit, setHoverSplit] = useState<{
    areaId: string;
    edgeKey: string;
    a: { x: number; y: number };
    b: { x: number; y: number };
    point: { x: number; y: number };
  } | null>(null);
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
  const prompt = usePromptStore((s) => s.prompt);
  const longPressTimer = useRef<number | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggered = useRef(false);
  const canUnmerge = history.undo.at(-1)?.type === 'area/merge';

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

  const edgeNormal = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len <= 0) return { x: 0, y: 0 };
    return { x: -dy / len, y: dx / len };
  };

  const constrainOrthogonal = (point: { x: number; y: number }, anchor: { x: number; y: number }) => {
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return { x: point.x, y: anchor.y };
    }
    return { x: anchor.x, y: point.y };
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
      if (prompt.open) return;
      const target = e.target as HTMLElement | null;
      const isTyping =
        !target ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        target.isContentEditable;
      if (isTyping) return;
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
  }, [apply, selection.areaIds, completePolygon, interaction, scale, prompt.open]);

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
    if (event.button === 2 && !event.ctrlKey) {
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
    if (activeTool === 'select' && event.ctrlKey) {
      const world = toWorld(event);
      if (area.shape.type === 'polygon') {
        insertPolygonPoint(area as Area & { shape: PolygonShape }, world);
        return;
      }
      if (area.shape.type === 'rect') {
        if (insertRectPoint(area as Area & { shape: RectShape }, world)) {
          return;
        }
      }
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
    } else if (area.shape.type === 'ellipse') {
      setInteraction({
        kind: 'dragging-ellipse',
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
        holes: area.shape.holes,
        start: world,
      });
    }
  };

  const onLabelPointerDown = (event: React.PointerEvent, area: Area) => {
    if (event.button === 2 && !event.ctrlKey) return;
    if (activeTool !== 'select') return;
    const world = toWorld(event);
    if (!world) return;
    setSelection({ areaIds: [area.id] });
    const origin = draftLabelOffsets[area.id] ?? area.labelOffset ?? { x: 0, y: 0 };
    setInteraction({ kind: 'dragging-label', areaId: area.id, start: world, origin });
  };

  const onEdgeLabelPointerDown = (event: React.PointerEvent, area: Area, edgeKey: string) => {
    if (event.button === 2 && !event.ctrlKey) return;
    if (activeTool !== 'select') return;
    const world = toWorld(event);
    if (!world) return;
    setSelection({ areaIds: [area.id] });
    const origin =
      draftEdgeLabelOffsets[area.id]?.[edgeKey] ??
      area.edgeLabelOffsets?.[edgeKey] ??
      { x: 0, y: 0 };
    setInteraction({ kind: 'dragging-edge-label', areaId: area.id, edgeKey, start: world, origin });
  };

  const onRadiusLabelPointerDown = (event: React.PointerEvent, area: Area) => {
    if (event.button === 2 && !event.ctrlKey) return;
    if (activeTool !== 'select') return;
    const world = toWorld(event);
    if (!world) return;
    setSelection({ areaIds: [area.id] });
    const origin = draftRadiusLabelOffsets[area.id] ?? area.radiusLabelOffset ?? { x: 0, y: 0 };
    setInteraction({ kind: 'dragging-radius-label', areaId: area.id, start: world, origin });
  };

  const onHandlePointerDown = (handle: RectHandle, event: React.PointerEvent, area: Area) => {
    if (area.shape.type !== 'rect' && area.shape.type !== 'ellipse') return;
    const world = toWorld(event);
    if (area.shape.type === 'rect') {
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
      return;
    }
    setSelection({ areaIds: [area.id] });
    setInteraction({
      kind: 'resizing-ellipse',
      areaId: area.id,
      handle,
      origin: area.shape,
      start: world,
    });
  };

  const startDrawing = (evt: React.PointerEvent) => {
    const world = toWorld(evt);
    setInteraction({ kind: 'drawing', start: world, current: world });
    setDraftNew({ type: 'rect', x: world.x, y: world.y, width: MIN_SIZE, height: MIN_SIZE });
  };

  const startDrawingEllipse = (evt: React.PointerEvent) => {
    const world = toWorld(evt);
    setInteraction({ kind: 'drawing-ellipse', start: world, current: world });
    setDraftNew({ type: 'rect', x: world.x, y: world.y, width: MIN_SIZE, height: MIN_SIZE });
  };

  const startDrawingCircle = (evt: React.PointerEvent) => {
    const world = toWorld(evt);
    setInteraction({ kind: 'drawing-circle', start: world, current: world });
    setDraftNew({ type: 'rect', x: world.x, y: world.y, width: MIN_SIZE, height: MIN_SIZE });
  };

  const startDrawingSemiCircle = (evt: React.PointerEvent) => {
    const world = toWorld(evt);
    setInteraction({ kind: 'drawing-semi-circle', start: world, current: world });
    setDraftNew({ type: 'rect', x: world.x, y: world.y, width: MIN_SIZE, height: MIN_SIZE });
  };

  const startDrawingQuadrant = (evt: React.PointerEvent) => {
    const world = toWorld(evt);
    setInteraction({ kind: 'drawing-quadrant', start: world, current: world });
    setDraftNew({ type: 'rect', x: world.x, y: world.y, width: MIN_SIZE, height: MIN_SIZE });
  };

  const handleEdgeHover = (
    event: React.PointerEvent,
    area: Area,
    edgeKey: string,
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => {
    if (!showDimensions) return;
    const world = toWorld(event);
    const projected = projectPointToSegment(world, a, b);
    setHoverSplit({ areaId: area.id, edgeKey, a, b, point: projected });
  };

  const handleEdgeHoverEnd = () => {
    setHoverSplit(null);
  };

  const squareRectFromPoints = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    const x = start.x + (dx < 0 ? -size : 0);
    const y = start.y + (dy < 0 ? -size : 0);
    return { type: 'rect' as const, x, y, width: size, height: size };
  };

  const arcPoints = (cx: number, cy: number, r: number, startAngle: number, endAngle: number, steps: number) => {
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = steps === 0 ? 0 : i / steps;
      const angle = startAngle + (endAngle - startAngle) * t;
      points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
    }
    return points;
  };

  const semiCirclePoints = (rect: RectShape, start: { x: number; y: number }, end: { x: number; y: number }) => {
    const r = rect.width / 2;
    const cx = rect.x + r;
    const cy = rect.y + r;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const useHorizontal = Math.abs(dx) >= Math.abs(dy);
    let startAngle = 0;
    let endAngle = Math.PI;
    if (useHorizontal) {
      if (dx >= 0) {
        startAngle = -Math.PI / 2;
        endAngle = Math.PI / 2;
      } else {
        startAngle = Math.PI / 2;
        endAngle = (3 * Math.PI) / 2;
      }
    } else {
      if (dy >= 0) {
        startAngle = 0;
        endAngle = Math.PI;
      } else {
        startAngle = Math.PI;
        endAngle = 0;
      }
    }
    return arcPoints(cx, cy, r, startAngle, endAngle, 24);
  };

  const quadrantPoints = (rect: RectShape, start: { x: number; y: number }, end: { x: number; y: number }) => {
    const r = rect.width / 2;
    const cx = rect.x + r;
    const cy = rect.y + r;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    let startAngle = 0;
    let endAngle = Math.PI / 2;
    if (dx < 0 && dy >= 0) {
      startAngle = Math.PI / 2;
      endAngle = Math.PI;
    } else if (dx < 0 && dy < 0) {
      startAngle = Math.PI;
      endAngle = (3 * Math.PI) / 2;
    } else if (dx >= 0 && dy < 0) {
      startAngle = (3 * Math.PI) / 2;
      endAngle = 2 * Math.PI;
    }
    const arc = arcPoints(cx, cy, r, startAngle, endAngle, 16);
    return [{ x: cx, y: cy }, ...arc];
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

  const insertRectPoint = (area: Area & { shape: RectShape }, world: { x: number; y: number }) => {
    const { x, y, width, height } = area.shape;
    const points = [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ];
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
    if (bestDist > 0.2) return false;
    const nearVertex = points.some((p) => distance(p, bestPoint) < 0.01);
    if (nearVertex) return false;
    const nextPoints = [...points.slice(0, bestIdx), bestPoint, ...points.slice(bestIdx)];
    apply({ type: 'area/set-polygon', payload: { id: area.id, points: nextPoints } });
    return true;
  };

  const removePolygonPoint = (areaId: string, index: number) => {
    const area = plan.areas.find((a) => a.id === areaId);
    if (!area || area.shape.type !== 'polygon') return;
    if (area.shape.points.length <= 3) return;
    const points = area.shape.points.filter((_, idx) => idx !== index);
    if (points.length < 3) return;
    apply({ type: 'area/set-polygon', payload: { id: areaId, points } });
  };

  const removeMultiPolygonPoint = (areaId: string, polyIndex: number, pointIndex: number) => {
    const area = plan.areas.find((a) => a.id === areaId);
    if (!area || area.shape.type !== 'multipolygon') return;
    const polygons = area.shape.polygons.map((poly, idx) =>
      idx === polyIndex ? poly.filter((_, pIdx) => pIdx !== pointIndex) : poly,
    );
    if (!polygons[polyIndex] || polygons[polyIndex].length < 3) return;
    apply({ type: 'area/set-multipolygon', payload: { id: areaId, polygons } });
  };

  const addPolygonPoint = (evt: React.PointerEvent) => {
    const world = toWorld(evt);
    if (interaction?.kind === 'drawing-polygon') {
      const last = interaction.points[interaction.points.length - 1];
      const point = evt.shiftKey && last ? constrainOrthogonal(world, last) : world;
      setInteraction({ kind: 'drawing-polygon', points: [...interaction.points, point] });
    } else {
      setInteraction({ kind: 'drawing-polygon', points: [world] });
    }
  };

  const startPolygonVertexDrag = (areaId: string, index: number, evt: React.PointerEvent) => {
    if (evt.altKey) {
      evt.stopPropagation();
      removePolygonPoint(areaId, index);
      return;
    }
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
      holes: area.shape.holes,
    });
  };

  const startMultipolygonVertexDrag = (areaId: string, polyIndex: number, pointIndex: number, evt: React.PointerEvent) => {
    if (evt.altKey) {
      evt.stopPropagation();
      removeMultiPolygonPoint(areaId, polyIndex, pointIndex);
      return;
    }
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
      holes: area.shape.holes,
    });
  };

  const handlePolygonEdgePointerDown = (areaId: string, index: number, evt: React.PointerEvent) => {
    const area = plan.areas.find((a) => a.id === areaId);
    if (!area || area.shape.type !== 'polygon') return;
    if (area.shape.points.length <= 3) return;
    evt.stopPropagation();
    if (evt.shiftKey) {
      const world = toWorld(evt);
      if (!world) return;
      const points = area.shape.points;
      const a = points[index];
      const b = points[(index + 1) % points.length];
      setInteraction({
        kind: 'dragging-polygon-edge',
        areaId,
        index,
        start: world,
        points,
        normal: edgeNormal(a, b),
      });
      return;
    }
    if (!evt.altKey) return;
    const removeIndex = (index + 1) % area.shape.points.length;
    removePolygonPoint(areaId, removeIndex);
  };

  const handleMultiPolygonEdgePointerDown = (areaId: string, polyIndex: number, index: number, evt: React.PointerEvent) => {
    const area = plan.areas.find((a) => a.id === areaId);
    if (!area || area.shape.type !== 'multipolygon') return;
    const poly = area.shape.polygons[polyIndex];
    if (!poly || poly.length <= 3) return;
    evt.stopPropagation();
    if (evt.shiftKey) {
      const world = toWorld(evt);
      if (!world) return;
      const a = poly[index];
      const b = poly[(index + 1) % poly.length];
      setInteraction({
        kind: 'dragging-multipolygon-edge',
        areaId,
        polyIndex,
        edgeIndex: index,
        start: world,
        polygons: area.shape.polygons,
        holes: area.shape.holes,
        normal: edgeNormal(a, b),
      });
      return;
    }
    if (!evt.altKey) return;
    const removeIndex = (index + 1) % poly.length;
    removeMultiPolygonPoint(areaId, polyIndex, removeIndex);
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
    if (interaction.kind === 'dragging-ellipse') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      const area = plan.areas.find((a) => a.id === interaction.areaId);
      if (area && area.shape.type === 'ellipse') {
        const movedRect = moveRect(ellipseToRect(area.shape), { dx, dy }, plan.canvas);
        setDraftShapes({ [interaction.areaId]: rectToEllipse(movedRect) });
      }
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
        const clamped = clampDeltaForMultiPolygon(interaction.polygons, plan.canvas, { dx: snapDx, dy: snapDy }, interaction.holes);
        const translated = interaction.polygons.map((poly) => translatePolygon(poly, clamped));
        const translatedHoles = interaction.holes?.map((holeList) => holeList.map((hole) => translatePolygon(hole, clamped)));
        setDraftShapes({ [interaction.areaId]: { ...area.shape, polygons: translated, holes: translatedHoles } });
      }
      return;
    }
    if (interaction.kind === 'dragging-label') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      setDraftLabelOffsets((prev) => ({
        ...prev,
        [interaction.areaId]: { x: interaction.origin.x + dx, y: interaction.origin.y + dy },
      }));
      return;
    }
    if (interaction.kind === 'dragging-edge-label') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      setDraftEdgeLabelOffsets((prev) => ({
        ...prev,
        [interaction.areaId]: {
          ...(prev[interaction.areaId] ?? {}),
          [interaction.edgeKey]: { x: interaction.origin.x + dx, y: interaction.origin.y + dy },
        },
      }));
      return;
    }
    if (interaction.kind === 'dragging-radius-label') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      setDraftRadiusLabelOffsets((prev) => ({
        ...prev,
        [interaction.areaId]: { x: interaction.origin.x + dx, y: interaction.origin.y + dy },
      }));
      return;
    }
    if (interaction.kind === 'dragging-polygon-edge') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      const amount = interaction.normal.x * dx + interaction.normal.y * dy;
      const snapped = snapEnabled ? snapValue(amount, 0.25) : amount;
      const offset = { x: interaction.normal.x * snapped, y: interaction.normal.y * snapped };
      const nextPoints = interaction.points.map((p, idx) => {
        if (idx === interaction.index || idx === (interaction.index + 1) % interaction.points.length) {
          return { x: clamp(p.x + offset.x, 0, plan.canvas.width), y: clamp(p.y + offset.y, 0, plan.canvas.height) };
        }
        return p;
      });
      setDraftShapes({ [interaction.areaId]: { type: 'polygon', points: nextPoints } as PolygonShape });
      return;
    }
    if (interaction.kind === 'dragging-multipolygon-edge') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      const amount = interaction.normal.x * dx + interaction.normal.y * dy;
      const snapped = snapEnabled ? snapValue(amount, 0.25) : amount;
      const offset = { x: interaction.normal.x * snapped, y: interaction.normal.y * snapped };
      const polygons = interaction.polygons.map((poly, pIdx) =>
        poly.map((p, idx) => {
          if (pIdx === interaction.polyIndex && (idx === interaction.edgeIndex || idx === (interaction.edgeIndex + 1) % poly.length)) {
            return { x: clamp(p.x + offset.x, 0, plan.canvas.width), y: clamp(p.y + offset.y, 0, plan.canvas.height) };
          }
          return p;
        }),
      );
      setDraftShapes({ [interaction.areaId]: { type: 'multipolygon', polygons, holes: interaction.holes } as MultiPolygonShape });
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
      setDraftShapes({ [interaction.areaId]: { type: 'polygon', points, holes: interaction.holes } as PolygonShape });
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
      setDraftShapes({ [interaction.areaId]: { type: 'multipolygon', polygons, holes: interaction.holes } as MultiPolygonShape });
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
    if (interaction.kind === 'resizing-ellipse') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      const rect = applyRectResize(ellipseToRect(interaction.origin), interaction.handle, { dx, dy }, plan.canvas);
      const snapped = snapEnabled ? snapRect(rect, 0.25) : rect;
      setDraftShapes({ [interaction.areaId]: rectToEllipse(snapped) });
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
    if (interaction.kind === 'drawing-ellipse') {
      const rect = rectFromPoints(interaction.start, world);
      const snapped = snapEnabled ? snapRect(rect, 0.25) : rect;
      setDraftNew(snapped);
      setInteraction({ ...interaction, current: world });
      return;
    }
    if (interaction.kind === 'drawing-circle' || interaction.kind === 'drawing-semi-circle' || interaction.kind === 'drawing-quadrant') {
      const rect = squareRectFromPoints(interaction.start, world);
      const snapped = snapEnabled ? snapRect(rect, 0.25) : rect;
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
      const last = interaction.points[interaction.points.length - 1];
      const hover = evt.shiftKey && last ? constrainOrthogonal(world, last) : world;
      setInteraction({ ...interaction, hover });
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
    if (interaction.kind === 'dragging-ellipse') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      const area = plan.areas.find((a) => a.id === interaction.areaId);
      if (area && area.shape.type === 'ellipse') {
        const movedRect = moveRect(ellipseToRect(area.shape), { dx, dy }, plan.canvas);
        apply({
          type: 'area/set-ellipse',
          payload: { id: interaction.areaId, ellipse: rectToEllipse(movedRect) },
        });
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
      const clamped = clampDeltaForMultiPolygon(interaction.polygons, plan.canvas, { dx: snapDx, dy: snapDy }, interaction.holes);
      apply({ type: 'area/move-multi', payload: { ids: [interaction.areaId], dx: clamped.dx, dy: clamped.dy } });
      setDraftShapes({});
    }
    if (interaction.kind === 'dragging-label') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      apply({
        type: 'area/set-label-offset',
        payload: { id: interaction.areaId, offset: { x: interaction.origin.x + dx, y: interaction.origin.y + dy } },
      });
      setDraftLabelOffsets((prev) => {
        const next = { ...prev };
        delete next[interaction.areaId];
        return next;
      });
    }
    if (interaction.kind === 'dragging-edge-label') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      apply({
        type: 'area/set-edge-label-offset',
        payload: { id: interaction.areaId, edgeKey: interaction.edgeKey, offset: { x: interaction.origin.x + dx, y: interaction.origin.y + dy } },
      });
      setDraftEdgeLabelOffsets((prev) => {
        const next = { ...prev };
        if (!next[interaction.areaId]) return next;
        const perArea = { ...next[interaction.areaId] };
        delete perArea[interaction.edgeKey];
        if (Object.keys(perArea).length) {
          next[interaction.areaId] = perArea;
        } else {
          delete next[interaction.areaId];
        }
        return next;
      });
    }
    if (interaction.kind === 'dragging-radius-label') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      apply({
        type: 'area/set-radius-label-offset',
        payload: { id: interaction.areaId, offset: { x: interaction.origin.x + dx, y: interaction.origin.y + dy } },
      });
      setDraftRadiusLabelOffsets((prev) => {
        const next = { ...prev };
        delete next[interaction.areaId];
        return next;
      });
    }
    if (interaction.kind === 'dragging-polygon-edge') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      const amount = interaction.normal.x * dx + interaction.normal.y * dy;
      const snapped = snapEnabled ? snapValue(amount, 0.25) : amount;
      const offset = { x: interaction.normal.x * snapped, y: interaction.normal.y * snapped };
      const points = interaction.points.map((p, idx) => {
        if (idx === interaction.index || idx === (interaction.index + 1) % interaction.points.length) {
          return { x: clamp(p.x + offset.x, 0, plan.canvas.width), y: clamp(p.y + offset.y, 0, plan.canvas.height) };
        }
        return p;
      });
      apply({ type: 'area/set-polygon', payload: { id: interaction.areaId, points } });
      setDraftShapes({});
    }
    if (interaction.kind === 'dragging-multipolygon-edge') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      const amount = interaction.normal.x * dx + interaction.normal.y * dy;
      const snapped = snapEnabled ? snapValue(amount, 0.25) : amount;
      const offset = { x: interaction.normal.x * snapped, y: interaction.normal.y * snapped };
      const polygons = interaction.polygons.map((poly, pIdx) =>
        poly.map((p, idx) => {
          if (pIdx === interaction.polyIndex && (idx === interaction.edgeIndex || idx === (interaction.edgeIndex + 1) % poly.length)) {
            return { x: clamp(p.x + offset.x, 0, plan.canvas.width), y: clamp(p.y + offset.y, 0, plan.canvas.height) };
          }
          return p;
        }),
      );
      apply({ type: 'area/set-multipolygon', payload: { id: interaction.areaId, polygons } });
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
    if (interaction.kind === 'resizing-ellipse') {
      const dx = world.x - interaction.start.x;
      const dy = world.y - interaction.start.y;
      const rect = applyRectResize(ellipseToRect(interaction.origin), interaction.handle, { dx, dy }, plan.canvas);
      const snapped = snapEnabled ? snapRect(rect, 0.25) : rect;
      apply({ type: 'area/set-ellipse', payload: { id: interaction.areaId, ellipse: rectToEllipse(snapped) } });
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
      if (rect.width >= MIN_SIZE && rect.height >= MIN_SIZE) {
        apply({
          type: 'area/create',
          payload: { rect, partitions: 1, direction: 'vertical' },
        });
      }
      setDraftNew(null);
    }
    if (interaction.kind === 'drawing-ellipse') {
      const rectRaw = rectFromPoints(interaction.start, world);
      const rect = snapEnabled ? snapRect(rectRaw, 0.25) : rectRaw;
      if (rect.width >= MIN_SIZE && rect.height >= MIN_SIZE) {
        const rx = rect.width / 2;
        const ry = rect.height / 2;
        apply({
          type: 'area/create-ellipse',
          payload: { cx: rect.x + rx, cy: rect.y + ry, rx, ry },
        });
      }
      setDraftNew(null);
    }
    if (interaction.kind === 'drawing-circle') {
      const rectRaw = squareRectFromPoints(interaction.start, world);
      const rect = snapEnabled ? snapRect(rectRaw, 0.25) : rectRaw;
      if (rect.width >= MIN_SIZE && rect.height >= MIN_SIZE) {
        const r = rect.width / 2;
        apply({
          type: 'area/create-ellipse',
          payload: { cx: rect.x + r, cy: rect.y + r, rx: r, ry: r },
        });
      }
      setDraftNew(null);
    }
    if (interaction.kind === 'drawing-semi-circle') {
      const rectRaw = squareRectFromPoints(interaction.start, world);
      const rect = snapEnabled ? snapRect(rectRaw, 0.25) : rectRaw;
      if (rect.width >= MIN_SIZE && rect.height >= MIN_SIZE) {
        const points = semiCirclePoints(rect, interaction.start, world);
        apply({ type: 'area/create-polygon', payload: { points } });
      }
      setDraftNew(null);
    }
    if (interaction.kind === 'drawing-quadrant') {
      const rectRaw = squareRectFromPoints(interaction.start, world);
      const rect = snapEnabled ? snapRect(rectRaw, 0.25) : rectRaw;
      if (rect.width >= MIN_SIZE && rect.height >= MIN_SIZE) {
        const points = quadrantPoints(rect, interaction.start, world);
        apply({ type: 'area/create-polygon', payload: { points } });
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
    if (activeTool === 'draw-ellipse') {
      startDrawingEllipse(evt);
      return;
    }
    if (activeTool === 'draw-circle') {
      startDrawingCircle(evt);
      return;
    }
    if (activeTool === 'draw-semi-circle') {
      startDrawingSemiCircle(evt);
      return;
    }
    if (activeTool === 'draw-quadrant') {
      startDrawingQuadrant(evt);
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

  const overlapMeasurements = useMemo(() => {
    const drafts: Record<string, RectShape | PolygonShape | MultiPolygonShape | EllipseShape> = { ...draftShapes };
    if (draftNew) drafts.__new__ = draftNew;
    const draftIds = new Set(Object.keys(drafts));
    if (!draftIds.size) return [];
    const measurements: { id: string; x: number; y: number; width: number; height: number; area: number }[] = [];
    Object.entries(drafts).forEach(([draftId, draftShape]) => {
      const draftPolys = shapeToPolygons(draftShape);
      plan.areas.forEach((area) => {
        if (draftIds.has(area.id)) return;
        const otherPolys = shapeToPolygons(area.shape);
        const intersection = polygonClipping.intersection(draftPolys, otherPolys) as PolygonRings[] | null;
        if (!intersection || !intersection.length) return;
        const overlapArea = polygonRingsArea(intersection);
        if (overlapArea <= 0) return;
        const points = intersection.flatMap((poly) => poly.flatMap((ring) => ringToPoints(ring)));
        if (!points.length) return;
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const width = Math.max(0, maxX - minX);
        const height = Math.max(0, maxY - minY);
        if (width <= 0 || height <= 0) return;
        measurements.push({
          id: `${draftId}-${area.id}`,
          x: (minX + maxX) / 2,
          y: (minY + maxY) / 2,
          width,
          height,
          area: overlapArea,
        });
      });
    });
    return measurements;
  }, [draftNew, draftShapes, plan.areas]);

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
          onPointerLeave={handleEdgeHoverEnd}
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
            fill={showGrid ? 'url(#grid)' : '#ffffff'}
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
          {showDimensions && (
            <>
              <text
                x={boundaryWidth / 2}
                y={-0.34}
                textAnchor="middle"
                fontSize={0.32}
                fill="#0f172a"
                style={{ userSelect: 'none' }}
              >
                {boundaryWidth.toFixed(2)} {unitsLabel}
              </text>
              <text
                x={boundaryWidth + 0.16}
                y={boundaryHeight / 2}
                textAnchor="start"
                dominantBaseline="middle"
                fontSize={0.32}
                fill="#0f172a"
                style={{ userSelect: 'none' }}
              >
                {boundaryHeight.toFixed(2)} {unitsLabel}
              </text>
            </>
          )}
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
              labelOffset={draftLabelOffsets[area.id] ?? area.labelOffset}
              edgeLabelOffsets={{
                ...(area.edgeLabelOffsets ?? {}),
                ...(draftEdgeLabelOffsets[area.id] ?? {}),
              }}
              radiusLabelOffset={draftRadiusLabelOffsets[area.id] ?? area.radiusLabelOffset}
              draftShape={draft ?? (selection.areaIds.includes(area.id) ? draftShapes[area.id] : undefined)}
              selected={selection.areaIds.includes(area.id)}
              onSelect={(id) => setSelection({ areaIds: [id] })}
              onPointerDown={(e, a) => onAreaPointerDown(e, a)}
              onHandlePointerDown={(handle, e) => onHandlePointerDown(handle, e, area)}
              onLabelPointerDown={(e, a) => onLabelPointerDown(e, a)}
              onEdgeLabelPointerDown={(e, a, edgeKey) => onEdgeLabelPointerDown(e, a, edgeKey)}
              onRadiusLabelPointerDown={(e, a) => onRadiusLabelPointerDown(e, a)}
              showDimensions={showDimensions}
              onEdgeHover={handleEdgeHover}
              onEdgeHoverEnd={handleEdgeHoverEnd}
              onPolygonPointPointerDown={(idx, e) => {
                e.stopPropagation();
                startPolygonVertexDrag(area.id, idx, e);
              }}
              onPolygonEdgePointerDown={(idx, e) => handlePolygonEdgePointerDown(area.id, idx, e)}
              onMultiPolygonPointPointerDown={(polyIdx, pointIdx, e) => {
                e.stopPropagation();
                startMultipolygonVertexDrag(area.id, polyIdx, pointIdx, e);
              }}
              onMultiPolygonEdgePointerDown={(polyIdx, idx, e) => handleMultiPolygonEdgePointerDown(area.id, polyIdx, idx, e)}
            />
          ))}
          {showDimensions && hoverSplit && (() => {
            const { a, b, point } = hoverSplit;
            const lenA = distance(a, point);
            const lenB = distance(point, b);
            if (lenA <= 0 || lenB <= 0) return null;
            const edgeDx = b.x - a.x;
            const edgeDy = b.y - a.y;
            const edgeLen = Math.hypot(edgeDx, edgeDy);
            if (!Number.isFinite(edgeLen) || edgeLen <= 0) return null;
            const nx = -edgeDy / edgeLen;
            const ny = edgeDx / edgeLen;
            const offset = 0.2;
            const fontSize = 0.14;
            const paddingX = 0.05;
            const paddingY = 0.03;
            const labelA = `${lenA.toFixed(2)} ${unitsLabel}`;
            const labelB = `${lenB.toFixed(2)} ${unitsLabel}`;
            const widthA = labelA.length * fontSize * 0.6 + paddingX * 2;
            const widthB = labelB.length * fontSize * 0.6 + paddingX * 2;
            const height = fontSize + paddingY * 2;
            const midA = { x: (a.x + point.x) / 2 + nx * offset, y: (a.y + point.y) / 2 + ny * offset };
            const midB = { x: (b.x + point.x) / 2 + nx * offset, y: (b.y + point.y) / 2 + ny * offset };
            return (
              <g pointerEvents="none">
                <rect
                  x={midA.x - widthA / 2}
                  y={midA.y - height / 2}
                  width={widthA}
                  height={height}
                  rx={0.05}
                  fill="rgba(255,255,255,0.85)"
                  stroke="rgba(15,23,42,0.25)"
                  strokeWidth={0.02}
                />
                <text
                  x={midA.x}
                  y={midA.y}
                  fontSize={fontSize}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#0f172a"
                  style={{ userSelect: 'none' }}
                >
                  {labelA}
                </text>
                <rect
                  x={midB.x - widthB / 2}
                  y={midB.y - height / 2}
                  width={widthB}
                  height={height}
                  rx={0.05}
                  fill="rgba(255,255,255,0.85)"
                  stroke="rgba(15,23,42,0.25)"
                  strokeWidth={0.02}
                />
                <text
                  x={midB.x}
                  y={midB.y}
                  fontSize={fontSize}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#0f172a"
                  style={{ userSelect: 'none' }}
                >
                  {labelB}
                </text>
              </g>
            );
          })()}

          {draftNew && (
            <g pointerEvents="none">
              {interaction?.kind === 'drawing-ellipse' ||
              interaction?.kind === 'drawing-circle' ||
              interaction?.kind === 'drawing-semi-circle' ||
              interaction?.kind === 'drawing-quadrant' ? (
                <ellipse
                  cx={draftNew.x + draftNew.width / 2}
                  cy={draftNew.y + draftNew.height / 2}
                  rx={Math.max(draftNew.width / 2, MIN_SIZE / 2)}
                  ry={Math.max(draftNew.height / 2, MIN_SIZE / 2)}
                  fill="rgba(59,130,246,0.15)"
                  stroke="#2563eb"
                  strokeDasharray="0.4 0.2"
                  strokeWidth={0.06}
                />
              ) : (
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
              )}
            </g>
          )}
          {showDimensions && overlapMeasurements.map((measurement) => {
            const line1 = `${measurement.width.toFixed(2)} x ${measurement.height.toFixed(2)} ${unitsLabel}`;
            const line2 = `${measurement.area.toFixed(2)} ${unitsLabel}²`;
            const fontSize = 0.2;
            const lineHeight = 0.24;
            const paddingX = 0.1;
            const paddingY = 0.06;
            const labelWidth = Math.max(line1.length, line2.length) * fontSize * 0.6 + paddingX * 2;
            const labelHeight = lineHeight * 2 + paddingY * 2;
            return (
              <g key={`overlap-${measurement.id}`} pointerEvents="none">
                <rect
                  x={measurement.x - labelWidth / 2}
                  y={measurement.y - labelHeight / 2}
                  width={labelWidth}
                  height={labelHeight}
                  rx={0.06}
                  fill="rgba(255,255,255,0.85)"
                  stroke="rgba(15,23,42,0.4)"
                  strokeWidth={0.03}
                />
                <text
                  x={measurement.x}
                  y={measurement.y - lineHeight / 2}
                  textAnchor="middle"
                  fontSize={fontSize}
                  fill="#0f172a"
                  style={{ userSelect: 'none' }}
                >
                  <tspan x={measurement.x} dy={0}>
                    {line1}
                  </tspan>
                  <tspan x={measurement.x} dy={lineHeight}>
                    {line2}
                  </tspan>
                </text>
              </g>
            );
          })}
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
        <button
          className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
          onClick={() => {
            if (!contextMenu.targetId) return;
            apply({ type: 'area/set-label-offset', payload: { id: contextMenu.targetId, offset: { x: 0, y: 0 } } });
            setContextMenu({ visible: false, x: 0, y: 0, targetId: undefined });
          }}
        >
          Reset label position
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
          className={`block w-full px-3 py-2 text-left text-sm ${canUnmerge ? 'hover:bg-slate-100' : 'cursor-not-allowed text-slate-300'}`}
          disabled={!canUnmerge}
          onClick={() => {
            if (!canUnmerge) return;
            undo();
            setContextMenu({ visible: false, x: 0, y: 0, targetId: undefined });
          }}
        >
          Unmerge (undo merge)
        </button>
        <button
          className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
          onClick={() => {
            const ids = selection.areaIds.length > 1 ? selection.areaIds : contextMenu.targetId ? [contextMenu.targetId] : [];
            if (ids.length < 2) {
              openPrompt('Select at least two areas to subtract', '', () => {});
              return;
            }
            apply({ type: 'area/subtract', payload: { ids } });
            setContextMenu({ visible: false, x: 0, y: 0, targetId: undefined });
          }}
        >
          Subtract selection
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
