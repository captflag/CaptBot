import { useCallback, useEffect, useState } from 'react';
import { ChatList } from './components/ChatList';
import { ChatView } from './components/ChatView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { KnowledgePage } from './components/KnowledgePage';
import { NavRail, type View } from './components/NavRail';
import { QuickFind } from './components/QuickFind';
import { SettingsDialog } from './components/SettingsDialog';
import { ShortcutsSheet } from './components/ShortcutsSheet';
import { SourceViewer, type ViewerItem } from './components/SourceViewer';
import { Toaster } from './components/Toaster';
import { profileKey } from './lib/auth/profile';
import { db } from './lib/db';
import { recoverInterrupted } from './lib/rag/ingest';
import { useSettings } from './lib/settings';
import type { KbDocument } from './lib/types';
import { cn, isNarrow } from './lib/utils';

const ACTIVE_THREAD_KEY = 'captbot_active_thread';

function readActiveThread(): string | null {
  try {
    return localStorage.getItem(profileKey(ACTIVE_THREAD_KEY));
  } catch {
    return null;
  }
}

/**
 * The workspace, as one rounded window on a backdrop: an icon rail, then the current view.
 * Chats are three panes (past chats, the conversation, and the evidence for an answer);
 * Knowledge is a full page.
 */
export default function App() {
  const settings = useSettings();
  const [view, setView] = useState<View>('chat');
  const [threadId, setThreadId] = useState<string | null>(readActiveThread);
  const [pendingScope, setPendingScope] = useState<string[]>([]);
  const [listOpen, setListOpen] = useState(() => !isNarrow());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewer, setViewer] = useState<{ items: ViewerItem[]; index: number } | null>(null);
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(null);
  const [finding, setFinding] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  }, [settings.theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--app-font', `'${settings.font}'`);
  }, [settings.font]);

  useEffect(() => {
    try {
      if (threadId) localStorage.setItem(profileKey(ACTIVE_THREAD_KEY), threadId);
      else localStorage.removeItem(profileKey(ACTIVE_THREAD_KEY));
    } catch {
      // storage unavailable; the active chat just isn't remembered
    }
  }, [threadId]);

  useEffect(() => {
    // Forget a remembered chat that no longer exists (e.g. after "Delete all data").
    const remembered = readActiveThread();
    if (remembered) void db.threads.get(remembered).then((t) => !t && setThreadId(null));
    void recoverInterrupted();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setFinding((open) => !open);
        return;
      }
      // "?" opens the shortcuts list, unless it is being typed into a field.
      const t = e.target as HTMLElement | null;
      const typing = t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? '');
      if (e.key === '?' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setShortcuts(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closeListIfNarrow = () => {
    if (isNarrow()) setListOpen(false);
  };

  /** Switching views puts the evidence pane away: it belongs to what was on screen. */
  const go = useCallback((next: View) => {
    setView(next);
    setViewer(null);
  }, []);

  const newChat = useCallback(() => {
    setThreadId(null);
    setPendingScope([]);
    setViewer(null);
    setView('chat');
  }, []);

  const openSources = useCallback((items: ViewerItem[], index: number) => setViewer({ items, index }), []);

  const viewDocument = useCallback((doc: KbDocument) => {
    setViewer({ items: [{ docId: doc.id, docName: doc.name, start: 0, end: 0, headingPath: [] }], index: 0 });
  }, []);

  return (
    <div className="h-full bg-backdrop md:p-3">
      <div className="flex h-full flex-col-reverse overflow-hidden bg-surface text-ink md:flex-row md:rounded-[22px] md:border md:border-line md:shadow-[0_30px_80px_-30px_rgb(0_0_0/0.45)]">
        <NavRail view={view} onView={go} onOpenSettings={() => setSettingsOpen(true)} busy={chatBusy} />

        {/* Panes that slide over the chat on narrow screens are placed against this box. */}
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {view === 'chat' && (
            <ChatList
              open={listOpen}
              onClose={() => setListOpen(false)}
              activeId={threadId}
              onSelect={(id) => {
                setThreadId(id);
                setViewer(null);
                closeListIfNarrow();
              }}
              onDeleted={(id) => id === threadId && newChat()}
              onNewChat={() => {
                newChat();
                closeListIfNarrow();
              }}
              onUsePrompt={(text) => {
                setSeed({ text, nonce: Date.now() });
                closeListIfNarrow();
              }}
            />
          )}

          <main className="h-full min-w-0 flex-1">
            {/* The chat stays mounted behind the Knowledge page, so a reply being written is not cut off. */}
            <div className={cn('h-full', view !== 'chat' && 'hidden')}>
              <ErrorBoundary label="The chat view">
                <ChatView
                  threadId={threadId}
                  onThreadCreated={setThreadId}
                  pendingScope={pendingScope}
                  onPendingScope={setPendingScope}
                  listOpen={listOpen}
                  onToggleList={() => setListOpen((o) => !o)}
                  onNewChat={newChat}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onOpenKnowledge={() => go('knowledge')}
                  onOpenSources={openSources}
                  onOpenSearch={() => setFinding(true)}
                  onBusy={setChatBusy}
                  seed={seed}
                />
              </ErrorBoundary>
            </div>
            {view === 'knowledge' && (
              <ErrorBoundary label="The knowledge page">
                <KnowledgePage onViewDocument={viewDocument} />
              </ErrorBoundary>
            )}
          </main>

          {viewer && (
            <SourceViewer
              items={viewer.items}
              index={viewer.index}
              onIndex={(index) => setViewer((v) => (v ? { ...v, index } : v))}
              onClose={() => setViewer(null)}
            />
          )}
        </div>
      </div>

      {finding && (
        <QuickFind
          onClose={() => setFinding(false)}
          onSelectThread={(id) => {
            setThreadId(id);
            go('chat');
            closeListIfNarrow();
          }}
          onViewDocument={viewDocument}
          onUsePrompt={(text) => {
            setSeed({ text, nonce: Date.now() });
            go('chat');
          }}
          onNewChat={newChat}
          onOpenKnowledge={() => go('knowledge')}
          onOpenSettings={() => setSettingsOpen(true)}
          onShowShortcuts={() => setShortcuts(true)}
        />
      )}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ShortcutsSheet open={shortcuts} onClose={() => setShortcuts(false)} />
      <Toaster />
    </div>
  );
}
