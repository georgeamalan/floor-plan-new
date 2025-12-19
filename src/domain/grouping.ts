import type { AreaGroup, Plan } from './types';

export function addGroup(plan: Plan, name: string, areaIds: string[]): Plan {
  const next = structuredClone ? structuredClone(plan) : JSON.parse(JSON.stringify(plan));
  const group: AreaGroup = { id: crypto.randomUUID(), name, areaIds, visible: true };
  next.areaGroups = [...(next.areaGroups ?? []), group];
  return next;
}

export function toggleGroupVisibility(plan: Plan, id: string, visible: boolean): Plan {
  const next = structuredClone ? structuredClone(plan) : JSON.parse(JSON.stringify(plan));
  next.areaGroups = (next.areaGroups ?? []).map((g: AreaGroup) => (g.id === id ? { ...g, visible } : g));
  return next;
}

export function deleteGroup(plan: Plan, id: string): Plan {
  const next = structuredClone ? structuredClone(plan) : JSON.parse(JSON.stringify(plan));
  next.areaGroups = (next.areaGroups ?? []).filter((g: AreaGroup) => g.id !== id);
  return next;
}
