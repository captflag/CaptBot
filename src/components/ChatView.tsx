import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDown,
  ArrowRight,
  Ellipsis,
  FileText,
  KeyRound,
  PanelLeft,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Star,
  Trash,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useChat, type SendInput } from '../hooks/useChat';
import { serverTierAvailable } from '../lib/auth/session';
import { db, deleteThread, scopedReadyDocIds, uid } from '../lib/db';
import { errorText } from '../lib/rag/json';
import { CHAT_PRESETS, hasChatKey, useSettings } from '../lib/settings';
import { toggleStar, useStarred } from '../lib/stars';
import type { ChatMessage } from '../lib/types';
import { cn, dayGroup, plural } from '../lib/utils';
import { Composer } from './Composer';
import { Logo } from './Logo';
import { MessageItem } from './MessageItem';
import { ScopePicker } from './ScopePicker';
import type { ViewerItem } from './SourceViewer';
import { toast } from './Toaster';
import { Menu, MenuItem } from './Menu';
import { buttonClass, IconButton, iconButtonClass, inputClass, primaryButtonClass } from './ui';

const DOC_SUGGESTIONS = [
  { title: 'Summarize my knowledge', prompt: 'Summarize the key themes across my documents.' },
  { title: 'Find disagreements', prompt: 'Where do my documents disagree or contradict each other?' },
  { title: 'Build a briefing', prompt: 'Write a one-page briefing on the most important facts in my documents.' },
];
const GENERAL_SUGGESTIONS = [
  { title: 'How does this work?', prompt: 'Explain how you use my documents to answer questions, in plain terms.' },
  { title: 'Plan a research doc', prompt: 'What documents should I add to research the EU AI Act, and what questions should I ask?' },
  { title: 'Compare frameworks', prompt: 'Compare GDPR and CCPA in a table.' },
];

interface ChatAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
}

/** The ⋯ button in the chat header and the actions behind it. */
function ChatMenu({ items }: { items: ChatAction[] }) {
  return (
    <Menu
      label="Chat options"
      button={<Ellipsis size={18} />}
      buttonClassName={(open) => cn(iconButtonClass, open && 'bg-canvas text-ink')}
      panelClassName="w-52"
    >
      {items.map((item) => (
        <MenuItem key={item.label} label={item.label} icon={item.icon} danger={item.danger} onSelect={item.onClick} />
      ))}
    </Menu>
  );
}

interface Props {
  threadId: string | null;
  onThreadCreated: (id: string) => void;
  pendingScope: string[];
  onPendingScope: (ids: string[]) => void;
  listOpen: boolean;
  onToggleList: () => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onOpenKnowledge: () => void;
  onOpenSources: (items: ViewerItem[], index: number) => void;
  onOpenSearch: () => void;
  /** Told whenever a reply starts or stops being written. */
  onBusy: (busy: boolean) => void;
  seed: { text: string; nonce: number } | null;
}

