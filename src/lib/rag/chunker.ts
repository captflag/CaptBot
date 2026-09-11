/**
 * Structure-aware chunker.
 *
 * Chunks are spans over the original document text (not rewritten copies), so a
 * citation can highlight the exact passage in the source viewer. Markdown
 * headings define sections that chunks never cross; inside a section, text is
 * packed sentence-by-sentence toward a target size, preferring paragraph
 * boundaries, with a small sentence-aligned overlap between neighbours.
 * Markdown tables are never cut mid-row: a table stays whole when it fits, and a
 * bigger one is split between rows, each part repeating the header as its prefix.
 */

import { charsPerToken } from './tokens';

export interface ChunkSpan {
  start: number;
  end: number;
  headingPath: string[];
  page?: number;
  pageEnd?: number;
  /** Context the span needs but doesn't contain: a split table's header rows. */
  prefix?: string;
}

export interface ChunkOptions {
  /** Preferred chunk size in tokens. */
  targetTokens?: number;
  /** Hard ceiling for a single chunk in tokens. */
  maxTokens?: number;
  /** Trailing context repeated at the start of the next chunk, in tokens. */
  overlapTokens?: number;
}

type Span = [number, number];
type Packed = [number, number, string | undefined];

interface Section {
  start: number;
  end: number;
  headingPath: string[];
}

interface Unit {
  start: number;
  end: number;
  paragraphStart: boolean;
  /** Becomes a chunk of its own, never merged or overlapped: one part of a split table. */
  solo?: boolean;
  prefix?: string;
}

const HEADING_RE = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/gm;
const FENCE_RE = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm;
// Latin-script sentences end before whitespace; CJK text has no spaces, so its full stops end a sentence on their own.
const SENTENCE_RE = /[.!?]+["'”’)\]]*(?=\s)|[。！？]+[」』”’）]*|\n/g;
const TABLE_ROW_RE = /^[ \t]*\|.*\|[ \t]*$/;
const TABLE_SEPARATOR_RE = /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/;

export function chunkText(text: string, pageOffsets?: number[], opts: ChunkOptions = {}): ChunkSpan[] {
  // Sizes are in tokens; CJK text packs about one token per character, alphabetic text about four.
  const cpt = charsPerToken(text.slice(0, 200_000));
  const target = (opts.targetTokens ?? 300) * cpt;
  const max = Math.max(target, (opts.maxTokens ?? 450) * cpt);
  const overlap = Math.min((opts.overlapTokens ?? 50) * cpt, target / 2);

  const chunks: ChunkSpan[] = [];
  for (const section of findSections(text)) {
    const units = splitUnits(text, section.start, section.end, max);
    for (const [start, end, prefix] of packUnits(units, target, max, overlap)) {
      const chunk: ChunkSpan = { start, end, headingPath: section.headingPath };
      if (prefix) chunk.prefix = prefix;
      if (pageOffsets?.length) {
        chunk.page = pageAt(pageOffsets, start);
        chunk.pageEnd = pageAt(pageOffsets, end - 1);
      }
      chunks.push(chunk);
    }
  }
  return chunks;
}

export function findSections(text: string): Section[] {
  const fences: Span[] = [];
  for (const m of text.matchAll(FENCE_RE)) fences.push([m.index, m.index + m[0].length]);
  const inFence = (i: number) => fences.some(([a, b]) => i >= a && i < b);

  const raw: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  let start = 0;
  let path: string[] = [];
  for (const m of text.matchAll(HEADING_RE)) {
    if (inFence(m.index)) continue;
    if (m.index > start) raw.push({ start, end: m.index, headingPath: path });
    const level = m[1].length;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ level, title: m[2].trim() });
    start = m.index;
    path = stack.map((s) => s.title);
  }
  if (start < text.length) raw.push({ start, end: text.length, headingPath: path });

  // Fold heading-only sections (a heading directly followed by a sub-heading)
  // into the next section so no chunk is just a bare title.
  const sections: Section[] = [];
  let carry: number | null = null;
  for (const s of raw) {
    const body = text.slice(s.start, s.end);
    if (!body.trim()) continue;
    const newline = body.indexOf('\n');
    const rest = newline === -1 ? '' : body.slice(newline + 1);
    if (/^#{1,6}[ \t]/.test(body) && !rest.trim()) {
      carry ??= s.start;
      continue;
    }
    sections.push({ start: carry ?? s.start, end: s.end, headingPath: s.headingPath });
    carry = null;
  }
  if (carry !== null) {
    sections.push({ start: carry, end: text.length, headingPath: raw[raw.length - 1].headingPath });
  }
  return sections;
}

function splitUnits(text: string, start: number, end: number, max: number): Unit[] {
  const units: Unit[] = [];
  for (const [ps, pe] of paragraphs(text, start, end)) {
    const rows = tableLines(text, ps, pe);
    if (rows) {
      units.push(...tableUnits(text, rows, max));
      continue;
    }
    let first = true;
    for (const [ss, se] of sentences(text, ps, pe)) {
      for (const [hs, he] of hardSplit(text, ss, se, max)) {
        units.push({ start: hs, end: he, paragraphStart: first });
        first = false;
      }
    }
  }
  return units;
}

