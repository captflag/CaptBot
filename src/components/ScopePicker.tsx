import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, Layers } from 'lucide-react';
import { db } from '../lib/db';
import type { Collection } from '../lib/types';
import { cn } from '../lib/utils';
import { Menu, MenuItem } from './Menu';

/** Chooses which collections a chat searches. An empty selection means the whole knowledge base. */
export function ScopePicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const collections = useLiveQuery(() => db.collections.orderBy('name').toArray(), [], [] as Collection[]);
  const selected = collections.filter((c) => value.includes(c.id));
  const label = selected.length === 0 ? 'All knowledge' : selected.length === 1 ? selected[0].name : `${selected.length} collections`;
  const toggle = (id: string) => {
    const valid = selected.map((c) => c.id);
    onChange(valid.includes(id) ? valid.filter((v) => v !== id) : [...valid, id]);
  };

  return (
    <Menu
      label={`Search in: ${label}`}
      title="Choose which collections this chat searches"
      heading="Search in"
      panelClassName="w-60"
      buttonClassName={cn(
        'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition',
        selected.length
          ? 'border-accent-200 bg-accent-50 text-accent-700 dark:border-accent-900 dark:bg-accent-950/40 dark:text-accent-300'
          : 'border-line bg-surface text-muted hover:bg-canvas/60',
      )}
      button={
        <>
          {selected.length ? (
            <span className="flex -space-x-1">
              {selected.slice(0, 3).map((c) => (
                <span key={c.id} className="h-2.5 w-2.5 rounded-full ring-2 ring-surface" style={{ background: c.color }} />
              ))}
            </span>
          ) : (
            <Layers size={13} />
          )}
          {/* Phones show just the dots (or the layers icon); the button's label still names the scope. */}
          <span className="max-w-[140px] truncate max-sm:sr-only">{label}</span>
          <ChevronDown size={12} />
        </>
      }
    >
      <MenuItem kind="checkbox" label="All knowledge" icon={Layers} checked={!selected.length} onSelect={() => onChange([])} />
      {collections.map((c) => (
        <MenuItem key={c.id} kind="checkbox" label={c.name} swatch={c.color} checked={value.includes(c.id)} onSelect={() => toggle(c.id)} />
      ))}
      {!collections.length && <div className="px-2 py-2 text-xs text-muted">Create collections on the Knowledge page to scope chats to them.</div>}
    </Menu>
  );
}
