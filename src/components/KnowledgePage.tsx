import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDown,
  ArrowUp,
  Download,
  FileText,
  Globe,
  Layers,
  LoaderCircle,
  Plus,
  RotateCcw,
  Search,
  StickyNote,
  Trash,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react';
import { createCollection, db, deleteCollection } from '../lib/db';
import { useLocalModelStatus } from '../lib/providers/local';
import { ACCEPTED_FILE_TYPES } from '../lib/rag/fileTypes';
import { ingest, reindexStale, retryDocument } from '../lib/rag/ingest';
import { deleteDocuments } from '../lib/rag/store';
import { useActiveEmbeddingKey } from '../lib/sync/mode';
import type { Collection, KbDocument } from '../lib/types';
import { cn, plural } from '../lib/utils';
import { exportBackup, exportCollection, importFile } from './kbActions';
import { toast } from './Toaster';
import { Menu, MenuItem } from './Menu';
import { buttonClass, Field, IconButton, iconButtonClass, inputClass, Modal, primaryButtonClass } from './ui';

type SortKey = 'name' | 'status' | 'size' | 'added';
type Sort = { key: SortKey; dir: 1 | -1 };

/** Working documents first, then problems, then the ready ones. */
const STATUS_ORDER: Record<KbDocument['status'], number> = { parsing: 0, embedding: 0, queued: 1, error: 2, ready: 3 };

const COMPARE: Record<SortKey, (a: KbDocument, b: KbDocument) => number> = {
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  size: (a, b) => a.chunkCount - b.chunkCount,
  added: (a, b) => a.createdAt - b.createdAt,
};

const formatDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Which collections a document belongs to, ticked on and off from its row. */
function CollectionMenu({ doc, collections }: { doc: KbDocument; collections: Collection[] }) {
  const toggle = (id: string) => {
    const next = doc.collectionIds.includes(id) ? doc.collectionIds.filter((c) => c !== id) : [...doc.collectionIds, id];
    void db.documents.update(doc.id, { collectionIds: next });
  };
  return (
    <Menu
      label={`Collections for ${doc.name}`}
      title="Collections"
      heading="In collections"
      panelClassName="w-52"
      button={<Layers size={13} />}
      buttonClassName={(open) => cn(iconButtonClass, open && 'bg-canvas text-ink')}
    >
      {collections.map((c) => (
        <MenuItem key={c.id} kind="checkbox" label={c.name} swatch={c.color} checked={doc.collectionIds.includes(c.id)} onSelect={() => toggle(c.id)} />
      ))}
    </Menu>
  );
}

function StatusCell({ doc, stale }: { doc: KbDocument; stale: boolean }) {
  if (doc.status === 'error') {
    return (
      <span className="line-clamp-2 text-red-600 dark:text-red-400" title={doc.error}>
        {doc.error ?? 'Failed'}
      </span>
    );
  }
  if (doc.status === 'ready') {
    return (
      <span className={cn('flex items-center gap-1.5', stale ? 'text-amber-700 dark:text-amber-500' : 'text-muted')}>
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', stale ? 'bg-amber-500' : 'bg-emerald-500')} />
        {stale ? 'Keyword search only' : 'Ready'}
      </span>
    );
  }
  const label = doc.status === 'embedding' ? `Indexing ${Math.round(doc.progress * 100)}%` : doc.status === 'parsing' ? 'Reading' : 'Queued';
  return (
    <span className="block text-muted">
      {label}
      {doc.status === 'embedding' && (
        <span className="mt-1 block h-1 w-24 overflow-hidden rounded-full bg-line">
          <span className="block h-full rounded-full bg-accent-500 transition-[width] duration-500" style={{ width: `${Math.max(4, doc.progress * 100)}%` }} />
        </span>
      )}
    </span>
  );
}

