import { useCallback, useEffect, useState } from 'react';
import { ChatView } from './components/ChatView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar, type SidebarTab } from './components/Sidebar';
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

export default function App() {
  const settings = useSettings();
  const [threadId, setThreadId] = useState<string | null>(readActiveThread);
  const [pendingScope, setPendingScope] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(() => !isNarrow());
  const [tab, setTab] = useState<SidebarTab>('chats');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewer, setViewer] = useState<{ items: ViewerItem[]; index: number } | null>(null);
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(null);

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

  const closeIfNarrow = () => {
    if (isNarrow()) setSidebarOpen(false);
  };

  const newChat = useCallback(() => {
    setThreadId(null);
    setPendingScope([]);
  }, []);

  const openSources = useCallback((items: ViewerItem[], index: number) => setViewer({ items, index }), []);

  const viewDocument = useCallback((doc: KbDocument) => {
    setViewer({ items: [{ docId: doc.id, docName: doc.name, start: 0, end: 0, headingPath: [] }], index: 0 });
  }, []);

  return (
    <div className="flex h-full overflow-hidden bg-[#F9FAFB] text-gray-900 dark:bg-[#050505] dark:text-gray-100">
      <Sidebar
        open={sidebarOpen}
        tab={tab}
        onTab={setTab}
        onClose={() => setSidebarOpen(false)}
        activeThreadId={threadId}
        onSelectThread={(id) => {
          setThreadId(id);
          closeIfNarrow();
        }}
        onDeletedThread={(id) => id === threadId && newChat()}
        onNewChat={() => {
          newChat();
          setTab('chats');
          closeIfNarrow();
        }}
        onUsePrompt={(text) => {
          setSeed({ text, nonce: Date.now() });
          closeIfNarrow();
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onViewDocument={viewDocument}
      />

      <main className={cn('flex h-full min-w-0 flex-1 flex-col transition-[margin] duration-300', sidebarOpen && 'lg:ml-[320px]')}>
        <ErrorBoundary label="The chat view">
        <ChatView
          threadId={threadId}
          onThreadCreated={setThreadId}
          pendingScope={pendingScope}
          onPendingScope={setPendingScope}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onNewChat={newChat}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenKnowledge={() => {
            setTab('knowledge');
            setSidebarOpen(true);
          }}
          onOpenSources={openSources}
          seed={seed}
        />
        </ErrorBoundary>
      </main>

      {viewer && (
        <SourceViewer
          items={viewer.items}
          index={viewer.index}
          onIndex={(index) => setViewer((v) => (v ? { ...v, index } : v))}
          onClose={() => setViewer(null)}
        />
      )}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toaster />
    </div>
  );
}
