import { BrainCircuit, Globe, Paperclip, Send, Square, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { SendInput } from '../hooks/useChat';
import type { ImageAttachment } from '../lib/types';
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
            ? 'border-violet-200 bg-violet-100 text-violet-700 dark:border-violet-800 dark:bg-violet-900/50 dark:text-violet-300'
            : 'border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-800 dark:bg-sky-900/50 dark:text-sky-300'
          : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:bg-white/5 dark:text-gray-400 dark:hover:bg-white/10',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

interface Props {
  busy: boolean;
  onSend: (input: SendInput) => void;
  onStop: () => void;
  webSearchAvailable: boolean;
  /** Text pushed in from outside (e.g. a saved prompt); nonce makes repeats re-apply. */
  seed: { text: string; nonce: number } | null;
}

export function Composer({ busy, onSend, onStop, webSearchAvailable, seed }: Props) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [deep, setDeep] = useState(false);
  const [web, setWeb] = useState(false);
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

  const tooLong = text.length > MAX_CHARS;
  const canSend = !busy && !tooLong && (text.trim().length > 0 || images.length > 0);

  const submit = () => {
    if (!canSend) return;
    onSend({ text: text.trim(), images, mode: deep ? 'research' : 'chat', webSearch: web && webSearchAvailable });
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
    <div className="rounded-2xl border border-gray-200 bg-white p-2.5 shadow-xl shadow-gray-200/50 transition focus-within:border-violet-300 dark:border-gray-800 dark:bg-[#0f0f0f] dark:shadow-black/50 dark:focus-within:border-violet-800">
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
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        onPaste={(e) => {
          if (e.clipboardData.files.length) void addImages(e.clipboardData.files);
        }}
        placeholder={deep ? 'Ask a research question…' : 'Ask about your documents, or anything else…'}
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
              className="rounded-xl bg-gray-900 p-2 text-white shadow-md transition hover:bg-black disabled:opacity-30 dark:bg-white dark:text-black dark:hover:bg-gray-200"
            >
              <Send size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
