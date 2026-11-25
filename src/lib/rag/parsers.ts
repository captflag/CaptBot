import { Readability } from '@mozilla/readability';
import type { PDFPageProxy } from 'pdfjs-dist';
import TurndownService from 'turndown';
import type { ImageAttachment } from '../types';
import { TEXT_EXTENSION_SET } from './fileTypes';

export interface ParsedDoc {
  text: string;
  mimeType: string;
  title?: string;
  /** Start offset of each page in `text` (PDFs only). */
  pageOffsets?: number[];
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\x00/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Reads the text off scanned page images; resolves to one string per image, in order. */
export type PageOcr = (images: ImageAttachment[]) => Promise<string[]>;

export async function parseFile(file: File, ocr?: PageOcr): Promise<ParsedDoc> {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  if (ext === 'pdf' || file.type === 'application/pdf') return parsePdf(await file.arrayBuffer(), ocr);
  if (ext === 'docx') return parseDocx(await file.arrayBuffer());
  if (ext === 'html' || ext === 'htm' || file.type === 'text/html') return parseHtml(await file.text());
  if (ext === 'csv' || ext === 'tsv') {
    return { text: csvToText(await file.text(), ext === 'tsv' ? '\t' : ','), mimeType: 'text/csv' };
  }
  if (ext === 'json') return { text: jsonToText(await file.text()), mimeType: 'application/json' };
  if (TEXT_EXTENSION_SET.has(ext) || file.type.startsWith('text/')) {
    return { text: normalizeText(await file.text()), mimeType: file.type || 'text/plain' };
  }
  throw new Error(`Unsupported file type${ext ? ` .${ext}` : ''}. Try PDF, DOCX, HTML, Markdown, text, CSV or JSON.`);
}

// ---------- PDF ----------

function cleanPdfPage(raw: string): string {
  return raw
    .replace(/\x00/g, '') // some PDFs embed NUL characters, which Postgres text can't store
    .replace(/[ \t]+/g, ' ')
    .replace(/(\w)-\n(\w)/g, '$1$2') // re-join words hyphenated across lines
    .replace(/([^\n.!?:;])\n(?=[a-z(,])/g, '$1 ') // join lines wrapped mid-sentence
    .replace(/ *\n */g, '\n')
    .trim();
}

// ponytail: one model call per 4 scanned pages, with no wait when a rate limit is hit. Fine for
// reports and contracts; a scanned book on a limited key wants bigger batches or a pause-and-resume.
const OCR_BATCH = 4;

/** Renders a page as a JPEG about 1600 px on its long side: enough for small print, small enough to send. */
async function pageImage(page: PDFPageProxy, index: number): Promise<ImageAttachment> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(2, 1600 / Math.max(base.width, base.height)) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  const data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1] ?? '';
  canvas.width = canvas.height = 0; // release the bitmap
  return { name: `page-${index + 1}.jpg`, mimeType: 'image/jpeg', data };
}

/** Pages without a text layer (scans) are read with `ocr` when it is given. */
export async function parsePdf(data: ArrayBuffer, ocr?: PageOcr): Promise<ParsedDoc> {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const pdf = await task.promise;
  try {
    const pages: string[] = [];
    const scanned: number[] = [];
    const images: ImageAttachment[] = [];
    const readScanned = async () => {
      if (!ocr || !images.length) return;
      const texts = await ocr(images.splice(0));
      scanned.splice(0).forEach((p, j) => (pages[p] = normalizeText(texts[j] ?? '')));
    };
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let raw = '';
      for (const item of content.items) {
        if ('str' in item) raw += item.str + (item.hasEOL ? '\n' : '');
      }
      pages.push(cleanPdfPage(raw));
      if (ocr && !pages[i - 1]) {
        scanned.push(i - 1);
        images.push(await pageImage(page, i - 1));
        if (images.length >= OCR_BATCH) await readScanned();
      }
      page.cleanup();
    }
    await readScanned();
    const pageOffsets: number[] = [];
    let text = '';
    for (const page of pages) {
      if (text) text += '\n\n';
      pageOffsets.push(text.length);
      text += page;
    }
    if (!text.trim()) throw new Error(ocr ? 'No text could be read from this PDF, even from its page images.' : 'This PDF has no extractable text. It may be a scanned image; run OCR on it first.');
    const meta = await pdf.getMetadata().catch(() => null);
    const title = (meta?.info as { Title?: string } | undefined)?.Title?.trim() || undefined;
    return { text, pageOffsets, title, mimeType: 'application/pdf' };
  } finally {
    await task.destroy();
  }
}

