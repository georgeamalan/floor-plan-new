import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { performCommand } from '../domain/commands';
import { seedPlan } from '../domain/planFactory';
import type { Command, CommandRecord, HistoryStack, Plan, Selection, Tool } from '../domain/types';

type PlanStoreState = {
  plan: Plan;
  selection: Selection;
  history: HistoryStack;
  activeTool: Tool;
  paletteColor: string;
  snapEnabled: boolean;
  showDimensions: boolean;
  showGrid: boolean;
  apply: (command: Command) => void;
  undo: () => void;
  redo: () => void;
  setTool: (tool: Tool) => void;
  setSelection: (selection: Selection) => void;
  loadPlan: (plan: Plan) => void;
};

function clonePlan(plan: Plan) {
  return structuredClone ? structuredClone(plan) : JSON.parse(JSON.stringify(plan));
}

function pushHistory(history: HistoryStack, record: CommandRecord): HistoryStack {
  const undo = [...history.undo, record];
  // keep most recent 100 undo entries
  const cappedUndo = undo.slice(-100);
  return {
    undo: cappedUndo,
    redo: [],
  };
}

export const usePlanStore = create<PlanStoreState>()(
  devtools(
    (set) => ({
      plan: seedPlan(),
      selection: { areaIds: [] },
      history: { undo: [], redo: [] },
      activeTool: 'select',
      paletteColor: '#f59e0b',
      snapEnabled: true,
      showDimensions: true,
      showGrid: true,
      apply: (command: Command) =>
        set((state) => {
          const before = clonePlan(state.plan);
          const { plan: after, selection, description } = performCommand(state.plan, command);
          const changed = JSON.stringify(before) !== JSON.stringify(after);
          if (!changed) {
            return selection ? { selection } : {};
          }
          const record: CommandRecord = {
            type: command.type,
            payload: command.payload as never,
            description: description ?? command.type,
            before,
            after: clonePlan(after),
            timestamp: Date.now(),
          };
          return {
            plan: after,
            selection: selection ?? state.selection,
            history: pushHistory(state.history, record),
          };
        }),
      undo: () =>
        set((state) => {
          const last = state.history.undo.at(-1);
          if (!last) return {};
          const undo = state.history.undo.slice(0, -1);
          const redo = [last, ...state.history.redo];
          return { plan: clonePlan(last.before), selection: { areaIds: [] }, history: { undo, redo } };
        }),
      redo: () =>
        set((state) => {
          const next = state.history.redo.at(0);
          if (!next) return {};
          const undo = [...state.history.undo, next];
          const redo = state.history.redo.slice(1);
          return { plan: clonePlan(next.after), selection: { areaIds: [] }, history: { undo, redo } };
        }),
      setTool: (tool) => set({ activeTool: tool }),
      setSelection: (selection) => set({ selection }),
      loadPlan: (plan) =>
        set(() => ({
          plan: clonePlan(plan),
          selection: { areaIds: [] },
          history: { undo: [], redo: [] },
          activeTool: 'select',
        })),
    }),
    { name: 'plan-store' },
  ),
);