function DocRow({
  doc,
  index,
  stale,
  selected,
  collections,
  onSelect,
  onView,
}: {
  doc: KbDocument;
  index: number;
  stale: boolean;
  selected: boolean;
  collections: Collection[];
  onSelect: (on: boolean) => void;
  onView: () => void;
}) {
  const working = doc.status === 'queued' || doc.status === 'parsing' || doc.status === 'embedding';
  const docCollections = collections.filter((c) => doc.collectionIds.includes(c.id));
  const Icon = doc.sourceType === 'url' ? Globe : doc.sourceType === 'text' ? StickyNote : FileText;

  return (
    <tr
      style={{ '--d': `${Math.min(index, 14) * 22}ms` } as CSSProperties}
      className={cn('anim-rise group border-b border-line transition-colors', selected ? 'bg-accent-50 dark:bg-accent-950/40' : 'hover:bg-canvas/60')}
    >
      <td className="w-10 py-2.5 pl-4">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={`Select ${doc.name}`}
          className="accent-accent-600"
        />
      </td>
      <td className="max-w-0 py-2.5 pr-4">
        <div className="flex items-center gap-2.5">
          <span className={cn('shrink-0', doc.status === 'error' ? 'text-red-500' : 'text-muted')}>
            {working ? <LoaderCircle size={15} className="animate-spin" /> : <Icon size={15} />}
          </span>
          <button
            onClick={onView}
            disabled={!doc.charCount}
            className="min-w-0 truncate text-left text-[13px] font-medium text-ink hover:text-accent-700 hover:underline disabled:hover:text-ink disabled:hover:no-underline dark:hover:text-accent-300"
            title={doc.charCount ? `Read ${doc.name}` : doc.name}
          >
            {doc.name}
          </button>
        </div>
        {/* On phones the other columns are hidden, so the status sits under the name. */}
        <div className="mt-1 pl-[25px] text-[11px] sm:hidden">
          <StatusCell doc={doc} stale={stale} />
        </div>
      </td>
      <td className="hidden py-2.5 pr-4 text-xs text-muted lg:table-cell">
        {docCollections.length ? (
          <span className="flex flex-wrap gap-x-3 gap-y-0.5">
            {docCollections.map((c) => (
              <span key={c.id} className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.color }} />
                <span className="max-w-[120px] truncate">{c.name}</span>
              </span>
            ))}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="hidden w-48 py-2.5 pr-4 text-xs sm:table-cell">
        <StatusCell doc={doc} stale={stale} />
      </td>
      <td className="hidden w-32 py-2.5 pr-4 text-right font-mono text-[11px] text-muted tabular-nums md:table-cell">
        {doc.chunkCount ? (
          <>
            {plural(doc.chunkCount, 'chunk')}
            {doc.pageCount ? <span className="block">{plural(doc.pageCount, 'page')}</span> : null}
          </>
        ) : (
          '—'
        )}
      </td>
      <td className="hidden w-28 py-2.5 pr-4 font-mono text-[11px] whitespace-nowrap text-muted md:table-cell">{formatDate(doc.createdAt)}</td>
      <td className="relative w-24 py-2.5 pr-3 text-right">
        <div className="flex justify-end sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          {doc.status === 'error' && (
            <IconButton title="Retry" onClick={() => void retryDocument(doc.id)}>
              <RotateCcw size={13} />
            </IconButton>
          )}
          {collections.length > 0 && <CollectionMenu doc={doc} collections={collections} />}
          <IconButton
            title="Remove"
            onClick={() => {
              if (confirm(`Remove “${doc.name}” from your knowledge base?`)) void deleteDocuments([doc.id]);
            }}
          >
            <Trash size={13} />
          </IconButton>
        </div>
      </td>
    </tr>
  );
}

