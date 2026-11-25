import { useLiveQuery } from 'dexie-react-hooks';
import { Bot, Eye, EyeOff, HardDrive, LibraryBig, LoaderCircle, Palette, Pencil, Plug, RefreshCw, Trash } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { profileKey } from '../lib/auth/profile';
import { serverTierAvailable } from '../lib/auth/session';
import { db, uid } from '../lib/db';
// The connector helpers are small; the MCP client library itself still loads on first use.
import { testConnector, type McpTool } from '../lib/mcp';
import { reindexStale } from '../lib/rag/ingest';
import { errorText } from '../lib/rag/json';
import { CHAT_PRESETS, EMBEDDING_PRESETS, FONTS, hasChatKey, updateSettings, useSettings, type McpConnector, type Settings } from '../lib/settings';
import { resetSyncState, syncNow, useSyncStatus, type SyncStatus } from '../lib/sync/engine';
import { useActiveEmbeddingKey, useStorageMode } from '../lib/sync/mode';
import { remote } from '../lib/sync/remote';
import { clearAllDirty } from '../lib/sync/track';
import type { ChatProviderId, EmbeddingProviderId, RerankMode } from '../lib/types';
import { cn, plural } from '../lib/utils';
import { exportBackup, importFile } from './kbActions';
import { UsageMeter } from './UsageMeter';
import { toast } from './Toaster';
import { buttonClass, Field, inputClass, Modal, Toggle } from './ui';

function Section({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <section className="space-y-4 border-b border-line px-5 py-5 last:border-0">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={cn(inputClass, 'pr-9 font-mono text-xs')}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute top-1/2 right-2 -translate-y-1/2 text-muted hover:text-ink"
        aria-label={show ? 'Hide key' : 'Show key'}
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

/** Plain http only to this machine: anywhere else the access token would cross the network unencrypted. */
function connectorUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return 'Enter the server’s full URL, starting with https://';
  }
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
  return 'Use an https:// URL. Plain http is only allowed for a server on this computer (localhost).';
}

