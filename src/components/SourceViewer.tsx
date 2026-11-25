import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db } from '../lib/db';
import { isServerStorage } from '../lib/sync/mode';
import { remote } from '../lib/sync/remote';
import { cn } from '../lib/utils';
import { IconButton } from './ui';

export interface ViewerItem {
  docId: string;
  docName: string;
  /** Highlighted span in the document text; start === end shows the document without a highlight. */
  start: number;
  end: number;
  /** The cited passage, used to re-find it if offsets no longer match. */
  text?: string;
  page?: number;
  headingPath: string[];
}

/** Characters shown on each side of the highlight before "show full document". */
const WINDOW = 8000;

function locate(text: string, item: ViewerItem): [number, number] | null {
  // A widened excerpt joins neighbouring chunks, so only its opening has to line up with the offsets.
  if (item.end > item.start && item.end <= text.length && (!item.text || text.startsWith(item.text.slice(0, 80), item.start))) {
    return [item.start, item.end];
  }
  if (item.text) {
    const i = text.indexOf(item.text);
    if (i !== -1) return [i, i + item.text.length];
  }
  return null;
}

export function SourceViewer({ items, index, onIndex, onClose }: { items: ViewerItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const item = items[Math.min(index, items.length - 1)];
  // undefined while loading, null when there's no copy in this browser
  const docText = useLiveQuery(async () => (await db.docTexts.get(item.docId)) ?? null, [item.docId]);
  const [fetching, setFetching] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const markRef = useRef<HTMLElement>(null);
  const range = useMemo(() => (docText ? locate(docText.text, item) : null), [docText, item]);

  // With server storage, a document added on another device has its text only on the server: fetch and cache it.
  useEffect(() => {
    if (docText !== null || !isServerStorage()) return;
    let alive = true;
    setFetching(item.docId);
    void remote()
      .documentText(item.docId)
      .then((t) => t && db.docTexts.put({ docId: item.docId, text: t.text, pageOffsets: t.pageOffsets }))
      .catch(() => undefined)
      .finally(() => alive && setFetching(null));
    return () => {
      alive = false;
    };
  }, [docText, item.docId]);

  useEffect(() => setFull(false), [item.docId]);
  useEffect(() => {
    markRef.current?.scrollIntoView({ block: 'center' });
  }, [range, full]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.key === 'Escape') onClose();
      else if (!typing && e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1);
      else if (!typing && e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onClose, onIndex]);

  const meta = [item.headingPath.join(' › '), item.page ? `Page ${item.page}` : ''].filter(Boolean).join(' · ') || (range ? 'Cited passage' : 'Full document');

  let body: ReactNode;
  if (docText === undefined || (docText === null && fetching === item.docId)) {
    body = <div className="p-6 text-sm text-muted">Loading…</div>;
  } else if (docText === null) {
    body = (
      <div className="space-y-3 p-6 text-sm">
        <p className="text-amber-700 dark:text-amber-400">This document is no longer in your knowledge base. The cited passage was:</p>
        <blockquote className="border-l-2 border-accent-300 pl-4 whitespace-pre-wrap text-ink">{item.text}</blockquote>
      </div>
    );
  } else {
    const text = docText.text;
    const [s, e] = range ?? [0, 0];
    const from = full ? 0 : Math.max(0, s - WINDOW);
    const to = full ? text.length : Math.min(text.length, e + WINDOW);
    body = (
      <div className="px-5 py-5 text-[13.5px] leading-7 whitespace-pre-wrap break-words text-ink">
        {from > 0 && (
          <button onClick={() => setFull(true)} className="mb-3 block text-xs font-medium text-accent-700 hover:underline dark:text-accent-400">
            … show full document
          </button>
        )}
        {text.slice(from, s)}
        {range && (
          <mark ref={markRef} className="source-highlight">
            {text.slice(s, e)}
          </mark>
        )}
        {text.slice(Math.max(from, e), to)}
        {to < text.length && (
          <button onClick={() => setFull(true)} className="mt-3 block text-xs font-medium text-accent-700 hover:underline dark:text-accent-400">
            show full document …
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Below xl there is no room for a third column, so the pane lies over the chat. */}
      <div className="anim-fade absolute inset-0 z-[55] bg-black/40 xl:hidden" onClick={onClose} />
      <aside
        className="anim-pane-right absolute inset-y-0 right-0 z-[60] flex w-full max-w-xl flex-col border-l border-line bg-surface shadow-2xl xl:static xl:z-auto xl:w-[min(34vw,480px)] xl:max-w-none xl:shrink-0 xl:shadow-none"
        aria-label="Evidence"
      >
        <div className="flex items-start gap-3 border-b border-line px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] tracking-wider text-muted uppercase">
              {items.length > 1 ? `Evidence · ${index + 1} of ${items.length}` : 'Document'}
            </div>
            <div className="mt-1 truncate font-display text-base leading-tight text-ink" title={item.docName}>
              {item.docName}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted">{meta}</div>
          </div>
          <IconButton title="Close (Esc)" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        {items.length > 1 && (
          <div className="flex items-center gap-1 border-b border-line px-3 py-2">
            <IconButton title="Previous source (←)" onClick={() => onIndex(index - 1)} disabled={index === 0}>
              <ChevronLeft size={15} />
            </IconButton>
            {/* One numbered tab per source of the answer, matching the [n] chips in it. */}
            <div className="scrollbar-thin flex min-w-0 flex-1 gap-1 overflow-x-auto" role="tablist" aria-label="Sources">
              {items.map((it, i) => (
                <button
                  key={i}
                  role="tab"
                  aria-selected={i === index}
                  title={it.docName}
                  onClick={() => onIndex(i)}
                  className={cn(
                    'h-7 min-w-7 shrink-0 rounded-md border px-1.5 font-mono text-[11px] font-semibold tabular-nums transition-colors',
                    i === index
                      ? 'border-accent-600 bg-accent-600 text-white'
                      : 'border-line text-muted hover:border-accent-300 hover:text-accent-700 dark:hover:text-accent-300',
                  )}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <IconButton title="Next source (→)" onClick={() => onIndex(index + 1)} disabled={index >= items.length - 1}>
              <ChevronRight size={15} />
            </IconButton>
          </div>
        )}
        {/* Keyed by source, so the text fades in and the marker stroke redraws on each switch. */}
        <div key={`${item.docId}:${item.start}`} className="anim-fade scrollbar-thin flex-1 overflow-y-auto">
          {body}
        </div>
      </aside>
    </>
  );
}