function SortHeader({ label, k, sort, onSort, className }: { label: string; k: SortKey; sort: Sort; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort.key === k;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={cn('py-2 pr-4 font-normal', className)}>
      <button onClick={() => onSort(k)} className={cn('inline-flex items-center gap-1 transition-colors hover:text-ink', active && 'text-ink')}>
        {label}
        {active && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
}

/** The knowledge base as a page: collections down the side, every document in a sortable table. */
export function KnowledgePage({ onViewDocument }: { onViewDocument: (doc: KbDocument) => void }) {
  const collections = useLiveQuery(() => db.collections.orderBy('createdAt').toArray(), [], [] as Collection[]);
  const docs = useLiveQuery(() => db.documents.orderBy('createdAt').reverse().toArray(), [], [] as KbDocument[]);
  const models = useLocalModelStatus();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modal, setModal] = useState<'url' | 'note' | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<Sort>({ key: 'added', dir: -1 });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const active = collections.find((c) => c.id === activeId) ?? null;
  const key = useActiveEmbeddingKey();
  const isStale = (d: KbDocument) => d.status === 'ready' && d.embeddingKey !== key;
  const staleCount = docs.filter(isStale).length;
  const target = active ? [active.id] : [];
  const downloading = models.filter((m) => m.state === 'downloading');

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return docs
      .filter((d) => (!active || d.collectionIds.includes(active.id)) && (!needle || d.name.toLowerCase().includes(needle)))
      .sort((a, b) => COMPARE[sort.key](a, b) * sort.dir);
  }, [docs, active, filter, sort]);
  // Only documents still on screen count as selected: one filtered out or removed can't be acted on unseen.
  const selected = visible.filter((d) => picked.has(d.id));
  const allSelected = visible.length > 0 && selected.length === visible.length;

  const onSort = (k: SortKey) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 1 ? -1 : 1 } : { key: k, dir: k === 'name' ? 1 : -1 }));
  const pick = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const addFiles = (files: Iterable<File>) => {
    let count = 0;
    for (const file of files) {
      count++;
      ingest({ kind: 'file', file }, target).catch(() => undefined);
    }
    if (count) toast(`Adding ${plural(count, 'file')}${active ? ` to ${active.name}` : ''}…`);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const submitCollection = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
    if (name) setActiveId((await createCollection(name)).id);
    setCreating(false);
  };

  const submitRename = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') ?? '')
      .trim()
      .slice(0, 200);
    if (active && name) await db.collections.update(active.id, { name });
    setRenaming(false);
  };

  const submitUrl = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const url = String(new FormData(e.currentTarget).get('url') ?? '').trim();
    try {
      new URL(url);
    } catch {
      toast('Enter a full URL starting with https://', 'error');
      return;
    }
    ingest({ kind: 'url', url }, target).catch(() => undefined);
    setModal(null);
  };

  const submitNote = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const text = String(data.get('text') ?? '');
    if (!text.trim()) return;
    ingest({ kind: 'text', name: String(data.get('name') ?? '').trim() || 'Untitled note', text }, target).catch(() => undefined);
    setModal(null);
  };

  const addSelectedTo = async (collectionId: string) => {
    const name = collections.find((c) => c.id === collectionId)?.name ?? 'the collection';
    await db.transaction('rw', db.documents, () =>
      Promise.all(
        selected.map((d) =>
          d.collectionIds.includes(collectionId) ? undefined : db.documents.update(d.id, { collectionIds: [...d.collectionIds, collectionId] }),
        ),
      ),
    );
    toast(`Added ${plural(selected.length, 'document')} to ${name}.`, 'success');
  };

  const removeSelected = async () => {
    if (!confirm(`Remove ${plural(selected.length, 'document')} from your knowledge base? This can't be undone.`)) return;
    await deleteDocuments(selected.map((d) => d.id));
    setPicked(new Set());
  };

  const ready = docs.filter((d) => d.status === 'ready').length;
  const indexing = docs.filter((d) => d.status === 'queued' || d.status === 'parsing' || d.status === 'embedding');
  const chunks = docs.reduce((n, d) => n + d.chunkCount, 0);
  const tabs = [{ id: null as string | null, name: 'All documents', color: undefined as string | undefined, count: docs.length }].concat(
    collections.map((c) => ({ id: c.id, name: c.name, color: c.color, count: docs.filter((d) => d.collectionIds.includes(c.id)).length })),
  );

  return (
    <div
      className="relative flex h-full flex-col bg-surface"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="anim-rise flex flex-wrap items-end gap-x-6 gap-y-4 px-5 pt-6 pb-5 sm:px-7">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl leading-none text-ink">Knowledge</h1>
          <p className="mt-2 font-mono text-[11px] text-muted">
            {docs.length
              ? `${plural(docs.length, 'document')} · ${ready} ready · ${chunks.toLocaleString()} ${chunks === 1 ? 'chunk' : 'chunks'}`
              : 'Everything CaptBot can cite lives here.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button className={buttonClass} onClick={() => setModal('url')}>
            <Globe size={13} /> Web page
          </button>
          <button className={buttonClass} onClick={() => setModal('note')}>
            <StickyNote size={13} /> Note
          </button>
          <button className={buttonClass} onClick={() => void exportBackup()} title="Download documents, collections and chats as one file">
            <Download size={13} /> Backup
          </button>
          <button className={buttonClass} onClick={() => importRef.current?.click()} title="Restore a backup or add a knowledge pack">
            <Upload size={13} /> Import
          </button>
          <button className={primaryButtonClass} onClick={() => fileRef.current?.click()}>
            <Plus size={14} /> Add files
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPTED_FILE_TYPES}
          hidden
          onChange={(e) => {
            addFiles(e.target.files ?? []);
            e.target.value = '';
          }}
        />
        <input
          ref={importRef}
          type="file"
          accept=".captbot,.gz,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
            e.target.value = '';
          }}
        />
      </header>

      {/* Like the conversation, the knowledge base sits in an inset panel. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas md:mx-3 md:mb-3 md:flex-row md:rounded-2xl md:border md:border-line">
        {/* Collections: a column on wide screens, a scrolling strip on phones. */}
        <aside className="shrink-0 border-line max-md:border-b md:w-60 md:overflow-y-auto md:border-r md:py-4" aria-label="Collections">
          <div className="hidden items-center justify-between px-5 pb-2 md:flex">
            <h2 className="font-mono text-[10px] tracking-wider text-muted uppercase">Collections</h2>
            <IconButton title="New collection" onClick={() => setCreating(true)}>
              <Plus size={14} />
            </IconButton>
          </div>
          <div className="scrollbar-thin flex gap-1 overflow-x-auto px-3 py-2 md:flex-col md:py-0">
            {tabs.map((c) => (
              <button
                key={c.id ?? 'all'}
                onClick={() => {
                  setActiveId(c.id);
                  setRenaming(false);
                }}
                aria-current={activeId === c.id ? 'true' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors',
                  activeId === c.id ? 'bg-accent-50 font-medium text-accent-800 dark:bg-accent-950/50 dark:text-accent-200' : 'text-ink hover:bg-canvas',
                )}
              >
                {c.color ? (
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />
                ) : (
                  <Layers size={13} className="shrink-0 text-muted" />
                )}
                <span className="max-w-[140px] min-w-0 flex-1 truncate">{c.name}</span>
                <span className="font-mono text-[11px] text-muted tabular-nums">{c.count}</span>
              </button>
            ))}
            <button
              onClick={() => setCreating(true)}
              className="flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:bg-canvas md:hidden"
            >
              <Plus size={13} /> New
            </button>
          </div>
          {creating && (
            <form onSubmit={submitCollection} className="flex gap-1.5 px-3 pt-2 max-md:pb-2">
              <input
                name="name"
                autoFocus
                placeholder="Collection name"
                aria-label="Collection name"
                className={cn(inputClass, 'py-1.5 text-xs')}
                onBlur={(e) => !e.target.value && setCreating(false)}
              />
              <button className={primaryButtonClass}>Add</button>
            </form>
          )}
          {active &&
            !creating &&
            (renaming ? (
              <form onSubmit={submitRename} className="flex gap-1.5 px-3 pt-3 max-md:pb-2">
                <input name="name" autoFocus defaultValue={active.name} aria-label="Collection name" className={cn(inputClass, 'py-1.5 text-xs')} />
                <button className={primaryButtonClass}>Save</button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-3 text-[11px] text-muted max-md:pb-2">
                <button onClick={() => setRenaming(true)} className="hover:text-accent-700 hover:underline dark:hover:text-accent-300">
                  Rename
                </button>
                <button onClick={() => void exportCollection(active)} className="hover:text-accent-700 hover:underline dark:hover:text-accent-300">
                  Export as pack
                </button>
                <button
                  onClick={async () => {
                    if (!confirm(`Delete the collection “${active.name}”? Its documents stay in your knowledge base.`)) return;
                    await deleteCollection(active.id);
                    setActiveId(null);
                  }}
                  className="hover:text-red-600 hover:underline"
                >
                  Delete
                </button>
              </div>
            ))}
        </aside>

        <section className="scrollbar-thin min-w-0 flex-1 overflow-y-auto" aria-label={active ? active.name : 'All documents'}>
          <div className="sticky top-0 z-20 flex min-h-[52px] flex-wrap items-center gap-2 border-b border-line bg-canvas px-4 py-2">
            {selected.length > 0 ? (
              <div className="anim-fade flex flex-1 flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-ink">{selected.length} selected</span>
                {collections.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => e.target.value && void addSelectedTo(e.target.value)}
                    aria-label="Add selected documents to a collection"
                    className={cn(inputClass, 'w-auto py-1 text-xs')}
                  >
                    <option value="">Add to collection…</option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
                <button onClick={() => void removeSelected()} className={cn(buttonClass, 'text-red-600 dark:text-red-400')}>
                  <Trash size={13} /> Remove
                </button>
                <button onClick={() => setPicked(new Set())} className="ml-auto text-muted hover:text-ink hover:underline">
                  Clear selection
                </button>
              </div>
            ) : (
              <>
                <label className="relative block w-full max-w-xs">
                  <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
                  <input
                    type="search"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder={`Filter ${active ? active.name : 'documents'}`}
                    aria-label="Filter documents by name"
                    className={cn(inputClass, 'py-1.5 pl-8 text-xs')}
                  />
                </label>
                <span className="ml-auto font-mono text-[11px] text-muted">
                  {visible.length === docs.length ? plural(docs.length, 'document') : `${visible.length} of ${docs.length}`}
                </span>
              </>
            )}
          </div>

          {docs.length > 0 && (
            <div className="space-y-3 px-4 pt-4">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="lift flex w-full items-center gap-4 rounded-2xl border-2 border-dashed border-line bg-surface px-5 py-4 text-left hover:border-accent-500"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-500/15 text-accent-700 dark:text-accent-300">
                  <Upload size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-ink">Drop files here, or click to browse</span>
                  <span className="block text-xs text-muted">
                    PDF (scanned ones too), DOCX, HTML, Markdown, text, CSV and JSON{active ? `, added to ${active.name}` : ''}
                  </span>
                </span>
              </button>
              {indexing.length > 0 && (
                <div className="anim-rise rounded-2xl border border-line bg-surface p-4" aria-live="polite">
                  <div className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
                    <LoaderCircle size={15} className="animate-spin text-accent-600 dark:text-accent-400" />
                    Indexing {plural(indexing.length, 'document')}
                  </div>
                  <ul className="space-y-2.5">
                    {indexing.map((d) => {
                      const known = d.status === 'embedding';
                      return (
                        <li key={d.id}>
                          <div className="flex justify-between gap-3 text-xs">
                            <span className="truncate font-medium text-ink">{d.name}</span>
                            <span className="shrink-0 text-muted tabular-nums">
                              {known ? `${Math.round(d.progress * 100)}%` : d.status === 'parsing' ? 'Reading' : 'Waiting'}
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-canvas ring-1 ring-line">
                            <div
                              className={cn('h-full rounded-full bg-accent-500 transition-[width] duration-500', !known && 'animate-pulse')}
                              style={{ width: `${known ? Math.max(4, d.progress * 100) : 12}%` }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          {downloading.map((m) => (
            <div key={m.model} className="flex items-center gap-2 border-b border-line px-5 py-2 text-xs text-muted">
              <LoaderCircle size={12} className="animate-spin" />
              Downloading {m.model.split('/').pop()} ({Math.round(m.progress)}%), one time only
            </div>
          ))}

          {staleCount > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              <TriangleAlert size={14} className="shrink-0" />
              <span className="min-w-0 flex-1">
                {plural(staleCount, 'document')} {staleCount === 1 ? 'was' : 'were'} indexed with a different embedding model and only match by keyword.
              </span>
              <button
                onClick={async () => toast(`Re-indexing ${plural(await reindexStale(), 'document')}…`)}
                className="rounded-md bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-700"
              >
                Re-index now
              </button>
            </div>
          )}

          {visible.length === 0 ? (
            <div className="anim-rise mx-auto max-w-md px-6 py-16 text-center">
              {docs.length === 0 || (active && !filter) ? (
                <>
                  <h2 className="font-display text-2xl text-ink">{active ? `Nothing in ${active.name} yet` : 'Start with a document'}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    Drop files anywhere on this page, or add them here. PDF (scanned ones too), DOCX, HTML, Markdown, text, CSV and JSON are read, split into
                    passages and indexed, so answers can cite them.
                  </p>
                  <button className={cn(primaryButtonClass, 'mt-5')} onClick={() => fileRef.current?.click()}>
                    <Upload size={14} /> Add files
                  </button>
                </>
              ) : (
                <>
                  <h2 className="text-sm font-semibold text-ink">No documents match “{filter.trim()}”</h2>
                  <button onClick={() => setFilter('')} className="mt-2 text-sm text-accent-700 hover:underline dark:text-accent-300">
                    Clear the filter
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="m-4 rounded-2xl border border-line bg-surface">
              <table className="w-full table-fixed border-collapse text-left">
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-wider text-muted uppercase">
                    <th scope="col" className="w-10 py-2 pl-4">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => setPicked(e.target.checked ? new Set(visible.map((d) => d.id)) : new Set())}
                        aria-label="Select all documents shown"
                        className="accent-accent-600"
                      />
                    </th>
                    <SortHeader label="Name" k="name" sort={sort} onSort={onSort} />
                    <th scope="col" className="hidden py-2 pr-4 font-normal lg:table-cell">
                      Collections
                    </th>
                    <SortHeader label="Status" k="status" sort={sort} onSort={onSort} className="hidden w-48 sm:table-cell" />
                    <SortHeader label="Size" k="size" sort={sort} onSort={onSort} className="hidden w-32 text-right md:table-cell" />
                    <SortHeader label="Added" k="added" sort={sort} onSort={onSort} className="hidden w-28 md:table-cell" />
                    <th scope="col" className="w-24 py-2 pr-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((doc, i) => (
                    <DocRow
                      key={doc.id}
                      doc={doc}
                      index={i}
                      stale={isStale(doc)}
                      selected={picked.has(doc.id)}
                      collections={collections}
                      onSelect={(on) => pick(doc.id, on)}
                      onView={() => onViewDocument(doc)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {dragging && (
        <div className="anim-fade pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-accent-500 bg-accent-50/90 dark:bg-accent-950/90">
          <div className="text-center">
            <Upload size={26} className="mx-auto text-accent-700 dark:text-accent-300" />
            <div className="mt-2 font-display text-2xl text-accent-800 dark:text-accent-200">Drop to add{active ? ` to ${active.name}` : ''}</div>
          </div>
        </div>
      )}

      <Modal open={modal === 'url'} onClose={() => setModal(null)} title="Add a web page">
        <form onSubmit={submitUrl} className="space-y-4 p-5">
          <Field
            label="URL"
            hint="The page is fetched from your browser. Sites that block cross-origin requests need a reader proxy (Settings → Knowledge sources)."
          >
            <input name="url" type="url" required autoFocus placeholder="https://example.com/article" className={inputClass} />
          </Field>
          <div className="flex justify-end">
            <button className={primaryButtonClass}>Add page</button>
          </div>
        </form>
      </Modal>

      <Modal open={modal === 'note'} onClose={() => setModal(null)} title="Add a note">
        <form onSubmit={submitNote} className="space-y-4 p-5">
          <Field label="Title">
            <input name="name" autoFocus placeholder="Meeting notes, 12 Sep" className={inputClass} />
          </Field>
          <Field label="Text" hint="Markdown headings (#, ##) become sections for chunking and citations.">
            <textarea name="text" required rows={10} className={cn(inputClass, 'scrollbar-thin resize-y font-mono text-xs')} />
          </Field>
          <div className="flex justify-end">
            <button className={primaryButtonClass}>Add note</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
