import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ChevronDown, Layers } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { db } from '../lib/db';
import type { Collection } from '../lib/types';
import { cn } from '../lib/utils';

function Option({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color?: string }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10"
    >
      {color ? <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} /> : <Layers size={12} className="shrink-0 text-gray-400" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active && <Check size={13} className="text-violet-600" />}
    </button>
  );
}

/** Chooses which collections a chat searches. An empty selection means the whole knowledge base. */
export function ScopePicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const collections = useLiveQuery(() => db.collections.orderBy('name').toArray(), [], [] as Collection[]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const selected = collections.filter((c) => value.includes(c.id));
  const label = selected.length === 0 ? 'All knowledge' : selected.length === 1 ? selected[0].name : `${selected.length} collections`;
  const toggle = (id: string) => {
    const valid = selected.map((c) => c.id);
    onChange(valid.includes(id) ? valid.filter((v) => v !== id) : [...valid, id]);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Choose which collections this chat searches"
        className={cn(
          'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition',
          selected.length
            ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300'
            : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-white/5 dark:text-gray-300',
        )}
      >
        {selected.length ? (
          <span className="flex -space-x-1">
            {selected.slice(0, 3).map((c) => (
              <span key={c.id} className="h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-black" style={{ background: c.color }} />
            ))}
          </span>
        ) : (
          <Layers size={13} />
        )}
        <span className="max-w-[140px] truncate">{label}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-60 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-gray-800 dark:bg-[#111]">
          <div className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-gray-400">Search in</div>
          <Option active={!selected.length} onClick={() => onChange([])} label="All knowledge" />
          {collections.map((c) => (
            <Option key={c.id} active={value.includes(c.id)} onClick={() => toggle(c.id)} label={c.name} color={c.color} />
          ))}
          {!collections.length && <div className="px-2 py-2 text-xs text-gray-400">Create collections in the Knowledge tab to scope chats to them.</div>}
        </div>
      )}
    </div>
  );
}
