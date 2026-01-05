import { useMemo } from 'react';
import { constrainRectToBounds } from '../domain/geometry';
import { usePlanStore } from '../store/usePlanStore';
import { usePromptStore } from '../store/usePromptStore';

export default function PropertiesPanel() {
  const plan = usePlanStore((s) => s.plan);
  const selection = usePlanStore((s) => s.selection);
  const apply = usePlanStore((s) => s.apply);
  const openPrompt = usePromptStore((s) => s.openPrompt);
  const selectedArea = useMemo(
    () => plan.areas.find((a) => a.id === selection.areaIds[0]),
    [plan.areas, selection.areaIds],
  );

  const updateArea = (field: 'name' | 'fill' | 'rect', value: unknown) => {
    if (!selectedArea) return;
    if (field === 'name') {
      apply({ type: 'area/rename', payload: { id: selectedArea.id, name: String(value) } });
    } else if (field === 'fill') {
      apply({ type: 'area/recolor', payload: { id: selectedArea.id, fill: String(value) } });
    } else if (field === 'rect' && selectedArea.shape.type === 'rect') {
      apply({
        type: 'area/set-rect',
        payload: {
          id: selectedArea.id,
          rect: constrainRectToBounds(value as any, plan.canvas),
        },
      });
    }
  };

  const divideSelection = () => {
    if (!selectedArea) return;
    openPrompt('Number of partitions', '2', (val) => {
      const count = parseInt(val, 10);
      if (!Number.isFinite(count) || count < 2) return;
      openPrompt('Direction? (vertical/horizontal)', 'vertical', (dirVal) => {
        const direction = (dirVal === 'horizontal' ? 'horizontal' : 'vertical') as 'vertical' | 'horizontal';
        apply({ type: 'area/divide', payload: { id: selectedArea.id, partitions: count, direction } });
      });
    });
  };

  return (
    <aside className="flex h-full flex-col gap-4 rounded-2xl bg-white p-4 shadow-shell ring-1 ring-slate-200">
      <div className="rounded-xl border border-slate-200 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.12em] text-slate-400">
            Selection {selection.areaIds.length > 1 ? `(${selection.areaIds.length})` : ''}
          </p>
          {selectedArea && (
            <button
              className="text-xs text-red-600 hover:underline"
              onClick={() => apply({ type: 'area/delete', payload: { id: selectedArea.id } })}
            >
              Delete
            </button>
          )}
        </div>
        {!selectedArea ? (
          <p className="mt-2 text-sm text-slate-500">Click an area to edit its properties.</p>
        ) : (
          <div className="mt-2 space-y-3 text-sm text-slate-700">
            <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Name
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                defaultValue={selectedArea.name}
                onBlur={(e) => updateArea('name', e.target.value)}
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Fill
              <div className="mt-1 flex items-center gap-3">
                <input
                  type="color"
                  defaultValue={selectedArea.fill}
                  onChange={(e) => updateArea('fill', e.target.value)}
                  className="h-9 w-16 rounded border border-slate-200"
                />
                <span className="text-slate-600">{selectedArea.fill}</span>
              </div>
            </label>
            {selectedArea.shape.type === 'rect' && (
              <div className="grid grid-cols-2 gap-2">
                {(['x', 'y', 'width', 'height'] as const).map((field) => {
                  const rect = selectedArea.shape.type === 'rect' ? selectedArea.shape : null;
                  return (
                  <label
                      key={field}
                      className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500"
                    >
                      {field}
                      <input
                        type="number"
                        step="0.1"
                        defaultValue={rect?.[field]}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                        onBlur={(e) =>
                          rect &&
                          updateArea('rect', {
                            ...rect,
                            [field]: parseFloat(e.target.value),
                          })
                        }
                      />
                    </label>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <button
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-100"
                onClick={divideSelection}
              >
                Divide
              </button>
              <button
                className="flex-1 rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white hover:bg-slate-800"
                onClick={() => openPrompt('Rename area', selectedArea.name, (val) => updateArea('name', val || selectedArea.name))}
              >
                Rename
              </button>
            </div>
            <div className="flex gap-2">
              <button
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-100"
                onClick={() => apply({ type: 'area/mirror', payload: { id: selectedArea.id, axis: 'vertical' } })}
              >
                Mirror vertical
              </button>
              <button
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-100"
                onClick={() => apply({ type: 'area/mirror', payload: { id: selectedArea.id, axis: 'horizontal' } })}
              >
                Mirror horizontal
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-600">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Notes</p>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Drag plan edges to resize the boundary.</li>
          <li>Wheel to zoom, space+drag or Pan tool to move.</li>
          <li>Divide creates equal partitions (keeps parent id as lineage).</li>
          <li>Shift-click to multi-select and move together.</li>
          <li>Long-press or right-click an area for the context menu (merge, divide, rename).</li>
          <li>Undo/redo: Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z.</li>
        </ul>
      </div>
    </aside>
  );
}
