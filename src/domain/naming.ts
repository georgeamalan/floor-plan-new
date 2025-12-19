import type { Area, Plan } from './types';

export function nextAreaIndex(plan: Plan) {
  const max = plan.areas.reduce((acc, area) => {
    const match = area.name.match(/(\d+)/);
    if (!match) return acc;
    return Math.max(acc, parseInt(match[1] ?? '0', 10));
  }, 0);
  return max + 1;
}

export function defaultAreaName(plan: Plan) {
  return `Area ${nextAreaIndex(plan)}`;
}

export function partitionNames(base: string, count: number): string[] {
  if (count <= 1) return [base];
  const suffixes = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const baseTrimmed = base.replace(/\s+$/, '');
  return Array.from({ length: count }, (_, idx) => {
    const suffix = suffixes[idx] ?? `${idx + 1}`;
    return `${baseTrimmed} ${suffix}`;
  });
}

export function findArea(plan: Plan, id: string): Area | undefined {
  return plan.areas.find((a) => a.id === id);
}
