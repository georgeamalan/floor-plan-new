import type { Plan } from './types';

export function exportPlanToJson(plan: Plan): string {
  return JSON.stringify(plan, null, 2);
}

export function importPlanFromJson(json: string): Plan | null {
  try {
    const parsed = JSON.parse(json) as Plan;
    if (!parsed.version) return null;
    return parsed;
  } catch (err) {
    console.error('Invalid plan JSON', err);
    return null;
  }
}
