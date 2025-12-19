import { useEffect, useMemo, useRef, useState } from 'react';
import CanvasStage from './CanvasStage';
import PropertiesPanel from './PropertiesPanel';
import Toolbar from './Toolbar';
import TopBar from './TopBar';
import { usePlanStore } from '../store/usePlanStore';
import PromptOverlay from './PromptOverlay';
import { shapeBoundingBox } from '../domain/geometry';
import type { Area } from '../domain/types';

const COPY_GAP = 0.5;

function cloneAreas(areas: Area[]) {
  return structuredClone ? structuredClone(areas) : JSON.parse(JSON.stringify(areas));
}

function selectionBounds(areas: Area[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  areas.forEach((area) => {
    const bounds = shapeBoundingBox(area.shape);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { width: 1, height: 1 };
  }

  return { width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

export default function AppShell() {
  const plan = usePlanStore((s) => s.plan);
  const selection = usePlanStore((s) => s.selection);
  const activeTool = usePlanStore((s) => s.activeTool);
  const setTool = usePlanStore((s) => s.setTool);
  const undo = usePlanStore((s) => s.undo);
  const redo = usePlanStore((s) => s.redo);
  const [showNewPlan, setShowNewPlan] = useState(false);
  const newWidthRef = useRef<HTMLInputElement>(null);
  const newHeightRef = useRef<HTMLInputElement>(null);
  const newUnitsRef = useRef<HTMLSelectElement>(null);
  const [showResize, setShowResize] = useState(false);
  const resizeWidthRef = useRef<HTMLInputElement>(null);
  const resizeHeightRef = useRef<HTMLInputElement>(null);
  const apply = usePlanStore((s) => s.apply);
  const clipboardRef = useRef<Area[] | null>(null);
  const pasteCountRef = useRef(0);
  const planRef = useRef(plan);
  const selectionRef = useRef(selection);

  const hasSelection = useMemo(() => selection.areaIds.length > 0, [selection.areaIds]);
  const [undocked, setUndocked] = useState(false);

  const handleCreatePlan = () => {
    const width = parseFloat(newWidthRef.current?.value ?? '10');
    const height = parseFloat(newHeightRef.current?.value ?? '10');
    const units = (newUnitsRef.current?.value ?? 'm') as 'm' | 'cm' | 'ft';
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    apply({ type: 'plan/create', payload: { width, height, units, name: 'New Plan' } });
    setShowNewPlan(false);
  };

  const handleResizePlan = () => {
    const width = parseFloat(resizeWidthRef.current?.value ?? '');
    const height = parseFloat(resizeHeightRef.current?.value ?? '');
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    apply({ type: 'plan/resize-boundary', payload: { width, height } });
    setShowResize(false);
  };

  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        !target ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        target.isContentEditable;
      if (isTyping) return;
      const key = e.key.toLowerCase();
      const isUndo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey;
      const isRedo =
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') ||
        ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'z');
      if (isUndo) {
        e.preventDefault();
        undo();
      } else if (isRedo) {
        e.preventDefault();
        redo();
      } else if ((e.metaKey || e.ctrlKey) && key === 'c') {
        const ids = selectionRef.current.areaIds;
        if (!ids.length) return;
        const selected = planRef.current.areas.filter((area) => ids.includes(area.id));
        if (!selected.length) return;
        e.preventDefault();
        clipboardRef.current = cloneAreas(selected);
        pasteCountRef.current = 0;
      } else if ((e.metaKey || e.ctrlKey) && key === 'v') {
        const clipboard = clipboardRef.current;
        if (!clipboard || !clipboard.length) return;
        e.preventDefault();
        pasteCountRef.current += 1;
        const bounds = selectionBounds(clipboard);
        const dx = (bounds.width + COPY_GAP) * pasteCountRef.current;
        const dy = (bounds.height + COPY_GAP) * pasteCountRef.current;
        const suffix = pasteCountRef.current === 1 ? 'copy' : `copy ${pasteCountRef.current}`;
        apply({ type: 'area/paste', payload: { areas: clipboard, dx, dy, nameSuffix: suffix } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, apply]);

  return (
    <>
      <div className="min-h-screen bg-sand text-ink">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-6">
          <TopBar
            onNew={() => setShowNewPlan(true)}
            onResize={() => {
              if (resizeWidthRef.current) resizeWidthRef.current.value = String(plan.canvas.width);
              if (resizeHeightRef.current) resizeHeightRef.current.value = String(plan.canvas.height);
              setShowResize(true);
            }}
            onUndock={() => setUndocked(true)}
          />
          <div className="grid min-h-[70vh] grid-cols-[300px_1fr] gap-4">
            <div className="flex flex-col gap-3">
              <Toolbar activeTool={activeTool} onChangeTool={setTool} hasSelection={hasSelection} />
              <PropertiesPanel />
            </div>
            <div className="overflow-hidden rounded-2xl bg-white shadow-shell ring-1 ring-slate-200">
              <CanvasStage />
            </div>
          </div>
        </div>

        {showNewPlan && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
            <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg ring-1 ring-slate-200">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Create Plan</h2>
                <button
                  className="text-sm text-slate-500 hover:text-ink"
                  onClick={() => setShowNewPlan(false)}
                >
                  Close
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-slate-600">
                  Width
                  <input
                    ref={newWidthRef}
                    defaultValue={plan.canvas.width}
                    type="number"
                    step="0.1"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="text-sm text-slate-600">
                  Height
                  <input
                    ref={newHeightRef}
                    defaultValue={plan.canvas.height}
                    type="number"
                    step="0.1"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="text-sm text-slate-600">
                  Units
                  <select
                    ref={newUnitsRef}
                  defaultValue={plan.units}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:border-accent focus:outline-none"
                >
                  <option value="m">Meters</option>
                  <option value="cm">Centimeters</option>
                  <option value="ft">Feet</option>
                </select>
              </label>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                  onClick={() => setShowNewPlan(false)}
                >
                  Cancel
                </button>
                <button
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-600"
                  onClick={handleCreatePlan}
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}
        {showResize && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
            <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg ring-1 ring-slate-200">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Resize Plan</h2>
                <button className="text-sm text-slate-500 hover:text-ink" onClick={() => setShowResize(false)}>
                  Close
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-slate-600">
                  Width
                  <input
                    ref={resizeWidthRef}
                    defaultValue={plan.canvas.width}
                    type="number"
                    step="0.1"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="text-sm text-slate-600">
                  Height
                  <input
                    ref={resizeHeightRef}
                    defaultValue={plan.canvas.height}
                    type="number"
                    step="0.1"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:border-accent focus:outline-none"
                  />
                </label>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100" onClick={() => setShowResize(false)}>
                  Cancel
                </button>
                <button
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-600"
                  onClick={handleResizePlan}
                >
                  Resize
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {undocked && (
        <div className="fixed inset-0 z-50 flex bg-slate-950/70">
          <div className="flex w-[260px] flex-col gap-3 bg-white/95 p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-800">Tools</div>
              <button
                className="rounded bg-slate-900 px-3 py-1 text-xs font-semibold text-white"
                onClick={() => setUndocked(false)}
              >
                Dock back
              </button>
            </div>
            <Toolbar activeTool={activeTool} onChangeTool={setTool} hasSelection={hasSelection} />
          </div>
          <div className="flex-1 bg-slate-100 p-4">
            <div className="h-full rounded-2xl bg-white shadow-shell ring-1 ring-slate-200">
              <CanvasStage />
            </div>
          </div>
        </div>
      )}
      <PromptOverlay />
    </>
  );
}
