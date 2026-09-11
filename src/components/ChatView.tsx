import { useLiveQuery } from 'dexie-react-hooks';
import { Circle, CircleCheck, FileText, Menu, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useChat, type SendInput } from '../hooks/useChat';
import { serverTierAvailable } from '../lib/auth/session';
import { db, scopedReadyDocIds, uid } from '../lib/db';
import { errorText } from '../lib/rag/json';
import { CHAT_PRESETS, hasChatKey, useSettings } from '../lib/settings';
import type { ChatMessage } from '../lib/types';
import { plural } from '../lib/utils';
import { Composer } from './Composer';
import { DotMorphHero } from './DotMorphHero';
import { MessageItem } from './MessageItem';
import { ScopePicker } from './ScopePicker';
import type { ViewerItem } from './SourceViewer';
import { toast } from './Toaster';
import { buttonClass, IconButton } from './ui';

function SetupStep({ done, title, action, onClick }: { done: boolean; title: string; action?: string; onClick?: () => void }) {
  return (
    <div className="flex items-center gap-3 py-1">
      {done ? <CircleCheck size={16} className="shrink-0 text-emerald-500" /> : <Circle size={16} className="shrink-0 text-gray-300 dark:text-gray-600" />}
      <span className={done ? 'flex-1 text-sm text-gray-400 line-through' : 'flex-1 text-sm text-gray-700 dark:text-gray-200'}>{title}</span>
      {!done && action && (
        <button onClick={onClick} className={buttonClass}>
          {action}
        </button>
      )}
    </div>
  );
}

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

interface Props {
  threadId: string | null;
  onThreadCreated: (id: string) => void;
  pendingScope: string[];
  onPendingScope: (ids: string[]) => void;
  onToggleSidebar: () => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onOpenKnowledge: () => void;
  onOpenSources: (items: ViewerItem[], index: number) => void;
  seed: { text: string; nonce: number } | null;
}

export function ChatView({
  threadId,
  onThreadCreated,
  pendingScope,
  onPendingScope,
  onToggleSidebar,
  onNewChat,
  onOpenSettings,
  onOpenKnowledge,
  onOpenSources,
  seed,
}: Props) {
  const settings = useSettings();
  const thread = useLiveQuery(async () => (threadId ? ((await db.threads.get(threadId)) ?? null) : null), [threadId]);
  const collectionIds = useLiveQuery(() => db.collections.toCollection().primaryKeys(), [], [] as string[]);
  // Drop collections deleted since they were picked, so a stale id can't silently switch retrieval off.
  const scope = useMemo(
    () => (thread?.collectionIds ?? pendingScope).filter((id) => collectionIds.includes(id)),
    [thread, pendingScope, collectionIds],
  );
  const newThreadScope = useMemo(() => pendingScope.filter((id) => collectionIds.includes(id)), [pendingScope, collectionIds]);
  const { messages, busy, liveId, send, stop, retry, togglePin } = useChat(threadId, onThreadCreated, newThreadScope);
  const scopedDocs = useLiveQuery(() => scopedReadyDocIds(scope), [scope.join('|')])?.size ?? 0;
  const totalDocs = useLiveQuery(() => db.documents.count(), [], 0);
  const readyDocs = useLiveQuery(() => db.documents.where('status').equals('ready').count(), [], 0);
  // Signed-in users without their own key can still chat on the free tier.
  const keyReady = hasChatKey(settings) || serverTierAvailable();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const last = messages.at(-1);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, last?.content.length, last?.steps?.length, last?.sources?.length, last?.error]);
  useEffect(() => {
    stick.current = true;
  }, [threadId]);

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

  const onSavePrompt = useCallback(async (text: string) => {
    if (text.length > 20_000) {
      toast('That prompt is too long to save to the Library.', 'error');
      return;
    }
    const exists = await db.prompts.filter((p) => p.text === text).count();
    if (!exists) await db.prompts.add({ id: uid(), text, createdAt: Date.now() });
    toast('Saved to Library', 'success');
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
      <header className="z-20 flex h-14 shrink-0 items-center gap-2 border-b border-gray-100 bg-white/80 px-3 backdrop-blur-md dark:border-gray-800 dark:bg-[#0a0a0a]/80">
        <IconButton title="Toggle sidebar" onClick={onToggleSidebar}>
          <Menu size={18} />
        </IconButton>
        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{thread?.title ?? 'New chat'}</div>
        <ScopePicker value={scope} onChange={setScope} />
        {messages.length > 0 && (
          <>
            <button onClick={() => void exportToDocs()} className={`${buttonClass} hidden sm:inline-flex`} title="Copy this chat and open Google Docs">
              <FileText size={13} /> Export to Docs
            </button>
            <IconButton title="New chat" onClick={onNewChat}>
              <Plus size={18} />
            </IconButton>
          </>
        )}
      </header>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="scrollbar-thin flex-1 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center px-4 py-10">
            <DotMorphHero className="max-w-2xl" />
            <h1 className="mt-4 text-center text-3xl leading-tight font-semibold tracking-tight">
              <span className="text-violet-600 dark:text-violet-400">Hello{name ? `, ${name}` : ''}.</span>
              <br />
              <span className="text-gray-900 dark:text-white">What should we dig into?</span>
            </h1>
            {(!keyReady || !readyDocs) && (
              <div className="mt-8 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/5">
                <div className="mb-1 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">Get started</div>
                <SetupStep done={keyReady} title={`Add your ${CHAT_PRESETS[settings.chat.provider].label} API key`} action="Open settings" onClick={onOpenSettings} />
                <SetupStep
                  done={readyDocs > 0}
                  title={totalDocs > 0 ? 'Get a document indexed (see the Knowledge tab)' : 'Add documents to your knowledge base'}
                  action={totalDocs > 0 ? 'Open Knowledge' : 'Add documents'}
                  onClick={onOpenKnowledge}
                />
                <SetupStep done={false} title="Ask a question and check the cited sources" />
              </div>
            )}
            <div className="mt-6 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
              {suggestions.map((s) => (
                <button
                  key={s.title}
                  disabled={!keyReady || busy}
                  onClick={() => handleSend({ text: s.prompt, images: [], mode: 'chat', webSearch: false })}
                  className="rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-violet-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-white/5 dark:hover:border-violet-800"
                >
                  <div className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{s.title}</div>
                  <div className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{s.prompt}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-8 px-4 pt-8 pb-10">
            {messages.map((m, i) => (
              <MessageItem
                key={m.id}
                message={m}
                streaming={m.id === liveId}
                canRetry={!busy && m.role === 'assistant' && i === messages.length - 1}
                onCite={onCite}
                onRetry={onRetry}
                onPin={togglePin}
                onSavePrompt={onSavePrompt}
                onOpenSettings={onOpenSettings}
                knowledgeInScope={scopedDocs > 0}
              />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pb-3">
        <div className="mx-auto max-w-3xl">
          <Composer busy={busy} onSend={handleSend} onStop={stop} webSearchAvailable={settings.chat.provider === 'gemini'} seed={seed} />
          <div className="mt-2 text-center text-[11px] text-gray-400">
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
  );
}