/** The lines of a Markdown table (header, separator, rows), or null if the paragraph isn't one. */
function tableLines(text: string, start: number, end: number): Span[] | null {
  const lines: Span[] = [];
  for (let from = start; from < end; ) {
    let nl = text.indexOf('\n', from);
    if (nl === -1 || nl > end) nl = end;
    lines.push([from, nl]);
    from = nl + 1;
  }
  if (lines.length < 3 || !TABLE_SEPARATOR_RE.test(text.slice(lines[1][0], lines[1][1]))) return null;
  return lines.every(([a, b]) => TABLE_ROW_RE.test(text.slice(a, b))) ? lines : null;
}

/** A table that fits stays one unit. A bigger one is split between rows, and every part after the first repeats the header. */
function tableUnits(text: string, lines: Span[], max: number): Unit[] {
  const start = lines[0][0];
  const end = lines[lines.length - 1][1];
  if (end - start <= max) return [{ start, end, paragraphStart: true }];

  // A very wide header is shortened as a prefix; the first part still carries it in full.
  const MAX_PREFIX = 1000;
  const header = text.slice(lines[0][0], lines[1][1]).slice(0, MAX_PREFIX);
  const room = Math.max(max - header.length, max / 2);
  const units: Unit[] = [];
  let group: Span | null = [start, lines[1][1]]; // the first part starts with the header itself
  const emit = () => {
    if (group) units.push({ start: group[0], end: group[1], paragraphStart: true, solo: true, prefix: units.length ? header : undefined });
    group = null;
  };
  for (const [a, b] of lines.slice(2)) {
    if (b - a > room) {
      // A row too long for any chunk is split on its own, each piece keeping the header as context.
      emit();
      for (const [s, e] of hardSplit(text, a, b, room)) units.push({ start: s, end: e, paragraphStart: true, solo: true, prefix: header });
      continue;
    }
    if (group && group[1] > group[0] && b - group[0] > (units.length ? room : max)) emit();
    if (group) group[1] = b;
    else group = [a, b];
  }
  emit();
  return units;
}

/** Packs units into chunks; solo units (parts of a split table) become chunks of their own. */
function packUnits(units: Unit[], target: number, max: number, overlap: number): Packed[] {
  const out: Packed[] = [];
  let run: Unit[] = [];
  const flush = () => {
    for (const [a, b] of packRun(run, target, max, overlap)) out.push([a, b, undefined]);
    run = [];
  };
  for (const u of units) {
    if (u.solo) {
      flush();
      out.push([u.start, u.end, u.prefix]);
    } else {
      run.push(u);
    }
  }
  flush();
  return out;
}

function packRun(units: Unit[], target: number, max: number, overlap: number): Span[] {
  const spans: Span[] = [];
  let i = 0;
  while (i < units.length) {
    const start = units[i].start;
    let j = i;
    while (j + 1 < units.length) {
      const next = units[j + 1];
      if (next.end - start > target) break;
      // Once reasonably full, prefer to stop at a paragraph boundary.
      if (next.paragraphStart && units[j].end - start >= target * 0.75) break;
      j++;
    }
    spans.push([start, units[j].end]);
    if (j + 1 >= units.length) break;

    // Step back over trailing sentences that fit in the overlap budget.
    let k = j + 1;
    while (k - 1 > i && units[j].end - units[k - 1].start <= overlap) k--;
    // If the next sentence can't fit alongside the overlap, starting at k would yield a chunk
    // lying wholly inside this one; skip the overlap instead.
    if (k <= j && units[j + 1].end - units[k].start > target) k = j + 1;
    i = k;
  }

  if (spans.length > 1) {
    const last = spans[spans.length - 1];
    const prev = spans[spans.length - 2];
    if (last[1] - last[0] < target * 0.25 && last[1] - prev[0] <= max) {
      prev[1] = last[1];
      spans.pop();
    }
  }
  return spans;
}

function paragraphs(text: string, start: number, end: number): Span[] {
  const slice = text.slice(start, end);
  const spans: Span[] = [];
  let from = 0;
  for (const m of slice.matchAll(/\n[ \t]*\n/g)) {
    pushTrimmed(text, spans, start + from, start + m.index);
    from = m.index + m[0].length;
  }
  pushTrimmed(text, spans, start + from, end);
  return spans;
}

function sentences(text: string, start: number, end: number): Span[] {
  const slice = text.slice(start, end);
  const spans: Span[] = [];
  let from = 0;
  for (const m of slice.matchAll(SENTENCE_RE)) {
    const cut = m.index + m[0].length;
    pushTrimmed(text, spans, start + from, start + cut);
    from = cut;
  }
  pushTrimmed(text, spans, start + from, end);
  return spans;
}

function hardSplit(text: string, start: number, end: number, max: number): Span[] {
  if (end - start <= max) return [[start, end]];
  const spans: Span[] = [];
  let from = start;
  while (end - from > max) {
    let cut = text.lastIndexOf(' ', from + max);
    if (cut <= from + max / 2) cut = Math.floor(from + max);
    pushTrimmed(text, spans, from, cut);
    from = cut;
  }
  pushTrimmed(text, spans, from, end);
  return spans;
}

function pushTrimmed(text: string, out: Span[], a: number, b: number) {
  while (a < b && isSpace(text.charCodeAt(a))) a++;
  while (b > a && isSpace(text.charCodeAt(b - 1))) b--;
  if (b > a) out.push([a, b]);
}

function isSpace(c: number) {
  return c === 32 || (c >= 9 && c <= 13) || c === 160;
}

/** 1-based page number containing `pos`, given each page's start offset. */
export function pageAt(pageOffsets: number[], pos: number): number {
  let lo = 0;
  let hi = pageOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pageOffsets[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