const updateConnector = (id: string, patch: Partial<McpConnector>) =>
  updateSettings((s) => ({ ...s, connectors: s.connectors.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

type TestState = { state: 'testing' } | { state: 'ok'; tools: McpTool[] } | { state: 'error'; message: string };

type ConnectorDraft = Pick<McpConnector, 'name' | 'url' | 'token'>;

/** The name, URL and token fields, for adding a connector or changing one. */
function ConnectorForm({
  initial,
  title,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: ConnectorDraft;
  title: string;
  submitLabel: string;
  onSubmit: (draft: ConnectorDraft) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [token, setToken] = useState(initial?.token ?? '');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = () => {
    const bad = connectorUrlProblem(url);
    if (bad) {
      setProblem(bad);
      return;
    }
    const clean = url.trim();
    onSubmit({ name: name.trim() || new URL(clean).hostname, url: clean, token: token.trim() });
    if (!initial) {
      setName('');
      setUrl('');
      setToken('');
    }
    setProblem(null);
  };

  return (
    <form
      className={cn('space-y-3 rounded-xl border border-line p-3', !initial && 'border-dashed')}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="text-xs font-semibold text-ink">{title}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Issue tracker" className={inputClass} />
        </Field>
        <Field label="Server URL">
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setProblem(null);
            }}
            placeholder="https://example.com/mcp"
            spellCheck={false}
            className={cn(inputClass, 'font-mono text-xs')}
          />
        </Field>
      </div>
      <Field
        label="Access token (optional)"
        hint="Sent to this server only, as “Authorization: Bearer …”. Servers that need a sign-in page (OAuth) aren’t supported yet."
      >
        <SecretInput value={token} onChange={setToken} placeholder="Leave empty if the server needs none" />
      </Field>
      {problem && <p className="text-xs text-red-600 dark:text-red-400">{problem}</p>}
      <div className="flex gap-1.5">
        <button type="submit" disabled={!url.trim()} className={buttonClass}>
          <Plug size={13} /> {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={buttonClass}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function ConnectorRow({ connector: c, test, onTest }: { connector: McpConnector; test?: TestState; onTest: (c: McpConnector) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li>
        <ConnectorForm
          initial={c}
          title={`Edit “${c.name}”`}
          submitLabel="Save and test"
          onCancel={() => setEditing(false)}
          onSubmit={(draft) => {
            // Tools allowed to run without asking were allowed on the old server, not a new one.
            const next = { ...c, ...draft, alwaysAllow: draft.url === c.url ? c.alwaysAllow : [] };
            updateConnector(c.id, next);
            setEditing(false);
            onTest(next);
          }}
        />
      </li>
    );
  }
  return (
    <li className="space-y-2 rounded-xl border border-line p-3">
      <Toggle
        checked={c.enabled}
        onChange={(enabled) => updateConnector(c.id, { enabled })}
        label={c.name}
        hint={<span className="font-mono break-all">{c.url}</span>}
      />
      {test && (
        <div
          className={cn(
            'rounded-lg px-2.5 py-2 text-xs leading-relaxed',
            test.state === 'error' ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-canvas text-muted',
          )}
        >
          {test.state === 'testing' && 'Connecting…'}
          {test.state === 'error' && test.message}
          {test.state === 'ok' &&
            (test.tools.length ? (
              <>
                <b className="text-ink">{plural(test.tools.length, 'tool')}:</b> {test.tools.map((t) => t.name).join(', ')}
              </>
            ) : (
              'Connected, but this server offers no tools.'
            ))}
        </div>
      )}
      {c.alwaysAllow.length > 0 && (
        <p className="text-xs text-muted">
          Runs without asking: {c.alwaysAllow.join(', ')}.{' '}
          <button type="button" onClick={() => updateConnector(c.id, { alwaysAllow: [] })} className="font-semibold text-ink underline underline-offset-2">
            Ask every time again
          </button>
        </p>
      )}
      <div className="flex gap-1.5">
        <button type="button" onClick={() => onTest(c)} disabled={test?.state === 'testing'} className={buttonClass}>
          {test?.state === 'testing' ? <LoaderCircle size={13} className="animate-spin" /> : <Plug size={13} />} Test connection
        </button>
        <button type="button" onClick={() => setEditing(true)} className={buttonClass}>
          <Pencil size={13} /> Edit
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Remove the connector “${c.name}”?`)) updateSettings((s) => ({ ...s, connectors: s.connectors.filter((x) => x.id !== c.id) }));
          }}
          className={cn(buttonClass, 'text-red-600 dark:text-red-400')}
        >
          <Trash size={13} /> Remove
        </button>
      </div>
    </li>
  );
}

/** Remote MCP servers whose tools answers may call. */
function ConnectorsSection({ settings: s }: { settings: Settings }) {
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const test = async (c: McpConnector) => {
    setTests((t) => ({ ...t, [c.id]: { state: 'testing' } }));
    try {
      const tools = await testConnector(c);
      setTests((t) => ({ ...t, [c.id]: { state: 'ok', tools } }));
    } catch (err) {
      setTests((t) => ({ ...t, [c.id]: { state: 'error', message: errorText(err) } }));
    }
  };

  const add = (draft: ConnectorDraft) => {
    const connector: McpConnector = { id: uid(), ...draft, enabled: true, alwaysAllow: [] };
    updateSettings((x) => ({ ...x, connectors: [...x.connectors, connector] }));
    void test(connector);
  };

  return (
    <Section
      title="Connectors (MCP)"
      description="Let answers call tools on remote MCP servers, such as a database, a ticket tracker or a search service. Only servers reached over a URL that allow requests from a browser work. Every tool call asks you first unless you allow that tool always. Connector details, tokens included, stay in this browser and are never synced."
    >
      {!hasChatKey(s) && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          Connector tools work with your own API key. On the free tier, answers don’t use them.
        </p>
      )}
      {s.connectors.length > 0 && (
        <ul className="space-y-2">
          {s.connectors.map((c) => (
            <ConnectorRow key={c.id} connector={c} test={tests[c.id]} onTest={(next) => void test(next)} />
          ))}
        </ul>
      )}
      <ConnectorForm title="Add a connector" submitLabel="Add and test" onSubmit={add} />
    </Section>
  );
}

/** Number field that only commits a clamped value on blur, so typing isn't fought mid-edit. */
function NumberInput({ value, min, max, step = 1, onChange }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    const next = Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : value;
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className={inputClass}
    />
  );
}

function syncLine(s: SyncStatus): string {
  if (s.phase === 'syncing') return 'Syncing…';
  if (s.phase === 'error') return `Sync failed: ${s.error ?? 'unknown error'}. Retrying automatically.`;
  const waiting = s.pending ? ` · ${plural(s.pending, 'change')} waiting to upload` : '';
  const refused = s.rejected ? ` · ${plural(s.rejected, 'change')} the server couldn't save (${s.rejection ?? 'unknown reason'})` : '';
  if (!s.lastSyncedAt) return `Not synced yet${waiting}${refused}`;
  const minutes = Math.floor((Date.now() - s.lastSyncedAt) / 60_000);
  return `Synced ${minutes < 1 ? 'just now' : `${minutes} min ago`}${waiting}${refused}`;
}

const SETTINGS_TABS = [
  { id: 'model', label: 'Model', icon: Bot },
  { id: 'knowledge', label: 'Knowledge', icon: LibraryBig },
  { id: 'connectors', label: 'Connectors', icon: Plug },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'data', label: 'Your data', icon: HardDrive },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings();
  // Kept while the dialog is closed, so it reopens on the tab you were using.
  const [tab, setTab] = useState<SettingsTab>('model');
  const storage = useStorageMode();
  const sync = useSyncStatus();
  const key = useActiveEmbeddingKey();
  const staleCount = useLiveQuery(() => db.documents.filter((d) => d.status === 'ready' && d.embeddingKey !== key).count(), [key], 0);

  const setChat = (patch: Partial<Settings['chat']>) => updateSettings((c) => ({ ...c, chat: { ...c.chat, ...patch } }));
  const setEmb = (patch: Partial<Settings['embeddings']>) => updateSettings((c) => ({ ...c, embeddings: { ...c.embeddings, ...patch } }));
  const setRet = (patch: Partial<Settings['retrieval']>) => updateSettings((c) => ({ ...c, retrieval: { ...c.retrieval, ...patch } }));
  const setKey = (k: keyof Settings['keys'], v: string) => updateSettings((c) => ({ ...c, keys: { ...c.keys, [k]: v } }));

  const wipe = async () => {
    const question = storage.server
      ? 'Delete everything in your CaptBot account: documents, collections, chats and saved prompts, on every device? Settings and API keys in this browser are removed too. This cannot be undone. Download a backup first if you might need them.'
      : 'Delete all documents, collections, chats and settings from this browser? This cannot be undone. Download a backup first if you might need them.';
    if (!confirm(question)) return;
    try {
      if (storage.server) await remote().wipe();
    } catch (err) {
      toast(`Your account data couldn't be deleted: ${errorText(err)}`, 'error');
      return;
    }
    clearAllDirty();
    resetSyncState();
    await db.delete();
    for (const k of [profileKey('captbot_settings_v2'), profileKey('captbot_active_thread'), 'captbot_theme']) localStorage.removeItem(k);
    location.reload();
  };

  return (
    <Modal open={open} onClose={onClose} title="Settings" className="max-w-3xl">
      <div className="flex flex-col sm:h-[min(640px,calc(90vh-56px))] sm:flex-row">
        <nav
          role="tablist"
          aria-label="Settings sections"
          aria-orientation="vertical"
          onKeyDown={(e) => {
            const i = SETTINGS_TABS.findIndex((t) => t.id === tab);
            const n = SETTINGS_TABS.length;
            const next = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: n - 1 }[e.key];
            if (next === undefined) return;
            e.preventDefault();
            const t = SETTINGS_TABS[(next + n) % n];
            setTab(t.id);
            document.getElementById(`settings-tab-${t.id}`)?.focus();
          }}
          className="scrollbar-thin flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2 sm:w-48 sm:flex-col sm:border-r sm:border-b-0 sm:p-3"
        >
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`settings-tab-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              aria-selected={tab === t.id}
              aria-controls="settings-panel"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-semibold transition-colors',
                tab === t.id ? 'bg-accent-500 text-gray-950' : 'text-muted hover:bg-canvas hover:text-ink',
              )}
            >
              <t.icon size={15} />
              {t.label}
            </button>
          ))}
        </nav>
        <div
          role="tabpanel"
          id="settings-panel"
          aria-labelledby={`settings-tab-${tab}`}
          key={tab}
          className="anim-fade scrollbar-thin min-w-0 flex-1 overflow-y-auto"
        >
          {tab === 'model' && (
            <>
              <Section title="Chat model" description="Requests go straight from your browser to the provider you pick.">
                <Field label="Provider">
                  <select
                    value={s.chat.provider}
                    onChange={(e) => {
                      const provider = e.target.value as ChatProviderId;
                      setChat({ provider, model: CHAT_PRESETS[provider].main, fastModel: CHAT_PRESETS[provider].fast });
                    }}
                    className={inputClass}
                  >
                    {Object.entries(CHAT_PRESETS).map(([id, p]) => (
                      <option key={id} value={id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Answer model" hint="Answers and research reports.">
                    <input list="chat-models" value={s.chat.model} onChange={(e) => setChat({ model: e.target.value.trim() })} className={inputClass} />
                  </Field>
                  <Field label="Fast model" hint="Follow-up rewriting, research planning, LLM reranking.">
                    <input list="chat-models" value={s.chat.fastModel} onChange={(e) => setChat({ fastModel: e.target.value.trim() })} className={inputClass} />
                  </Field>
                </div>
                <datalist id="chat-models">
                  {CHAT_PRESETS[s.chat.provider].models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Section>

              {serverTierAvailable() && (
                <Section
                  title="Free tier"
                  description="While you're signed in, CaptBot answers on its own key with a daily allowance. Add your own key below to call your provider directly with no CaptBot limit."
                >
                  <UsageMeter />
                </Section>
              )}

              <Section
                title="API keys"
                description="Keys stay in this browser's local storage and are only sent to the matching provider. Anyone with access to this browser profile can read them, so don't use a shared computer."
              >
                <Field label="Google Gemini">
                  <SecretInput value={s.keys.gemini} onChange={(v) => setKey('gemini', v)} placeholder="AIza…" />
                </Field>
                <Field label="Anthropic">
                  <SecretInput value={s.keys.anthropic} onChange={(v) => setKey('anthropic', v)} placeholder="sk-ant-…" />
                </Field>
                <Field label="OpenAI">
                  <SecretInput value={s.keys.openai} onChange={(v) => setKey('openai', v)} placeholder="sk-…" />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="OpenAI-compatible server" hint="Ollama: http://localhost:11434/v1 (set OLLAMA_ORIGINS for deployed sites).">
                    <input value={s.compatibleBaseUrl} onChange={(e) => updateSettings({ compatibleBaseUrl: e.target.value.trim() })} className={inputClass} />
                  </Field>
                  <Field label="Compatible server key" hint="Optional for local servers.">
                    <SecretInput value={s.keys.compatible} onChange={(v) => setKey('compatible', v)} placeholder="optional" />
                  </Field>
                </div>
              </Section>
            </>
          )}
          {tab === 'knowledge' && (
            <>
              {storage.server ? (
                <Section
                  title="Embeddings"
                  description="Your account's documents are indexed on the server with Gemini gemini-embedding-2 (768 dimensions), so every device searches the same index. It uses CaptBot's key and counts toward the indexing allowance."
                />
              ) : (
                <Section title="Embeddings" description="Turns document chunks into vectors for semantic search. Switching models requires re-indexing.">
                  <Field label="Provider">
                    <select
                      value={s.embeddings.provider}
                      onChange={(e) => {
                        const provider = e.target.value as EmbeddingProviderId;
                        setEmb({ provider, model: EMBEDDING_PRESETS[provider].model, dimensions: EMBEDDING_PRESETS[provider].dimensions });
                      }}
                      className={inputClass}
                    >
                      {Object.entries(EMBEDDING_PRESETS).map(([id, p]) => (
                        <option key={id} value={id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Model">
                      <input
                        list="embedding-models"
                        value={s.embeddings.model}
                        disabled={s.embeddings.provider === 'local'}
                        onChange={(e) => setEmb({ model: e.target.value.trim() })}
                        className={cn(inputClass, 'disabled:opacity-60')}
                      />
                    </Field>
                    <Field label="Dimensions" hint="0 uses the model's native size.">
                      {s.embeddings.provider === 'local' ? (
                        <input value={EMBEDDING_PRESETS.local.dimensions} disabled className={cn(inputClass, 'opacity-60')} />
                      ) : (
                        <NumberInput value={s.embeddings.dimensions} min={0} max={4096} onChange={(dimensions) => setEmb({ dimensions })} />
                      )}
                    </Field>
                  </div>
                  <datalist id="embedding-models">
                    {EMBEDDING_PRESETS[s.embeddings.provider].models.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                  {s.embeddings.provider === 'local' && (
                    <p className="text-[11px] leading-relaxed text-muted">The local model reads English only; use Gemini or OpenAI for other languages.</p>
                  )}
                  {staleCount > 0 && (
                    <div className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                      <span>{plural(staleCount, 'document')} need re-indexing for this model.</span>
                      <button className={buttonClass} onClick={async () => toast(`Re-indexing ${plural(await reindexStale(), 'document')}…`)}>
                        Re-index
                      </button>
                    </div>
                  )}
                </Section>
              )}

              <Section title="Retrieval">
                <Toggle
                  label="Hybrid search"
                  hint="Combine keyword (BM25) and semantic search with reciprocal rank fusion. Catches exact names, codes and numbers."
                  checked={s.retrieval.hybrid}
                  onChange={(hybrid) => setRet({ hybrid })}
                />
                <Toggle
                  label="Rewrite follow-up questions"
                  hint="Turns “what about the second one?” into a standalone search query using the fast model."
                  checked={s.retrieval.rewriteQueries}
                  onChange={(rewriteQueries) => setRet({ rewriteQueries })}
                />
                <Field
                  label="Reranker"
                  hint="Local runs a small cross-encoder in your browser (about 23 MB, downloaded once); it reads English, so questions in other scripts use the fast model instead. LLM uses the fast model and costs tokens."
                >
                  <select value={s.retrieval.rerank} onChange={(e) => setRet({ rerank: e.target.value as RerankMode })} className={inputClass}>
                    <option value="local">Local cross-encoder</option>
                    <option value="llm">LLM (fast model)</option>
                    <option value="none">None</option>
                  </select>
                </Field>
                <Toggle
                  label="Leave out irrelevant passages"
                  hint="Passages the reranker judges unrelated to the question aren't sent to the model, so questions your documents don't cover get an honest answer instead of loosely related excerpts. Needs a reranker."
                  checked={s.retrieval.filterIrrelevant}
                  onChange={(filterIrrelevant) => setRet({ filterIrrelevant })}
                />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Candidates">
                    <NumberInput value={s.retrieval.candidates} min={5} max={100} onChange={(candidates) => setRet({ candidates })} />
                  </Field>
                  <Field label="Sources per answer">
                    <NumberInput value={s.retrieval.topK} min={1} max={20} onChange={(topK) => setRet({ topK })} />
                  </Field>
                  <Field label="Context budget (tokens)" hint="Room for sources and the text around them.">
                    <NumberInput value={s.retrieval.contextTokens} min={1000} max={60000} step={500} onChange={(contextTokens) => setRet({ contextTokens })} />
                  </Field>
                </div>
              </Section>

              <Section title="Knowledge sources">
                <Field
                  label="Reader proxy (optional)"
                  hint="Many sites block direct browser requests. A prefix such as https://r.jina.ai/ fetches the page for you, which sends the page URL to that service. Leave empty to only import sites that allow it."
                >
                  <input
                    value={s.readerProxy}
                    onChange={(e) => updateSettings({ readerProxy: e.target.value.trim() })}
                    placeholder="https://r.jina.ai/"
                    className={inputClass}
                  />
                </Field>
              </Section>
            </>
          )}
          {tab === 'connectors' && <ConnectorsSection settings={s} />}
          {tab === 'appearance' && (
            <>
              <Section title="Profile & appearance">
                <Field label="Your name" hint="Used in the greeting and so CaptBot knows how to address you.">
                  <input value={s.displayName} onChange={(e) => updateSettings({ displayName: e.target.value })} className={inputClass} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Theme">
                    <select value={s.theme} onChange={(e) => updateSettings({ theme: e.target.value as Settings['theme'] })} className={inputClass}>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </Field>
                  <Field label="Font">
                    <select value={s.font} onChange={(e) => updateSettings({ font: e.target.value })} className={inputClass}>
                      {FONTS.map((f) => (
                        <option key={f} value={f}>
                          {f === 'System' ? 'System (your device’s font)' : f}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </Section>
            </>
          )}
          {tab === 'data' && (
            <>
              <Section
                title="Your data"
                description={
                  storage.server
                    ? 'Your documents, collections, chats and saved prompts are stored in your CaptBot account and sync across your devices. This browser keeps a copy so the app stays fast. Images you attach stay on the device you sent them from.'
                    : 'Everything lives in this browser (IndexedDB). Download a backup to move it to another device.'
                }
              >
                {storage.server && (
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-canvas px-3 py-2 text-xs text-muted">
                    <span className={cn(sync.phase === 'error' && 'text-amber-700 dark:text-amber-400')}>{syncLine(sync)}</span>
                    <button className={buttonClass} onClick={() => void syncNow()} disabled={sync.phase === 'syncing'}>
                      <RefreshCw size={12} className={cn(sync.phase === 'syncing' && 'animate-spin')} /> Sync now
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button className={buttonClass} onClick={() => void exportBackup()}>
                    Download backup
                  </button>
                  <label className={cn(buttonClass, 'cursor-pointer')}>
                    Import backup or pack
                    <input
                      type="file"
                      accept=".captbot,.gz,.json"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void importFile(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <button className={cn(buttonClass, 'text-red-600 dark:text-red-400')} onClick={() => void wipe()}>
                    Delete all data
                  </button>
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
