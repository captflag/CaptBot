import { useLiveQuery } from 'dexie-react-hooks';
import { Download, FileText, Globe, Layers, LoaderCircle, Plus, RotateCcw, StickyNote, Trash, TriangleAlert, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { createCollection, db, deleteCollection } from '../lib/db';
import { useLocalModelStatus } from '../lib/providers/local';
import { ingest, reindexStale, retryDocument } from '../lib/rag/ingest';
import { ACCEPTED_FILE_TYPES } from '../lib/rag/fileTypes';
import { deleteDocuments } from '../lib/rag/store';
import { useActiveEmbeddingKey } from '../lib/sync/mode';
import type { Collection, KbDocument } from '../lib/types';
import { cn, plural } from '../lib/utils';
import { exportBackup, exportCollection, importFile } from './kbActions';
import { toast } from './Toaster';
import { buttonClass, Field, IconButton, inputClass, Modal, primaryButtonClass } from './ui';

const sectionTitle = 'text-[11px] font-semibold tracking-wider text-gray-400 uppercase';

function CollectionMenu({ doc, collections, onClose }: { doc: KbDocument; collections: Collection[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose]);
  const toggle = (id: string) => {
    const next = doc.collectionIds.includes(id) ? doc.collectionIds.filter((c) => c !== id) : [...doc.collectionIds, id];
    void db.documents.update(doc.id, { collectionIds: next });
  };
  return (
    <div ref={ref} className="absolute top-9 right-2 z-30 w-48 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-gray-800 dark:bg-[#111]">
      <div className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-gray-400">In collections</div>
      {collections.map((c) => (
        <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-white/10">
          <input type="checkbox" checked={doc.collectionIds.includes(c.id)} onChange={() => toggle(c.id)} className="accent-violet-600" />
          <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
          <span className="truncate">{c.name}</span>
        </label>
      ))}
    </div>
  );
}

function DocRow({ doc, stale, collections, onView }: { doc: KbDocument; stale: boolean; collections: Collection[]; onView: () => void }) {
  const [menu, setMenu] = useState(false);
  const working = doc.status === 'queued' || doc.status === 'parsing' || doc.status === 'embedding';
  const status =
    doc.status === 'ready'
      ? `${plural(doc.chunkCount, 'chunk')}${doc.pageCount ? ` · ${plural(doc.pageCount, 'page')}` : ''}${stale ? ' · keyword search only' : ''}`
      : doc.status === 'error'
        ? (doc.error ?? 'Failed')
        : doc.status === 'embedding'
          ? `Embedding ${Math.round(doc.progress * 100)}%`
          : doc.status === 'parsing'
            ? 'Reading…'
            : 'Queued';
  const docCollections = collections.filter((c) => doc.collectionIds.includes(c.id));
  const Icon = doc.sourceType === 'url' ? Globe : doc.sourceType === 'text' ? StickyNote : FileText;

  return (
    <div className="group relative rounded-xl border border-gray-100 bg-white/70 p-2.5 transition hover:border-violet-200 dark:border-gray-800 dark:bg-white/5 dark:hover:border-violet-900">
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            'mt-0.5 rounded-lg p-1.5',
            doc.status === 'error' ? 'bg-red-50 text-red-500 dark:bg-red-950/40' : 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300',
          )}
        >
          {working ? <LoaderCircle size={14} className="animate-spin" /> : <Icon size={14} />}
        </div>
        <div className="min-w-0 flex-1">
          <button
            onClick={onView}
            disabled={!doc.charCount}
            className="block w-full truncate text-left text-xs font-medium text-gray-900 hover:text-violet-700 disabled:hover:text-gray-900 dark:text-gray-100 dark:hover:text-violet-300"
            title={doc.charCount ? `View ${doc.name}` : doc.name}
          >
            {doc.name}
          </button>
          <div className={cn('line-clamp-2 text-[11px]', doc.status === 'error' ? 'text-red-500' : stale ? 'text-amber-600' : 'text-gray-400')} title={status}>
            {status}
          </div>
          {docCollections.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {docCollections.map((c) => (
                <span key={c.id} className="flex items-center gap-1 rounded-full bg-gray-100 px-1.5 py-px text-[10px] text-gray-600 dark:bg-white/10 dark:text-gray-300">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
                  {c.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center sm:opacity-0 sm:group-hover:opacity-100">
          {doc.status === 'error' && (
            <IconButton title="Retry" onClick={() => void retryDocument(doc.id)}>
              <RotateCcw size={13} />
            </IconButton>
          )}
          {collections.length > 0 && (
            // Stop the menu's outside-click handler from closing it just before this toggle reopens it.
            <span onMouseDown={(e) => e.stopPropagation()}>
              <IconButton title="Collections" onClick={() => setMenu((m) => !m)}>
                <Layers size={13} />
              </IconButton>
            </span>
          )}
          <IconButton
            title="Remove"
            onClick={() => {
              if (confirm(`Remove “${doc.name}” from your knowledge base?`)) void deleteDocuments([doc.id]);
            }}
          >
            <Trash size={13} />
          </IconButton>
        </div>
      </div>
      {doc.status === 'embedding' && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
          <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${Math.max(4, doc.progress * 100)}%` }} />
        </div>
      )}
      {menu && <CollectionMenu doc={doc} collections={collections} onClose={() => setMenu(false)} />}
    </div>
  );
}

export function KnowledgePanel({ onViewDocument }: { onViewDocument: (doc: KbDocument) => void }) {
  const collections = useLiveQuery(() => db.collections.orderBy('createdAt').toArray(), [], [] as Collection[]);
  const docs = useLiveQuery(() => db.documents.orderBy('createdAt').reverse().toArray(), [], [] as KbDocument[]);
  const models = useLocalModelStatus();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modal, setModal] = useState<'url' | 'note' | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const active = collections.find((c) => c.id === activeId) ?? null;
  const key = useActiveEmbeddingKey();
  const isStale = (d: KbDocument) => d.status === 'ready' && d.embeddingKey !== key;
  const staleCount = docs.filter(isStale).length;
  const visible = active ? docs.filter((d) => d.collectionIds.includes(active.id)) : docs;
  const target = active ? [active.id] : [];
  const downloading = models.filter((m) => m.state === 'downloading');

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
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim().slice(0, 200);
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

  return (
    <div
      className={cn('relative space-y-5 pb-4', dragging && 'rounded-xl ring-2 ring-violet-400 ring-offset-4 dark:ring-offset-black')}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className={sectionTitle}>Collections</h3>
          <IconButton title="New collection" onClick={() => setCreating(true)}>
            <Plus size={14} />
          </IconButton>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[{ id: null, name: 'All', color: undefined, count: docs.length }, ...collections.map((c) => ({ ...c, count: docs.filter((d) => d.collectionIds.includes(c.id)).length }))].map((c) => (
            <button
              key={c.id ?? 'all'}
              onClick={() => {
                setActiveId(c.id);
                setRenaming(false);
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition',
                activeId === c.id
                  ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-white/5 dark:text-gray-300',
              )}
            >
              {c.color && <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />}
              <span className="max-w-[120px] truncate">{c.name}</span>
              <span className="text-gray-400">{c.count}</span>
            </button>
          ))}
        </div>
        {creating && (
          <form onSubmit={submitCollection} className="flex gap-1.5">
            <input name="name" autoFocus placeholder="Collection name" className={cn(inputClass, 'py-1.5 text-xs')} onBlur={(e) => !e.target.value && setCreating(false)} />
            <button className={primaryButtonClass}>Add</button>
          </form>
        )}
        {active && !creating && (
          renaming ? (
            <form onSubmit={submitRename} className="flex gap-1.5">
              <input name="name" autoFocus defaultValue={active.name} className={cn(inputClass, 'py-1.5 text-xs')} />
              <button className={primaryButtonClass}>Save</button>
            </form>
          ) : (
            <div className="flex items-center gap-2 text-[11px] text-gray-500">
              <button onClick={() => setRenaming(true)} className="hover:text-violet-600">Rename</button>
              <span>·</span>
              <button onClick={() => void exportCollection(active)} className="hover:text-violet-600">Export as pack</button>
              <span>·</span>
              <button
                onClick={async () => {
                  if (!confirm(`Delete the collection “${active.name}”? Its documents stay in your knowledge base.`)) return;
                  await deleteCollection(active.id);
                  setActiveId(null);
                }}
                className="hover:text-red-600"
              >
                Delete
              </button>
            </div>
          )
        )}
      </section>

      <section className="space-y-2">
        <h3 className={sectionTitle}>Add to {active ? active.name : 'knowledge'}</h3>
        <div className="grid grid-cols-3 gap-1.5">
          <button className={buttonClass} onClick={() => fileRef.current?.click()}>
            <Upload size={13} /> Files
          </button>
          <button className={buttonClass} onClick={() => setModal('url')}>
            <Globe size={13} /> Web page
          </button>
          <button className={buttonClass} onClick={() => setModal('note')}>
            <StickyNote size={13} /> Note
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
        {downloading.map((m) => (
          <div key={m.model} className="flex items-center gap-2 text-[11px] text-gray-500">
            <LoaderCircle size={12} className="animate-spin" />
            Downloading {m.model.split('/').pop()} ({Math.round(m.progress)}%), one time only
          </div>
        ))}
      </section>

      {staleCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          <div className="flex gap-2">
            <TriangleAlert size={14} className="mt-px shrink-0" />
            <span>
              {plural(staleCount, 'document')} {staleCount === 1 ? 'was' : 'were'} indexed with a different embedding model and only match by keyword.
            </span>
          </div>
          <button
            onClick={async () => toast(`Re-indexing ${plural(await reindexStale(), 'document')}…`)}
            className="mt-2 ml-6 rounded-md bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-700"
          >
            Re-index now
          </button>
        </div>
      )}

      <section className="space-y-2">
        <h3 className={sectionTitle}>
          {active ? active.name : 'All documents'} <span className="font-normal">({visible.length})</span>
        </h3>
        {visible.length === 0 ? (
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-xl border-2 border-dashed border-gray-200 px-4 py-8 text-center text-xs text-gray-400 transition hover:border-violet-300 hover:text-violet-600 dark:border-gray-800"
          >
            <Upload size={22} className="mx-auto mb-2 opacity-60" />
            Drop files here or click to upload
            <span className="mt-1 block opacity-70">PDF, DOCX, HTML, Markdown, text, CSV, JSON</span>
          </button>
        ) : (
          <div className="space-y-1.5">
            {visible.map((doc) => (
              <DocRow key={doc.id} doc={doc} stale={isStale(doc)} collections={collections} onView={() => onViewDocument(doc)} />
            ))}
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-1.5 border-t border-gray-100 pt-4 dark:border-gray-800">
        <button className={buttonClass} onClick={() => void exportBackup()} title="Download documents, collections and chats as one file">
          <Download size={13} /> Backup
        </button>
        <button className={buttonClass} onClick={() => importRef.current?.click()} title="Restore a backup or add a knowledge pack">
          <Upload size={13} /> Import
        </button>
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
      </section>

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
