import { usePlanStore } from '../store/usePlanStore';
import { usePromptStore } from '../store/usePromptStore';
import type { Tool } from '../domain/types';

type Props = {
  activeTool: Tool;
  onChangeTool: (tool: Tool) => void;
  hasSelection: boolean;
};

const tools: { id: Tool; label: string; icon: string }[] = [
  { id: 'select', label: 'Select / Move', icon: '⬚' },
  { id: 'draw-rect', label: 'Draw Rectangle', icon: '▭' },
  { id: 'draw-polygon', label: 'Draw Polygon', icon: '△' },
  { id: 'draw-ellipse', label: 'Draw Ellipse', icon: '◯' },
  { id: 'draw-circle', label: 'Draw Circle', icon: '⬤' },
  { id: 'draw-semi-circle', label: 'Draw Semi Circle', icon: '◐' },
  { id: 'draw-quadrant', label: 'Draw Quadrant', icon: '◴' },
  { id: 'divide', label: 'Divide Area', icon: '⇲' },
  { id: 'pan', label: 'Pan / Zoom', icon: '✥' },
  { id: 'fill', label: 'Color Fill', icon: '🎨' },
  { id: 'label', label: 'Text / Label', icon: '✎' },
  { id: 'delete', label: 'Delete', icon: '⌫' },
];

export default function Toolbar({ activeTool, onChangeTool, hasSelection }: Props) {
  const paletteColor = usePlanStore((s) => s.paletteColor);
  const apply = usePlanStore((s) => s.apply);
  const plan = usePlanStore((s) => s.plan);
  const snapEnabled = usePlanStore((s) => s.snapEnabled);
  const showDimensions = usePlanStore((s) => s.showDimensions);
  const showGrid = usePlanStore((s) => s.showGrid);
  const openPrompt = usePromptStore((s) => s.openPrompt);

  return (
    <aside className="flex h-full flex-col gap-3 rounded-2xl bg-white p-4 shadow-shell ring-1 ring-slate-200">
      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Tools</p>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {tools.map((tool) => (
            <button
              key={tool.id}
              title={tool.label}
              onClick={() => onChangeTool(tool.id)}
              className={`flex h-12 items-center justify-center rounded-lg text-lg font-bold transition ${
                activeTool === tool.id
                  ? 'bg-gradient-to-r from-blue-50 to-emerald-50 text-ink ring-1 ring-blue-200'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {tool.icon}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Plan</p>
        <div className="mt-2 space-y-1 text-sm text-slate-700">
          <div className="flex justify-between">
            <span>Size</span>
            <span className="font-semibold">
              {plan.canvas.width} × {plan.canvas.height} {plan.units}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Zoom</span>
            <span className="font-semibold">{plan.canvas.zoom.toFixed(2)}×</span>
          </div>
          <div className="flex justify-between">
            <span>Areas</span>
            <span className="font-semibold">{plan.areas.length}</span>
          </div>
        </div>
      </div>
      <div className="mt-2 rounded-xl border border-slate-200 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Color</p>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={snapEnabled}
              onChange={(e) => usePlanStore.setState({ snapEnabled: e.target.checked })}
            />
            Snap
          </label>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={showDimensions}
              onChange={(e) => usePlanStore.setState({ showDimensions: e.target.checked })}
            />
            Dimensions
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={showGrid}
              onChange={(e) => usePlanStore.setState({ showGrid: e.target.checked })}
            />
            Grid
          </label>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="color"
            value={paletteColor}
            onChange={(e) => usePlanStore.setState({ paletteColor: e.target.value })}
            className="h-9 w-16 cursor-pointer rounded border border-slate-200"
          />
          <span className="text-sm text-slate-600">{paletteColor}</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">Fill tool uses this color when clicking an area.</p>
      </div>
      <div className="rounded-xl border border-slate-200 p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Quick actions</p>
        <div className="mt-2 flex flex-col gap-2">
          <button
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            disabled={!hasSelection}
            onClick={() => {
              const id = usePlanStore.getState().selection.areaIds[0];
              if (!id) return;
              openPrompt('Divide into how many partitions?', '2', (val) => {
                const count = parseInt(val, 10);
                if (!Number.isFinite(count) || count < 2) return;
                usePlanStore
                  .getState()
                  .apply({ type: 'area/divide', payload: { id, partitions: count, direction: 'vertical' } });
              });
            }}
          >
            Divide selection
          </button>
          <button
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            disabled={!hasSelection}
            onClick={() => {
              const ids = usePlanStore.getState().selection.areaIds;
              ids.forEach((id) => apply({ type: 'area/delete', payload: { id } }));
            }}
          >
            Delete selection
          </button>
          <button
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            disabled={usePlanStore.getState().selection.areaIds.length < 2}
            onClick={() => {
              const ids = usePlanStore.getState().selection.areaIds;
              if (ids.length < 2) return;
              usePlanStore.getState().apply({ type: 'area/merge', payload: { ids } });
            }}
          >
            Merge selection
          </button>
          <button
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            disabled={usePlanStore.getState().selection.areaIds.length < 2}
            onClick={() => {
              const ids = usePlanStore.getState().selection.areaIds;
              if (ids.length < 2) return;
              usePlanStore.getState().apply({ type: 'area/subtract', payload: { ids } });
            }}
          >
            Subtract selection
          </button>
        </div>
      </div>
    </aside>
  );
}
