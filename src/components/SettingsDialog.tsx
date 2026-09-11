import { useLiveQuery } from 'dexie-react-hooks';
import { Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { profileKey } from '../lib/auth/profile';
import { serverTierAvailable } from '../lib/auth/session';
import { db } from '../lib/db';
import { reindexStale } from '../lib/rag/ingest';
import { errorText } from '../lib/rag/json';
import { CHAT_PRESETS, EMBEDDING_PRESETS, updateSettings, useSettings, type Settings } from '../lib/settings';
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
    <section className="space-y-4 border-b border-gray-100 px-5 py-5 last:border-0 dark:border-gray-800">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{description}</p>}
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
        className="absolute top-1/2 right-2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        aria-label={show ? 'Hide key' : 'Show key'}
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
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

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings();
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
    <Modal open={open} onClose={onClose} title="Settings" className="max-w-2xl">
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
            <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">The local model reads English only; use Gemini or OpenAI for other languages.</p>
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
          <input value={s.readerProxy} onChange={(e) => updateSettings({ readerProxy: e.target.value.trim() })} placeholder="https://r.jina.ai/" className={inputClass} />
        </Field>
      </Section>

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
              <option value="Inter">Inter</option>
              <option value="Martian Grotesk">Martian Grotesk</option>
              <option value="Redaction">Redaction</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section
        title="Your data"
        description={
          storage.server
            ? 'Your documents, collections, chats and saved prompts are stored in your CaptBot account and sync across your devices. This browser keeps a copy so the app stays fast. Images you attach stay on the device you sent them from.'
            : 'Everything lives in this browser (IndexedDB). Download a backup to move it to another device.'
        }
      >
        {storage.server && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-300">
            <span className={cn(sync.phase === 'error' && 'text-amber-600 dark:text-amber-400')}>{syncLine(sync)}</span>
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
    </Modal>
  );
}
