import { useEffect, useRef, useState } from 'react';
import { usePromptStore } from '../store/usePromptStore';

export default function PromptOverlay() {
  const prompt = usePromptStore((s) => s.prompt);
  const closePrompt = usePromptStore((s) => s.closePrompt);
  const [value, setValue] = useState(prompt.defaultValue ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(prompt.defaultValue ?? '');
    if (prompt.open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [prompt.defaultValue, prompt.open]);

  if (!prompt.open) return null;

  const submit = () => {
    prompt.onSubmit?.(value);
    closePrompt();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={closePrompt}>
      <div
        className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-slate-800">{prompt.title}</p>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-accent focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            className="rounded-md px-3 py-1 text-sm text-slate-600 hover:bg-slate-100"
            onClick={closePrompt}
          >
            Cancel
          </button>
          <button
            className="rounded-md bg-accent px-3 py-1 text-sm font-semibold text-white"
            onClick={submit}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
