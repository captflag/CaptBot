import { describe, expect, it } from 'vitest';
import { chunkText, findSections, pageAt } from './chunker';

const para = (n: number, word = 'alpha') => Array.from({ length: n }, (_, i) => `The ${word} sentence number ${i} carries a few words.`).join(' ');

describe('chunkText', () => {
  const doc = `# Title\n\nIntro paragraph.\n\n## Part A\n\n${para(40)}\n\n## Part B\n\n${para(30, 'beta')}`;

  it('returns trimmed, exact spans of the source text within the size ceiling', () => {
    const chunks = chunkText(doc);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      const slice = doc.slice(c.start, c.end);
      expect(slice.length).toBeGreaterThan(0);
      expect(slice).toBe(slice.trim());
      expect(c.end - c.start).toBeLessThanOrEqual(450 * 4);
    }
  });

  it('keeps chunks inside heading sections and records the heading path', () => {
    const chunks = chunkText(doc);
    const beta = chunks.filter((c) => doc.slice(c.start, c.end).includes('beta'));
    expect(beta.length).toBeGreaterThan(0);
    for (const c of beta) {
      expect(c.headingPath).toEqual(['Title', 'Part B']);
      expect(doc.slice(c.start, c.end)).not.toContain('alpha');
    }
  });

  it('overlaps neighbouring chunks by whole sentences', () => {
    const text = para(80);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].start).toBeLessThan(chunks[i - 1].end);
      expect(chunks[i].start).toBeGreaterThan(chunks[i - 1].start);
      expect(text.slice(chunks[i].start, chunks[i].start + 4)).toBe('The ');
    }
  });

  it('never emits a chunk that lies wholly inside the previous one', () => {
    const text = `Short one. Tiny. ${'y'.repeat(90)} long. Tail words here.`;
    const chunks = chunkText(text, undefined, { targetTokens: 10, maxTokens: 30, overlapTokens: 5 });
    for (let i = 1; i < chunks.length; i++) {
      const [prev, cur] = [chunks[i - 1], chunks[i]];
      expect(cur.start >= prev.start && cur.end <= prev.end).toBe(false);
    }
  });

  it('hard-splits text with no sentence boundaries', () => {
    const text = 'x'.repeat(5000);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.end - c.start <= 450 * 4)).toBe(true);
    expect(chunks[chunks.length - 1].end).toBe(text.length);
  });

  it('maps chunks to 1-based pages', () => {
    const pages = [para(20, 'one'), para(20, 'two'), para(20, 'three')];
    const text = pages.join('\n\n');
    const offsets = [0, pages[0].length + 2, pages[0].length + pages[1].length + 4];
    const chunks = chunkText(text, offsets);
    const first = chunks.find((c) => text.slice(c.start, c.end).includes('three'))!;
    expect(first.pageEnd).toBe(3);
    expect(chunks[0].page).toBe(1);
  });
});

describe('findSections', () => {
  it('folds a heading-only section into the next one', () => {
    const text = '# A\n## B\nBody text here.';
    expect(findSections(text)).toEqual([{ start: 0, end: text.length, headingPath: ['A', 'B'] }]);
  });

  it('ignores headings inside code fences', () => {
    const text = '# Real\n\n```\n# not a heading\n```\n\nMore text.';
    const sections = findSections(text);
    expect(sections).toHaveLength(1);
    expect(sections[0].headingPath).toEqual(['Real']);
  });

  it('pops the heading stack on a sibling heading', () => {
    const text = '# A\n\nx.\n\n## B\n\ny.\n\n## C\n\nz.';
    expect(findSections(text).map((s) => s.headingPath)).toEqual([['A'], ['A', 'B'], ['A', 'C']]);
  });
});

describe('pageAt', () => {
  it('finds the page containing an offset', () => {
    expect(pageAt([0, 10, 20], 0)).toBe(1);
    expect(pageAt([0, 10, 20], 15)).toBe(2);
    expect(pageAt([0, 10, 20], 99)).toBe(3);
  });
});

describe('tables', () => {
  const HEADER = '| Region | Revenue | Growth |\n| --- | --- | --- |';
  const row = (i: number) => `| Region ${i} | ${1000 + i} | ${(i % 7) + 1}% |`;
  const table = (rows: number) => [HEADER, ...Array.from({ length: rows }, (_, i) => row(i))].join('\n');

  it('keeps a table that fits in one chunk whole', () => {
    const text = `# Report\n\nIntro sentence here.\n\n${table(5)}\n\nClosing words.`;
    const holders = chunkText(text).filter((c) => text.slice(c.start, c.end).includes('| Region |'));
    expect(holders).toHaveLength(1);
    expect(text.slice(holders[0].start, holders[0].end)).toContain(row(4));
  });

  it('splits a big table between rows and repeats the header on every later part', () => {
    const text = table(200);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].prefix).toBeUndefined();
    expect(text.slice(chunks[0].start, chunks[0].end).startsWith(HEADER)).toBe(true);
    for (const c of chunks.slice(1)) {
      expect(c.prefix).toBe(HEADER);
      const body = text.slice(c.start, c.end);
      expect(body.startsWith('| Region ')).toBe(true);
      expect(body.endsWith('% |')).toBe(true);
    }
    // Every row lands in exactly one chunk: split tables don't overlap.
    const rows = chunks.flatMap((c) => text.slice(c.start, c.end).split('\n')).filter((l) => /^\| Region \d/.test(l));
    expect(rows).toHaveLength(200);
  });

  it('splits a row too long for any chunk, keeping the header with every piece', () => {
    const huge = `| Region X | ${'word '.repeat(1000)}| 1% |`;
    const text = [HEADER, row(0), huge, row(1)].join('\n');
    const chunks = chunkText(text);
    expect(chunks.every((c) => c.end - c.start + (c.prefix?.length ?? 0) <= 450 * 4)).toBe(true);
    const pieces = chunks.filter((c) => text.slice(c.start, c.end).includes('word'));
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(p.prefix).toBe(HEADER);
    expect(chunks.some((c) => text.slice(c.start, c.end).includes(row(1)))).toBe(true);
  });
});

describe('CJK text', () => {
  it('sizes chunks in tokens, so CJK chunks hold far fewer characters', () => {
    const text = '日本語の文章です。'.repeat(400);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.end - c.start <= 450)).toBe(true);
    // Sentences end at 。 even without a following space.
    expect(chunks.every((c) => text.slice(c.start, c.end).endsWith('。'))).toBe(true);
  });
});
