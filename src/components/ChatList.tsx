import { useLiveQuery } from 'dexie-react-hooks';
import { Bookmark, Check, ListFilter, MessageSquare, PanelLeftClose, Pencil, Plus, Search, Star, Trash } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { db, deleteThread } from '../lib/db';
import { stripCitations } from '../lib/rag/citations';
import { useSettings } from '../lib/settings';
import { toggleStar, useStarred } from '../lib/stars';
import type { Collection, SavedPrompt, Thread } from '../lib/types';
import { cn } from '../lib/utils';
import { UsageMeter } from './UsageMeter';
import { IconButton, inputClass } from './ui';

type Tab = 'chats' | 'saved';


/** A time today, a weekday this week, otherwise a date. */
function when(ts: number): string {
  const d = new Date(ts);
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (ts >= startOfToday) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (ts >= startOfToday - 6 * 86_400_000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** The start of a message as plain words, for the line under a chat's title. */
const plain = (text: string) =>
  stripCitations(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

interface Props {
  open: boolean;
  onClose: () => void;
  activeId: string | null;
  onSelect: (id: string) => void;
  onDeleted: (id: string) => void;
  onNewChat: () => void;
  onUsePrompt: (text: string) => void;
}

/** Past chats and saved prompts. A column beside the chat on wide screens, a drawer over it on narrow ones. */
export function ChatList({ open, onClose, activeId, onSelect, onDeleted, onNewChat, onUsePrompt }: Props) {
  const s = useSettings();
  const threads = useLiveQuery(() => db.threads.orderBy('updatedAt').reverse().toArray(), [], [] as Thread[]);
  const prompts = useLiveQuery(() => db.prompts.orderBy('createdAt').reverse().toArray(), [], [] as SavedPrompt[]);
  const collections = useLiveQuery(() => db.collections.orderBy('name').toArray(), [], [] as Collection[]);
  const [tab, setTab] = useState<Tab>('chats');
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const starred = useStarred();
  /** Show only chats that search this collection; null shows all of them. */
  const [filterId, setFilterId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLowerCase();

  useEffect(() => {
    if (!filterOpen) return;
    const close = (e: MouseEvent) => {
      if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [filterOpen]);

  // ponytail: one pass over every message whenever a message is saved (and per keystroke while
  // searching). Fine for thousands; keep a per-chat preview field and a search index beyond that.
  const scan = useLiveQuery(
    async () => {
      const last = new Map<string, string>();
      const hits = new Set<string>();
      await db.messages.orderBy('[threadId+createdAt]').each((m) => {
        if (m.content) last.set(m.threadId, m.content);
        if (needle && m.content.toLowerCase().includes(needle)) hits.add(m.threadId);
      });
      return { last, hits };
    },
    [needle],
    { last: new Map<string, string>(), hits: new Set<string>() },
  );

  // A filter on a collection that has since been deleted shows everything again.
  const filter = collections.find((c) => c.id === filterId) ?? null;
  const shownThreads = threads
    .filter((t) => (!filter || t.collectionIds.includes(filter.id)) && (!needle || t.title.toLowerCase().includes(needle) || scan.hits.has(t.id)))
    // Starred chats first; within each group the newest stays on top (the sort is stable).
    .sort((a, b) => Number(starred.has(b.id)) - Number(starred.has(a.id)));
  const shownPrompts = needle ? prompts.filter((p) => p.text.toLowerCase().includes(needle)) : prompts;
  const colorOf = new Map(collections.map((c) => [c.id, c.color]));

  const rename = async (e: FormEvent<HTMLFormElement>, id: string) => {
    e.preventDefault();
    const title = String(new FormData(e.currentTarget).get('title') ?? '').trim().slice(0, 200);
    if (title) await db.threads.update(id, { title });
    setEditing(null);
  };

  const tabs: { id: Tab; label: string; count: number; icon: typeof MessageSquare }[] = [
    { id: 'chats', label: 'Chats', count: threads.length, icon: MessageSquare },
    { id: 'saved', label: 'Saved', count: prompts.length, icon: Bookmark },
  ];

  return (
    <>
      <div
        onClick={onClose}
        className={cn('absolute inset-0 z-30 bg-black/40 transition-opacity duration-300 lg:hidden', open ? 'opacity-100' : 'pointer-events-none opacity-0')}
      />
      <aside
        // Closed, it sits off-screen: keep it out of the tab order too.
        inert={!open}
        aria-label="My chats"
        className={cn(
          'absolute inset-y-0 left-0 z-40 flex w-[310px] max-w-[88vw] flex-col border-r border-line bg-surface transition-[translate,margin] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] lg:static lg:z-auto lg:w-[310px] lg:shrink-0',
          open ? 'translate-x-0' : '-translate-x-full lg:-ml-[310px]',
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-2 px-4">
          <h2 className="flex-1 font-display text-[17px] leading-none text-ink">My Chats</h2>
          <button
            type="button"
            onClick={onNewChat}
            title="New chat"
            aria-label="New chat"
            className="grid h-8 w-8 place-items-center rounded-lg bg-accent-500 text-gray-950 transition hover:bg-accent-400 active:scale-95"
          >
            <Plus size={17} strokeWidth={2.4} />
          </button>
          <IconButton title="Hide chats" onClick={onClose}>
            <PanelLeftClose size={16} />
          </IconButton>
        </div>

        <div role="tablist" aria-label="Lists" className="relative mx-3 grid grid-cols-2 rounded-xl bg-canvas p-1">
          {/* One raised tile slides under whichever tab is open. */}
          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-raised shadow-sm ring-1 ring-line transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
              tab === 'saved' && 'translate-x-full',
            )}
          />
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'relative flex items-center justify-center gap-2 rounded-lg py-1.5 text-[11px] font-bold tracking-wider uppercase transition-colors',
                tab === t.id ? 'text-ink' : 'text-muted hover:text-ink',
              )}
            >
              <t.icon size={12} className={tab === t.id ? 'text-accent-600 dark:text-accent-400' : undefined} />
              {t.label}
              <span className="rounded-md bg-accent-500/15 px-1.5 py-px text-[10px] text-accent-700 tabular-nums dark:text-accent-300">{t.count}</span>
            </button>
          ))}
        </div>

        <div className="mx-3 mt-3 flex gap-2">
          <label className="relative block min-w-0 flex-1">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'chats' ? 'Search chats' : 'Search saved prompts'}
              aria-label={tab === 'chats' ? 'Search chats' : 'Search saved prompts'}
              className={cn(inputClass, 'rounded-xl border-transparent bg-canvas py-2 pl-9 text-[13px] dark:border-transparent dark:bg-canvas')}
            />
          </label>
          {/* Filtering is by collection, so the button only exists once there is a collection to pick. */}
          {tab === 'chats' && collections.length > 0 && (
            <div ref={filterRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setFilterOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={filterOpen}
                title={filter ? `Showing chats in ${filter.name}` : 'Filter chats by collection'}
                aria-label={filter ? `Showing chats in ${filter.name}. Change filter` : 'Filter chats by collection'}
                className={cn(
                  'grid h-[38px] w-[38px] place-items-center rounded-xl transition',
                  filter ? 'bg-accent-500 text-gray-950' : 'bg-canvas text-accent-600 hover:bg-accent-500/15 dark:text-accent-400',
                )}
              >
                <ListFilter size={16} />
              </button>
              {filterOpen && (
                <div role="menu" className="anim-fade absolute top-full right-0 z-50 mt-1.5 w-56 rounded-xl border border-line bg-raised p-1.5 shadow-xl">
                  <div className="px-2 pt-1 pb-1.5 font-mono text-[10px] tracking-wider text-muted uppercase">Show chats in</div>
                  {[{ id: null as string | null, name: 'All chats', color: undefined as string | undefined }, ...collections].map((c) => (
                    <button
                      key={c.id ?? 'all'}
                      role="menuitemradio"
                      aria-checked={filterId === c.id}
                      onClick={() => {
                        setFilterId(c.id);
                        setFilterOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-ink hover:bg-canvas"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color ?? 'var(--color-gray-400)' }} />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {(filter?.id ?? null) === c.id && <Check size={13} className="text-accent-600 dark:text-accent-400" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="scrollbar-thin mt-2 flex-1 space-y-1 overflow-y-auto px-3 py-2" role="tabpanel">
          {tab === 'chats' &&
            (shownThreads.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <div className="text-[13px] font-bold text-ink">{threads.length ? 'No chats match' : 'No chats yet'}</div>
                <div className="mt-1 text-xs text-muted">
                  {!threads.length ? 'Ask a question and it is saved here.' : filter && !needle ? `No chats search ${filter.name} yet.` : 'Titles and messages were searched.'}
                </div>
              </div>
            ) : (
              shownThreads.map((t, i) => {
                const active = t.id === activeId;
                const isStarred = starred.has(t.id);
                const preview = scan.last.get(t.id);
                // With any starred chats, the list gets two labelled parts: Starred, then everything else.
                const anyStarred = starred.has(shownThreads[0].id);
                const label = !anyStarred ? null : i === 0 ? 'Starred' : !isStarred && starred.has(shownThreads[i - 1].id) ? 'Recent' : null;
                return (
                  <Fragment key={t.id}>
                  {label && (
                    <h3 className={cn('flex items-center gap-1.5 px-2 pb-1 font-mono text-[10px] tracking-wider text-muted uppercase', i > 0 && 'pt-3')}>
                      {label === 'Starred' && <Star size={10} className="fill-amber-400 text-amber-400" />}
                      {label}
                    </h3>
                  )}
                  <div
                    // Rows arrive one after another; only the first screenful is staggered.
                    style={{ '--d': `${Math.min(i, 14) * 22}ms` } as CSSProperties}
                    className={cn('anim-rise group relative rounded-xl transition-colors', active ? 'bg-canvas ring-1 ring-line' : 'hover:bg-canvas/70')}
                  >
                    {editing === t.id ? (
                      <form onSubmit={(e) => void rename(e, t.id)} className="p-2">
                        <input name="title" autoFocus defaultValue={t.title} aria-label="Chat title" onBlur={(e) => e.currentTarget.form?.requestSubmit()} className={cn(inputClass, 'py-1.5 text-[13px]')} />
                      </form>
                    ) : (
                      <>
                        <button
                          onClick={() => onSelect(t.id)}
                          onDoubleClick={() => setEditing(t.id)}
                          aria-current={active ? 'true' : undefined}
                          className="block w-full px-3 py-2.5 text-left"
                        >
                          <span className="flex items-center gap-2">
                            {isStarred ? (
                              <Star size={11} className="-mx-px shrink-0 fill-amber-400 text-amber-400" aria-label="Starred" />
                            ) : (
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ background: t.collectionIds.length ? (colorOf.get(t.collectionIds[0]) ?? 'var(--color-gray-400)') : active ? 'var(--color-accent-500)' : 'var(--color-gray-400)' }}
                              />
                            )}
                            <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">{t.title}</span>
                            <span className="shrink-0 text-[10px] text-muted tabular-nums">{when(t.updatedAt)}</span>
                          </span>
                          {preview && <span className="mt-1 line-clamp-2 block pl-4 text-xs leading-relaxed text-muted">{plain(preview)}</span>}
                        </button>
                        <div className="absolute right-1.5 bottom-1.5 flex rounded-lg bg-surface shadow-sm ring-1 ring-line sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                          <IconButton title={isStarred ? 'Remove star' : 'Star: keep at the top'} onClick={() => toggleStar(t.id)} active={isStarred}>
                            <Star size={12} className={isStarred ? 'fill-current' : undefined} />
                          </IconButton>
                          <IconButton title="Rename" onClick={() => setEditing(t.id)}>
                            <Pencil size={12} />
                          </IconButton>
                          <IconButton
                            title="Delete chat"
                            onClick={async () => {
                              if (!confirm(`Delete “${t.title}”?`)) return;
                              await deleteThread(t.id);
                              onDeleted(t.id);
                            }}
                          >
                            <Trash size={12} />
                          </IconButton>
                        </div>
                      </>
                    )}
                  </div>
                  </Fragment>
                );
              })
            ))}

          {tab === 'saved' &&
            (shownPrompts.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <div className="text-[13px] font-bold text-ink">{prompts.length ? 'No saved prompts match' : 'Nothing saved yet'}</div>
                <div className="mt-1 text-xs text-muted">{prompts.length ? 'Try a different word.' : 'Hover a message you sent and press the bookmark to keep it here.'}</div>
              </div>
            ) : (
              shownPrompts.map((p, i) => (
                <div
                  key={p.id}
                  style={{ '--d': `${Math.min(i, 14) * 22}ms` } as CSSProperties}
                  className="anim-rise group relative rounded-xl transition-colors hover:bg-canvas/70"
                >
                  <button onClick={() => onUsePrompt(p.text)} title="Put this prompt in the message box" className="block w-full px-3 py-2.5 pr-9 text-left">
                    <span className="flex items-start gap-2">
                      <Bookmark size={12} className="mt-1 shrink-0 text-accent-600 dark:text-accent-400" />
                      <span className="line-clamp-3 text-[13px] leading-relaxed text-ink">{p.text}</span>
                    </span>
                  </button>
                  <IconButton
                    title="Delete prompt"
                    onClick={() => void db.prompts.delete(p.id)}
                    className="absolute top-1.5 right-1.5 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                  >
                    <Trash size={12} />
                  </IconButton>
                </div>
              ))
            ))}
        </div>

        <div className="border-t border-line px-4 py-3">
          <div className="truncate font-mono text-[10px] text-muted" title={s.chat.model}>
            {s.chat.model}
          </div>
          <UsageMeter compact />
        </div>
      </aside>
    </>
  );
}
