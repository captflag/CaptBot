import { UserButton } from '@clerk/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Database, Library, MessageSquare, Moon, PanelLeftClose, Pencil, Plus, Settings as SettingsIcon, Sun, Trash } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type FormEvent } from 'react';
import { authEnabled } from '../lib/auth/session';
import { db, deleteThread } from '../lib/db';
import { updateSettings, useSettings } from '../lib/settings';
import type { Collection, KbDocument, SavedPrompt, Thread } from '../lib/types';
import { cn, dayGroup } from '../lib/utils';
import { ErrorBoundary } from './ErrorBoundary';
import { KnowledgePanel } from './KnowledgePanel';
import { Logo } from './Logo';
import { UsageMeter } from './UsageMeter';
import { IconButton, inputClass } from './ui';

export type SidebarTab = 'chats' | 'knowledge' | 'library';

const TABS: { id: SidebarTab; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chats', label: 'Chats', icon: MessageSquare },
  { id: 'knowledge', label: 'Knowledge', icon: Database },
  { id: 'library', label: 'Library', icon: Library },
];

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <div className="text-xs font-medium text-gray-500">{title}</div>
      <div className="mt-1 text-[11px] text-gray-400">{hint}</div>
    </div>
  );
}

function ChatsTab({ activeId, onSelect, onDeleted }: { activeId: string | null; onSelect: (id: string) => void; onDeleted: (id: string) => void }) {
  const threads = useLiveQuery(() => db.threads.orderBy('updatedAt').reverse().toArray(), [], [] as Thread[]);
  const collections = useLiveQuery(() => db.collections.toArray(), [], [] as Collection[]);
  const [editing, setEditing] = useState<string | null>(null);

  if (!threads.length) return <Empty title="No chats yet" hint="Conversations are saved in this browser." />;

  const groups = new Map<string, Thread[]>();
  for (const t of threads) {
    const g = dayGroup(t.updatedAt);
    groups.set(g, [...(groups.get(g) ?? []), t]);
  }
  const colorOf = new Map(collections.map((c) => [c.id, c.color]));

  const rename = async (e: FormEvent<HTMLFormElement>, id: string) => {
    e.preventDefault();
    const title = String(new FormData(e.currentTarget).get('title') ?? '').trim().slice(0, 200);
    if (title) await db.threads.update(id, { title });
    setEditing(null);
  };

  return (
    <div className="space-y-5">
      {[...groups].map(([label, items]) => (
        <div key={label} className="space-y-0.5">
          <h3 className="px-2 pb-1 text-[11px] font-medium text-gray-400">{label}</h3>
          {items.map((t) => (
            <div
              key={t.id}
              className={cn(
                'group flex items-center rounded-lg transition',
                t.id === activeId ? 'bg-violet-50 dark:bg-violet-900/25' : 'hover:bg-gray-100/80 dark:hover:bg-white/5',
              )}
            >
              {editing === t.id ? (
                <form onSubmit={(e) => void rename(e, t.id)} className="flex-1 p-1">
                  <input name="title" autoFocus defaultValue={t.title} onBlur={(e) => e.currentTarget.form?.requestSubmit()} className={cn(inputClass, 'py-1 text-sm')} />
                </form>
              ) : (
                <>
                  <button
                    onClick={() => onSelect(t.id)}
                    onDoubleClick={() => setEditing(t.id)}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-sm',
                      t.id === activeId ? 'font-medium text-violet-800 dark:text-violet-200' : 'text-gray-600 dark:text-gray-300',
                    )}
                  >
                    {t.collectionIds.length > 0 && (
                      <span className="flex shrink-0 -space-x-1">
                        {t.collectionIds.slice(0, 2).map((id) => (
                          <span key={id} className="h-2 w-2 rounded-full" style={{ background: colorOf.get(id) ?? '#9CA3AF' }} />
                        ))}
                      </span>
                    )}
                    <span className="truncate">{t.title}</span>
                  </button>
                  <div className="flex pr-1 sm:opacity-0 sm:group-hover:opacity-100">
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
          ))}
        </div>
      ))}
    </div>
  );
}

