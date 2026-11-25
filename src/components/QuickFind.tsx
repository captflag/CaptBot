import { useLiveQuery } from 'dexie-react-hooks';
import { Bookmark, CornerDownLeft, FileText, Keyboard, LibraryBig, MessageSquare, Plus, Search, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../lib/db';
import type { KbDocument, SavedPrompt, Thread } from '../lib/types';
import { cn } from '../lib/utils';

interface Item {
  key: string;
  group: string;
  label: string;
  icon: ReactNode;
  run: () => void;
}

interface Props {
  onClose: () => void;
  onSelectThread: (id: string) => void;
  onViewDocument: (doc: KbDocument) => void;
  onUsePrompt: (text: string) => void;
  onNewChat: () => void;
  onOpenKnowledge: () => void;
  onOpenSettings: () => void;
  onShowShortcuts: () => void;
}

/** How many results each group may show. */
const PER_GROUP = 6;

/**
 * One box to jump anywhere: type to find a chat (by title or anything said in it), a document
 * or a saved prompt, or run a common action. Opened from the header or with Ctrl+K.
 */
export function QuickFind({ onClose, onSelectThread, onViewDocument, onUsePrompt, onNewChat, onOpenKnowledge, onOpenSettings, onShowShortcuts }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLowerCase();

  const threads = useLiveQuery(() => db.threads.orderBy('updatedAt').reverse().toArray(), [], [] as Thread[]);
  const docs = useLiveQuery(() => db.documents.orderBy('createdAt').reverse().toArray(), [], [] as KbDocument[]);
  const prompts = useLiveQuery(() => db.prompts.orderBy('createdAt').reverse().toArray(), [], [] as SavedPrompt[]);
  // ponytail: reads every message per keystroke, the same ceiling as the chat list's search.
  const inMessages = useLiveQuery(
    async () => {
      const ids = new Set<string>();
      if (needle.length >= 2) await db.messages.filter((m) => m.content.toLowerCase().includes(needle)).each((m) => ids.add(m.threadId));
      return ids;
    },
    [needle],
    new Set<string>(),
  );

  const has = (text: string) => !needle || text.toLowerCase().includes(needle);
  const items: Item[] = [
    ...[
      { key: 'new', label: 'New chat', icon: <Plus size={14} />, run: onNewChat },
      { key: 'knowledge', label: 'Open Knowledge', icon: <LibraryBig size={14} />, run: onOpenKnowledge },
      { key: 'settings', label: 'Open Settings', icon: <SettingsIcon size={14} />, run: onOpenSettings },
      { key: 'shortcuts', label: 'Keyboard shortcuts', icon: <Keyboard size={14} />, run: onShowShortcuts },
    ]
      .filter((a) => has(a.label))
      .map((a) => ({ ...a, group: 'Actions' })),
    ...threads
      .filter((t) => has(t.title) || inMessages.has(t.id))
      .slice(0, PER_GROUP)
      .map((t) => ({ key: `t:${t.id}`, group: needle ? 'Chats' : 'Recent chats', label: t.title, icon: <MessageSquare size={14} />, run: () => onSelectThread(t.id) })),
    // With nothing typed, the box stays short: actions and recent chats only.
    ...(needle
      ? [
          ...docs
            .filter((d) => d.charCount > 0 && has(d.name))
            .slice(0, PER_GROUP)
            .map((d) => ({ key: `d:${d.id}`, group: 'Documents', label: d.name, icon: <FileText size={14} />, run: () => onViewDocument(d) })),
          ...prompts
            .filter((p) => has(p.text))
            .slice(0, PER_GROUP)
            .map((p) => ({ key: `p:${p.id}`, group: 'Saved prompts', label: p.text, icon: <Bookmark size={14} />, run: () => onUsePrompt(p.text) })),
        ]
      : []),
  ];
  const selected = Math.min(index, Math.max(0, items.length - 1));

  useEffect(() => setIndex(0), [needle]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  return createPortal(
    <div className="anim-fade fixed inset-0 z-[110] flex items-start justify-center bg-black/45 px-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Quick find" className="anim-rise flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={16} className="shrink-0 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex(Math.min(selected + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex(Math.max(selected - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(items[selected]);
              } else if (e.key === 'Escape') {
                onClose();
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="quick-find-results"
            aria-activedescendant={items[selected] ? `qf-${items[selected].key}` : undefined}
            aria-label="Find chats, documents and prompts"
            placeholder="Find a chat, a document, a saved prompt…"
            className="min-w-0 flex-1 bg-transparent py-3.5 text-[15px] text-ink outline-none placeholder:text-muted"
          />
          <kbd className="shrink-0 rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">Esc</kbd>
        </div>

        <div ref={listRef} id="quick-find-results" role="listbox" aria-label="Results" className="scrollbar-thin overflow-y-auto p-2">
          {items.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted">Nothing matches “{query.trim()}”.</div>}
          {items.map((item, i) => (
            <div key={item.key}>
              {(i === 0 || items[i - 1].group !== item.group) && (
                <div className="px-3 pt-2 pb-1 font-mono text-[10px] tracking-wider text-muted uppercase">{item.group}</div>
              )}
              <button
                id={`qf-${item.key}`}
                role="option"
                aria-selected={i === selected}
                onMouseMove={() => setIndex(i)}
                onClick={() => choose(item)}
                className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13.5px] text-ink', i === selected && 'bg-canvas ring-1 ring-line')}
              >
                <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg', i === selected ? 'bg-accent-500 text-gray-950' : 'bg-canvas text-muted')}>{item.icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {i === selected && <CornerDownLeft size={13} className="shrink-0 text-muted" />}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
