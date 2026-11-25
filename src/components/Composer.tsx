import { useLiveQuery } from 'dexie-react-hooks';
import { Bookmark, BrainCircuit, Globe, Paperclip, Plug, Send, Square, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SendInput } from '../hooks/useChat';
import { db } from '../lib/db';
import { CHAT_PRESETS, hasChatKey, updateSettings, useSettings } from '../lib/settings';
import type { ImageAttachment, SavedPrompt } from '../lib/types';
import { cn, readImage } from '../lib/utils';
import { toast } from './Toaster';

const MAX_CHARS = 16_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function Chip({
  active,
  disabled,
  onClick,
  icon,
  label,
  title,
  tone,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  title: string;
  tone: 'violet' | 'sky';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? tone === 'violet'
            ? 'border-accent-200 bg-accent-100 text-accent-700 dark:border-accent-800 dark:bg-accent-900/50 dark:text-accent-300'
            : 'border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-800 dark:bg-sky-900/50 dark:text-sky-300'
          : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:bg-white/5 dark:text-gray-400 dark:hover:bg-white/10',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/** One row of the menu that opens when the message starts with "/". */
interface Command {
  key: string;
  label: string;
  hint: string;
  icon: ReactNode;
  run: () => void;
}

interface Props {
  busy: boolean;
  onSend: (input: SendInput) => void;
  onStop: () => void;
  webSearchAvailable: boolean;
  /** Connectors switched on in Settings; the Tools switch only shows when there is at least one. */
  connectorCount: number;
  /** Why connector tools can't be used right now (e.g. on the free tier); undefined when they can. */
  toolsBlocked?: string;
  /** Text pushed in from outside (e.g. a saved prompt); nonce makes repeats re-apply. */
  seed: { text: string; nonce: number } | null;
}

export function Composer({ busy, onSend, onStop, webSearchAvailable, connectorCount, toolsBlocked, seed }: Props) {
  const settings = useSettings();
  const [text, setText] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [deep, setDeep] = useState(false);
  const [web, setWeb] = useState(false);
  // Tools start on: adding a connector is the opt-in, and every call still asks first.
  const [tools, setTools] = useState(true);
  const toolsOn = tools && connectorCount > 0 && !toolsBlocked;
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!seed) return;
    setText(seed.text);
    textRef.current?.focus();
  }, [seed]);

  // Grow with the text, up to 240px. Also re-measure when the width changes: a measurement
  // taken while the layout was still narrow would otherwise stick until the next keystroke.
  const fit = useCallback(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, []);

  useLayoutEffect(fit, [text, fit]);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    let width = -1;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  // A message that is just "/" plus a word is a command being typed, not a question.
  const slash = text.startsWith('/') && !/\s/.test(text) ? text.slice(1).toLowerCase() : null;
  const prompts = useLiveQuery(() => db.prompts.orderBy('createdAt').reverse().toArray(), [], [] as SavedPrompt[]);
  const [cmd, setCmd] = useState(0);
  const commands = useMemo<Command[]>(() => {
    if (slash === null) return [];
    const toggles: Command[] = [
      { key: 'research', label: '/research', hint: deep ? 'Turn Deep Research off' : 'Plan sub-questions and write a cited report', icon: <BrainCircuit size={14} />, run: () => setDeep((d) => !d) },
    ];
    if (webSearchAvailable) {
      toggles.push({ key: 'web', label: '/web', hint: web ? 'Turn web search off' : 'Also ground the answer with web search', icon: <Globe size={14} />, run: () => setWeb((w) => !w) });
    }
    if (connectorCount > 0 && !toolsBlocked) {
      toggles.push({ key: 'tools', label: '/tools', hint: tools ? 'Turn connector tools off' : 'Let the answer use your connectors', icon: <Plug size={14} />, run: () => setTools((t) => !t) });
    }
    const saved = prompts
      .filter((p) => p.text.toLowerCase().includes(slash))
      .slice(0, 5)
      .map((p): Command => ({ key: p.id, label: p.text, hint: 'Saved prompt', icon: <Bookmark size={14} />, run: () => setText(p.text) }));
    return [...toggles.filter((c) => c.key.startsWith(slash)), ...saved];
  }, [slash, prompts, deep, web, webSearchAvailable, tools, connectorCount, toolsBlocked]);
  useEffect(() => setCmd(0), [slash]);

  const pick = (command: Command) => {
    setText('');
    command.run();
    textRef.current?.focus();
  };

  const tooLong = text.length > MAX_CHARS;
  const canSend = !busy && !tooLong && (text.trim().length > 0 || images.length > 0);

  const submit = () => {
    if (!canSend) return;
    onSend({ text: text.trim(), images, mode: deep ? 'research' : 'chat', webSearch: web && webSearchAvailable, tools: toolsOn });
    setText('');
    setImages([]);
  };

  const addImages = async (files: Iterable<File>) => {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    const tooBig = list.find((f) => f.size > MAX_IMAGE_BYTES);
    if (tooBig) {
      toast(`${tooBig.name} is larger than 8 MB.`, 'error');
      return;
    }
    const read = await Promise.all(list.map(readImage));
    setImages((prev) => [...prev, ...read].slice(0, 6));
  };

  return (
    <div className="relative rounded-2xl border border-line bg-surface p-2.5 shadow-[0_10px_30px_-18px_rgb(0_0_0/0.35)] transition-colors focus-within:border-accent-400 dark:focus-within:border-accent-600">
      {commands.length > 0 && (
        <div role="listbox" aria-label="Commands" className="anim-rise absolute bottom-full left-0 z-30 mb-2 w-full max-w-md rounded-xl border border-line bg-raised p-1.5 shadow-xl">
          {commands.map((c, i) => (
            <button
              key={c.key}
              type="button"
              role="option"
              aria-selected={i === cmd}
              // Keep the text box focused, so typing and the arrow keys carry on working.
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setCmd(i)}
              onClick={() => pick(c)}
              className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left', i === cmd && 'bg-canvas ring-1 ring-line')}
            >
              <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-md', i === cmd ? 'bg-accent-500 text-gray-950' : 'bg-canvas text-muted')}>{c.icon}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{c.label}</span>
              <span className="shrink-0 text-[11px] text-muted">{c.hint}</span>
            </button>
          ))}
        </div>
      )}
      {images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-1 pt-1 pb-2">
          {images.map((img, i) => (
            <div key={i} className="relative shrink-0">
              <img src={`data:${img.mimeType};base64,${img.data}`} alt={img.name} className="h-14 w-14 rounded-lg object-cover" />
              <button
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 rounded-full bg-gray-900 p-0.5 text-white dark:bg-white dark:text-black"
                aria-label={`Remove ${img.name}`}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={textRef}
        value={text}
        rows={1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (commands.length) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setCmd((c) => (c + (e.key === 'ArrowDown' ? 1 : commands.length - 1)) % commands.length);
              return;
            }
            if ((e.key === 'Enter' && !e.nativeEvent.isComposing) || e.key === 'Tab') {
              e.preventDefault();
              pick(commands[Math.min(cmd, commands.length - 1)]);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setText('');
              return;
            }
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        onPaste={(e) => {
          if (e.clipboardData.files.length) void addImages(e.clipboardData.files);
        }}
        placeholder={deep ? 'Ask a research question…' : 'Ask about your documents, or type / for commands'}
        aria-label="Message"
        className="scrollbar-thin max-h-60 w-full resize-none bg-transparent px-2 py-2 text-[15px] text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
      />
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <div className="flex items-center gap-1.5">
          <Chip
            active={deep}
            onClick={() => setDeep((d) => !d)}
            icon={<BrainCircuit size={14} />}
            label="Deep Research"
            title="Plan sub-questions, search your documents for each, and write a cited report"
            tone="violet"
          />
          <Chip
            active={web && webSearchAvailable}
            disabled={!webSearchAvailable}
            onClick={() => setWeb((w) => !w)}
            icon={<Globe size={14} />}
            label="Web"
            title={webSearchAvailable ? 'Also ground answers with Google Search' : 'Web search is available with Gemini models'}
            tone="sky"
          />
          {connectorCount > 0 && (
            <Chip
              active={toolsOn}
              disabled={Boolean(toolsBlocked)}
              onClick={() => setTools((t) => !t)}
              icon={<Plug size={14} />}
              label={`Tools · ${connectorCount}`}
              title={toolsBlocked ?? `Let the answer call tools from your ${connectorCount === 1 ? 'connector' : `${connectorCount} connectors`}. Each call asks first unless you allowed it always.`}
              tone="violet"
            />
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title="Attach images"
            aria-label="Attach images"
            className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/10 dark:hover:text-gray-200"
          >
            <Paperclip size={17} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void addImages(e.target.files ?? []);
              e.target.value = '';
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          {/* On the free tier the server picks the model, so there is nothing to switch. */}
          {hasChatKey(settings) && (
            <select
              value={settings.chat.model}
              onChange={(e) => updateSettings((s) => ({ ...s, chat: { ...s.chat, model: e.target.value } }))}
              aria-label="Model for answers"
              title={`Answering with ${settings.chat.model} (${CHAT_PRESETS[settings.chat.provider].label}). Change the provider in Settings.`}
              className="hidden max-w-[170px] cursor-pointer truncate rounded-full border border-line bg-canvas py-1.5 pr-7 pl-3 text-xs font-semibold text-ink transition outline-none hover:border-accent-500 focus-visible:border-accent-500 sm:block"
            >
              {[...new Set([settings.chat.model, ...CHAT_PRESETS[settings.chat.provider].models])].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
          {tooLong && (
            <span className="text-xs text-red-500">
              {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
            </span>
          )}
          {busy ? (
            <button onClick={onStop} title="Stop" aria-label="Stop" className="rounded-xl bg-gray-900 p-2 text-white shadow-md hover:opacity-80 dark:bg-white dark:text-black">
              <Square size={15} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!canSend}
              title="Send"
              aria-label="Send"
              className="rounded-xl bg-accent-500 p-2 text-gray-950 transition hover:bg-accent-400 active:scale-95 disabled:opacity-30"
            >
              <Send size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