function LibraryTab({ onUse }: { onUse: (text: string) => void }) {
  const prompts = useLiveQuery(() => db.prompts.orderBy('createdAt').reverse().toArray(), [], [] as SavedPrompt[]);
  if (!prompts.length) return <Empty title="No saved prompts" hint="Hover a message you sent and click the bookmark to save it." />;
  return (
    <div className="space-y-1.5">
      {prompts.map((p) => (
        <div key={p.id} className="group relative rounded-xl border border-gray-100 bg-white/70 transition hover:border-violet-200 dark:border-gray-800 dark:bg-white/5">
          <button onClick={() => onUse(p.text)} className="block w-full p-3 pr-8 text-left text-xs leading-relaxed text-gray-700 dark:text-gray-200" title="Use this prompt">
            <span className="line-clamp-3">{p.text}</span>
          </button>
          <IconButton title="Delete prompt" onClick={() => void db.prompts.delete(p.id)} className="absolute top-1.5 right-1.5 sm:opacity-0 sm:group-hover:opacity-100">
            <Trash size={12} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

interface SidebarProps {
  open: boolean;
  tab: SidebarTab;
  onTab: (tab: SidebarTab) => void;
  onClose: () => void;
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onDeletedThread: (id: string) => void;
  onNewChat: () => void;
  onUsePrompt: (text: string) => void;
  onOpenSettings: () => void;
  onViewDocument: (doc: KbDocument) => void;
}

export function Sidebar(p: SidebarProps) {
  const s = useSettings();
  const initials = s.displayName.trim() ? s.displayName.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() : 'You';

  return (
    <>
      <AnimatePresence>
        {p.open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={p.onClose}
            className="fixed inset-0 z-40 bg-gray-900/20 backdrop-blur-sm lg:hidden"
          />
        )}
      </AnimatePresence>
      <motion.aside
        initial={false}
        animate={{ x: p.open ? 0 : '-100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="fixed top-0 bottom-0 left-0 z-50 flex w-[320px] flex-col border-r border-gray-200/60 bg-white/85 backdrop-blur-2xl dark:border-gray-800 dark:bg-[#0a0a0a]/90"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <Logo size="md" />
          <IconButton title="Close sidebar" onClick={p.onClose}>
            <PanelLeftClose size={18} />
          </IconButton>
        </div>

        <div className="px-4 pb-3">
          <button
            onClick={p.onNewChat}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white shadow-md transition hover:bg-black active:scale-[0.98] dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            <Plus size={17} /> New chat
          </button>
        </div>

        <div className="mx-4 grid grid-cols-3 gap-1 rounded-xl bg-gray-100/80 p-1 dark:bg-white/5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => p.onTab(t.id)}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition',
                p.tab === t.id ? 'bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200',
              )}
            >
              <t.icon size={13} />
              {t.label}
            </button>
          ))}
        </div>

        <div className="scrollbar-thin mt-3 flex-1 overflow-y-auto px-3 py-2">
          <ErrorBoundary key={p.tab} label="This panel">
            {p.tab === 'chats' && <ChatsTab activeId={p.activeThreadId} onSelect={p.onSelectThread} onDeleted={p.onDeletedThread} />}
            {p.tab === 'knowledge' && <KnowledgePanel onViewDocument={p.onViewDocument} />}
            {p.tab === 'library' && <LibraryTab onUse={p.onUsePrompt} />}
          </ErrorBoundary>
        </div>

        <div className="flex items-center gap-2.5 border-t border-gray-200/60 p-3 dark:border-gray-800">
          {authEnabled ? (
            // Account menu: profile, security and sign out.
            <UserButton />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-violet-500 to-indigo-600 text-[11px] font-bold text-white shadow-md">
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-gray-900 dark:text-gray-200">{s.displayName.trim() || 'You'}</div>
            <div className="truncate text-[10px] text-gray-500" title={s.chat.model}>
              {s.chat.model}
            </div>
            <UsageMeter compact />
          </div>
          <IconButton title={s.theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={() => updateSettings({ theme: s.theme === 'dark' ? 'light' : 'dark' })}>
            {s.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
          <IconButton title="Settings" onClick={p.onOpenSettings}>
            <SettingsIcon size={16} />
          </IconButton>
        </div>
      </motion.aside>
    </>
  );
}

