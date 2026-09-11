import { CircleCheck, TriangleAlert, X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { cn } from '../lib/utils';

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(message: string, kind: Toast['kind'] = 'info') {
  const t = { id: ++seq, message, kind };
  toasts = [...toasts.slice(-3), t];
  emit();
  setTimeout(() => dismiss(t.id), kind === 'error' ? 8000 : 4000);
}

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[200] flex w-80 flex-col gap-2" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-white px-3.5 py-3 text-sm shadow-lg dark:bg-[#111]',
            t.kind === 'error' ? 'border-red-200 dark:border-red-900/60' : 'border-gray-200 dark:border-gray-800',
          )}
        >
          {t.kind === 'error' ? (
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-red-500" />
          ) : (
            <CircleCheck size={16} className="mt-0.5 shrink-0 text-violet-500" />
          )}
          <span className="flex-1 text-gray-700 dark:text-gray-200">{t.message}</span>
          <button onClick={() => dismiss(t.id)} className="text-gray-400 hover:text-gray-600" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
