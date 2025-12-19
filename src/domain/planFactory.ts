import { defaultAreaName } from './naming';
import type { Plan, RectShape, Units } from './types';

function now() {
  return new Date().toISOString();
}

export function createBlankPlan(width: number, height: number, units: Units, name = 'New Plan'): Plan {
  return {
    version: '1.0',
    units,
    canvas: {
      width,
      height,
      zoom: 1,
      pan: { x: 0, y: 0 },
    },
    areas: [],
    areaGroups: [],
    meta: {
      name,
      createdAt: now(),
      updatedAt: now(),
    },
  };
}

function rectShape(partial: Partial<RectShape>): RectShape {
  return {
    type: 'rect',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    ...partial,
  };
}

export function seedPlan(): Plan {
  const plan = createBlankPlan(12, 9, 'm', 'Demo Floor');
  const areaA: RectShape = rectShape({ x: 1, y: 1, width: 4, height: 3 });
  const areaB: RectShape = rectShape({ x: 6, y: 2, width: 4.5, height: 4 });
  const baseName = defaultAreaName(plan);
  plan.areas = [
    {
      id: crypto.randomUUID(),
      name: baseName,
      fill: '#bfdbfe',
      stroke: '#1d4ed8',
      strokeWidth: 0.04,
      shape: areaA,
    },
    {
      id: crypto.randomUUID(),
      name: `${baseName} B`,
      fill: '#fecdd3',
      stroke: '#be123c',
      strokeWidth: 0.04,
      shape: areaB,
    },
  ];
  plan.meta.updatedAt = now();
  return plan;
}