export function ChatView({
  threadId,
  onThreadCreated,
  pendingScope,
  onPendingScope,
  listOpen,
  onToggleList,
  onNewChat,
  onOpenSettings,
  onOpenKnowledge,
  onOpenSources,
  onOpenSearch,
  onBusy,
  seed,
}: Props) {
  const settings = useSettings();
  const thread = useLiveQuery(async () => (threadId ? ((await db.threads.get(threadId)) ?? null) : null), [threadId]);
  const collectionIds = useLiveQuery(() => db.collections.toCollection().primaryKeys(), [], [] as string[]);
  // Drop collections deleted since they were picked, so a stale id can't silently switch retrieval off.
  const scope = useMemo(() => (thread?.collectionIds ?? pendingScope).filter((id) => collectionIds.includes(id)), [thread, pendingScope, collectionIds]);
  const newThreadScope = useMemo(() => pendingScope.filter((id) => collectionIds.includes(id)), [pendingScope, collectionIds]);
  const { messages, busy, liveId, send, stop, retry, edit, togglePin, decide } = useChat(threadId, onThreadCreated, newThreadScope);
  const scopedDocs = useLiveQuery(() => scopedReadyDocIds(scope), [scope.join('|')])?.size ?? 0;
  const totalDocs = useLiveQuery(() => db.documents.count(), [], 0);
  const readyDocs = useLiveQuery(() => db.documents.where('status').equals('ready').count(), [], 0);
  // Signed-in users without their own key can still chat on the free tier.
  const keyReady = hasChatKey(settings) || serverTierAvailable();
  const scrollRef = useRef<HTMLDivElement>(null);
  const starred = useStarred();
  const [renaming, setRenaming] = useState(false);
  /** Scrolled up away from the newest message; shows the jump-to-latest button. */
  const [away, setAway] = useState(false);

  const rename = async (title: string) => {
    const clean = title.trim().slice(0, 200);
    if (thread && clean && clean !== thread.title) await db.threads.update(thread.id, { title: clean });
    setRenaming(false);
  };
  const stick = useRef(true);

  useEffect(() => onBusy(busy), [busy, onBusy]);

  const last = messages.at(-1);
  useEffect(() => {
    const el = scrollRef.current;
    // An empty chat shows its greeting from the top; a conversation follows the newest message.
    if (el && stick.current) el.scrollTop = messages.length ? el.scrollHeight : 0;
  }, [messages.length, last?.content.length, last?.steps?.length, last?.sources?.length, last?.error]);
  useEffect(() => {
    stick.current = true;
    setAway(false);
    setRenaming(false);
  }, [threadId]);

  const jumpToLatest = () => {
    stick.current = true;
    setAway(false);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  };

  const setScope = (ids: string[]) => {
    if (thread) void db.threads.update(thread.id, { collectionIds: ids });
    else onPendingScope(ids);
  };

  const handleSend = useCallback(
    (input: SendInput) => {
      stick.current = true;
      send(input).catch((err) => toast(errorText(err), 'error'));
    },
    [send],
  );

  const onCite = useCallback(
    (m: ChatMessage, n: number) => {
      const items: ViewerItem[] = (m.sources ?? []).map((s) => ({
        docId: s.docId,
        docName: s.docName,
        start: s.start,
        end: s.end,
        text: s.text,
        page: s.page,
        headingPath: s.headingPath,
      }));
      if (items[n - 1]) onOpenSources(items, n - 1);
    },
    [onOpenSources],
  );

  const onRetry = useCallback((m: ChatMessage) => void retry(m.id), [retry]);

  const onEdit = useCallback(
    (m: ChatMessage, text: string) => {
      stick.current = true;
      void edit(m.id, text);
    },
    [edit],
  );

  const onSavePrompt = useCallback(async (text: string) => {
    if (text.length > 20_000) {
      toast('That prompt is too long to save.', 'error');
      return;
    }
    const exists = await db.prompts.filter((p) => p.text === text).count();
    if (!exists) await db.prompts.add({ id: uid(), text, createdAt: Date.now() });
    toast('Saved. Find it under Saved in My Chats.', 'success');
  }, []);

  const exportToDocs = async () => {
    const transcript = messages
      .map((m) => {
        const sources = m.sources?.length ? `\n\nSources:\n${m.sources.map((s) => `[${s.n}] ${s.docName}${s.page ? `, p. ${s.page}` : ''}`).join('\n')}` : '';
        return `${m.role === 'user' ? 'YOU' : 'CAPTBOT'}:\n${m.content}${sources}`;
      })
      .join('\n\n---\n\n');
    try {
      await navigator.clipboard.writeText(transcript);
      toast('Chat copied. Paste it into the new Google Doc.', 'success');
      window.open('https://docs.new', '_blank', 'noopener');
    } catch {
      toast('Could not copy the chat to the clipboard.', 'error');
    }
  };

  const suggestions = readyDocs ? DOC_SUGGESTIONS : GENERAL_SUGGESTIONS;
  const name = settings.displayName.trim();

  return (
    <div className="flex h-full flex-col">
      <header className="z-20 flex h-16 shrink-0 items-center gap-2 bg-surface px-4">
        <IconButton title={listOpen ? 'Hide chats' : 'Show chats'} onClick={onToggleList}>
          {listOpen ? <PanelLeftClose size={17} /> : <PanelLeft size={17} />}
        </IconButton>
        {renaming && thread ? (
          <form
            className="min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              void rename(String(new FormData(e.currentTarget).get('title') ?? ''));
            }}
          >
            <input
              name="title"
              autoFocus
              defaultValue={thread.title}
              aria-label="Chat title"
              onBlur={(e) => void rename(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
              className={cn(inputClass, 'py-1.5 font-display text-[15px]')}
            />
          </form>
        ) : (
          <div key={thread?.id ?? 'new'} className="anim-fade flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate font-display text-[17px] leading-tight text-ink" onDoubleClick={() => thread && setRenaming(true)}>
              {thread?.title ?? 'New chat'}
            </span>
            {thread && starred.has(thread.id) && <Star size={13} className="shrink-0 fill-amber-400 text-amber-400" aria-label="Starred" />}
          </div>
        )}
        {/* On phones, an open chat moves search into its ⋯ menu to leave room for the title. */}
        <IconButton title="Search everything (Ctrl+K)" onClick={onOpenSearch} className={thread ? 'max-sm:hidden' : undefined}>
          <Search size={17} />
        </IconButton>
        <ScopePicker value={scope} onChange={setScope} />
        {thread && (
          <ChatMenu
            items={[
              { label: 'New chat', icon: Plus, onClick: onNewChat },
              // Same width as Tailwind's sm, where the header's search button is hidden.
              ...(window.innerWidth < 640 ? [{ label: 'Search everything', icon: Search, onClick: onOpenSearch }] : []),
              { label: 'Rename', icon: Pencil, onClick: () => setRenaming(true) },
              { label: starred.has(thread.id) ? 'Remove star' : 'Star', icon: Star, onClick: () => toggleStar(thread.id) },
              ...(messages.length ? [{ label: 'Export to Google Docs', icon: FileText, onClick: () => void exportToDocs() }] : []),
              {
                label: 'Delete chat',
                icon: Trash,
                danger: true,
                onClick: async () => {
                  if (!confirm(`Delete “${thread.title}”?`)) return;
                  await deleteThread(thread.id);
                  onNewChat();
                },
              },
            ]}
          />
        )}
      </header>

      {/* The conversation sits in its own inset panel, a shade apart from the panels around it. */}
      <div className="flex min-h-0 flex-1 flex-col bg-canvas md:mx-3 md:mb-3 md:rounded-2xl md:border md:border-line">
        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            stick.current = fromBottom < 80;
            setAway(fromBottom > 320);
          }}
          className="scrollbar-thin flex-1 overflow-y-auto"
        >
          {messages.length === 0 ? (
            <div className="flex min-h-full flex-col items-center justify-center px-4 py-8">
              <Logo size="lg" withWord />
              <h1
                className="anim-rise mt-7 text-center font-display text-[clamp(1.9rem,4vw,3rem)] leading-[1.08] text-ink"
                style={{ '--d': '120ms' } as CSSProperties}
              >
                Hello{name ? `, ${name}` : ''}.
                <br />
                <span className="text-accent-600 dark:text-accent-400">What should we dig into?</span>
              </h1>
              <p className="anim-rise mt-3 max-w-md text-center text-sm leading-relaxed text-muted" style={{ '--d': '180ms' } as CSSProperties}>
                {readyDocs
                  ? `Ask anything. Answers draw on your ${plural(readyDocs, 'document')} and cite the passages they used.`
                  : 'Ask anything. Once you add documents, answers cite the passages they came from.'}
              </p>
              {(!keyReady || !readyDocs) && (
                <div className="anim-rise mt-6 flex flex-wrap justify-center gap-2" style={{ '--d': '240ms' } as CSSProperties}>
                  {!keyReady && (
                    <button onClick={onOpenSettings} className={cn(primaryButtonClass, 'px-3.5 py-2')}>
                      <KeyRound size={13} /> Add your {CHAT_PRESETS[settings.chat.provider].label} API key
                    </button>
                  )}
                  {!readyDocs && (
                    <button onClick={onOpenKnowledge} className={cn(buttonClass, 'px-3.5 py-2')}>
                      <Upload size={13} /> {totalDocs > 0 ? 'Finish indexing your documents' : 'Add documents'}
                    </button>
                  )}
                </div>
              )}
              <div className="anim-rise mt-9 font-mono text-[10px] tracking-wider text-muted uppercase" style={{ '--d': '300ms' } as CSSProperties}>
                Try asking
              </div>
              <div className="mt-3 flex w-full max-w-2xl flex-wrap justify-center gap-2">
                {suggestions.map((s, i) => (
                  <button
                    key={s.title}
                    style={{ '--d': `${340 + i * 70}ms` } as CSSProperties}
                    disabled={!keyReady || busy}
                    title={s.prompt}
                    onClick={() => handleSend({ text: s.prompt, images: [], mode: 'chat', webSearch: false, tools: false })}
                    className="anim-rise lift group/s inline-flex items-center gap-2.5 rounded-full border border-line bg-surface py-1.5 pr-1.5 pl-4 text-[13px] font-semibold text-ink hover:border-accent-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {s.title}
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-500 text-gray-950 transition-transform group-hover/s:translate-x-0.5">
                      <ArrowRight size={14} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-7 px-4 pt-6 pb-8">
              {messages.map((m, i) => (
                <Fragment key={m.id}>
                  {(i === 0 || dayGroup(m.createdAt) !== dayGroup(messages[i - 1].createdAt)) && (
                    <div role="separator" className="flex items-center gap-3 text-[11px] font-medium text-muted">
                      <span className="h-px flex-1 bg-line" />
                      {dayGroup(m.createdAt)}
                      <span className="h-px flex-1 bg-line" />
                    </div>
                  )}
                  <MessageItem
                    message={m}
                    streaming={m.id === liveId}
                    canRetry={!busy && m.role === 'assistant' && i === messages.length - 1}
                    onCite={onCite}
                    canEdit={!busy}
                    onRetry={onRetry}
                    onEdit={onEdit}
                    onPin={togglePin}
                    onToolDecision={decide}
                    onSavePrompt={onSavePrompt}
                    onOpenSettings={onOpenSettings}
                    docsInScope={scopedDocs}
                  />
                </Fragment>
              ))}
              {/* Stays at the bottom edge of the view while you read older messages. */}
              {away && (
                <div className="pointer-events-none sticky bottom-3 z-10 flex justify-center">
                  <button
                    type="button"
                    onClick={jumpToLatest}
                    className="anim-rise pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-accent-500 px-3.5 py-1.5 text-xs font-bold text-gray-950 shadow-lg transition hover:bg-accent-400"
                  >
                    <ArrowDown size={13} /> {busy ? 'New reply below' : 'Jump to latest'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 px-4 pb-3">
          <div className="mx-auto max-w-3xl">
            <Composer
              busy={busy}
              onSend={handleSend}
              onStop={stop}
              webSearchAvailable={settings.chat.provider === 'gemini'}
              connectorCount={settings.connectors.filter((c) => c.enabled).length}
              // The free tier runs on the server's key, which has no route to connectors yet.
              toolsBlocked={hasChatKey(settings) ? undefined : 'Connector tools need your own API key. Add one in Settings.'}
              seed={seed}
            />
            <div className="mt-2 text-center text-[11px] text-muted">
              {scopedDocs
                ? `Searching ${plural(scopedDocs, 'document')}${scope.length ? ' in this chat’s collections' : ''}`
                : totalDocs
                  ? 'No ready documents in this chat’s scope'
                  : 'No documents yet, so answers come from the model alone'}
              {' · '}Answers can be wrong. Check the sources.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