// ---------- DOCX / HTML ----------

type Mammoth = { convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }> };

export async function parseDocx(data: ArrayBuffer): Promise<ParsedDoc> {
  const mod = (await import('mammoth')) as unknown as Mammoth & { default?: Mammoth };
  const mammoth = mod.default ?? mod;
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: data });
  return { text: normalizeText(htmlToMarkdown(html)), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
}

let turndown: TurndownService | null = null;

/** HTML → Markdown, keeping headings (which drive chunk sections) and tables, and dropping images and link URLs. */
export function htmlToMarkdown(html: string): string {
  if (!turndown) {
    turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
    turndown.remove(['script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'form']);
    turndown.addRule('dropImages', { filter: 'img', replacement: () => '' });
    turndown.addRule('plainLinks', { filter: 'a', replacement: (content) => content });
    turndown.addRule('tables', { filter: 'table', replacement: (_content, node) => `\n\n${tableToMarkdown(node as HTMLTableElement)}\n\n` });
  }
  return turndown.turndown(html);
}

/** A Markdown pipe table with the first row as its header, so every row keeps its column names. */
export function tableToMarkdown(table: HTMLTableElement): string {
  const rows = [...table.rows]
    .map((row) => [...row.cells].map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')))
    .filter((cells) => cells.some(Boolean));
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  return [line(rows[0]), line(new Array<string>(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
}

export function parseHtml(html: string): ParsedDoc {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let title = doc.title?.trim() || undefined;
  let contentHtml = doc.body?.innerHTML ?? '';
  try {
    const article = new Readability(doc.cloneNode(true) as Document).parse();
    if (article?.content && (article.textContent?.trim().length ?? 0) > 200) {
      contentHtml = article.content;
      title = article.title?.trim() || title;
    }
  } catch {
    // Readability can fail on unusual markup; fall back to the whole body.
  }
  let text = normalizeText(htmlToMarkdown(contentHtml));
  if (title && !/^#\s/.test(text)) text = `# ${title}\n\n${text}`;
  return { text, title, mimeType: 'text/html' };
}

// ---------- URL ----------

export async function fetchUrl(url: string, readerProxy: string, signal?: AbortSignal, ocr?: PageOcr): Promise<ParsedDoc> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch {
    if (signal?.aborted || !readerProxy.trim()) {
      throw new Error(
        'This site does not allow direct browser access (CORS). Set a reader proxy in Settings → Knowledge sources, or save the page and upload it as a file.',
      );
    }
    res = await fetch(readerProxy.trim() + url, { signal });
  }
  if (!res.ok) throw new Error(`Fetching the page failed (HTTP ${res.status}).`);
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('pdf')) return parsePdf(await res.arrayBuffer(), ocr);
  const body = await res.text();
  if (type.includes('html') || /^\s*<(!doctype|html)/i.test(body)) return parseHtml(body);
  return { text: normalizeText(body), mimeType: type.split(';')[0] || 'text/plain' };
}

// ---------- CSV / JSON ----------

export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** One line per row as "column: value; …" so each retrieved row carries its own headers. */
export function csvToText(text: string, delimiter = ','): string {
  const rows = parseCsv(text, delimiter).filter((r) => r.some((c) => c.trim()));
  if (rows.length < 2) return rows.map((r) => r.join(' | ')).join('\n');
  const [header, ...body] = rows;
  return body
    .map((r) => header.map((h, j) => `${h.trim() || `column ${j + 1}`}: ${(r[j] ?? '').trim()}`).join('; '))
    .join('\n');
}

export function jsonToText(raw: string): string {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return normalizeText(raw);
  }
  if (Array.isArray(data) && data.length && data.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    return data
      .map((r) =>
        Object.entries(r as Record<string, unknown>)
          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
          .join('; '),
      )
      .join('\n');
  }
  return JSON.stringify(data, null, 2);
}
