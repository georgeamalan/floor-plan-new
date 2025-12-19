import { useEffect, useRef } from 'react';
import type { ChangeEvent } from 'react';
import { exportPlanToJson, importPlanFromJson } from '../domain/io';
import { usePlanStore } from '../store/usePlanStore';

type Props = {
  onNew: () => void;
  onUndock: () => void;
  onResize: () => void;
};

export default function TopBar({ onNew, onUndock, onResize }: Props) {
  const plan = usePlanStore((s) => s.plan);
  const undo = usePlanStore((s) => s.undo);
  const redo = usePlanStore((s) => s.redo);
  const loadPlan = usePlanStore((s) => s.loadPlan);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = `${plan.meta.name} – Floor Plan`;
  }, [plan.meta.name]);

  const handleSave = () => {
    const json = exportPlanToJson(plan);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${plan.meta.name || 'plan'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoad = (evt: ChangeEvent<HTMLInputElement>) => {
    const file = evt.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = importPlanFromJson(String(reader.result));
      if (parsed) {
        loadPlan(parsed);
      } else {
        alert('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  };

  return (
    <header className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-shell ring-1 ring-slate-200">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-emerald-400 shadow-sm" />
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Floor-Plan Editor</p>
          <p className="text-sm font-semibold text-ink">{plan.meta.name}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <button
          className="rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-slate-100"
          onClick={onNew}
        >
          New
        </button>
        <button
          className="rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-slate-100"
          onClick={onResize}
        >
          Resize
        </button>
        <button
          className="rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-slate-100"
          onClick={handleSave}
        >
          Save JSON
        </button>
        <button
          className="rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-slate-100"
          onClick={() => fileInputRef.current?.click()}
        >
          Load JSON
        </button>
        <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleLoad} />
        <button
          className="rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-slate-100"
          onClick={undo}
        >
          Undo
        </button>
        <button
          className="rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-slate-100"
          onClick={redo}
        >
          Redo
        </button>
        <button
          className="rounded-lg bg-slate-900 px-3 py-2 font-medium text-white hover:bg-slate-800"
          onClick={onUndock}
        >
          Dock out canvas
        </button>
      </div>
    </header>
  );
}
