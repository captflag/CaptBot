import { describe, expect, it } from 'vitest';
import { readSSE } from '../providers/sse';
import { csvToText, jsonToText, normalizeText, parseCsv, parseHtml } from './parsers';

describe('CSV', () => {
  it('handles quotes, escaped quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });

  it('writes one self-describing line per row', () => {
    expect(csvToText('name,role\nAda,Engineer\nGrace,Admiral')).toBe('name: Ada; role: Engineer\nname: Grace; role: Admiral');
  });
});

describe('jsonToText', () => {
  it('flattens arrays of records and pretty-prints other JSON', () => {
    expect(jsonToText('[{"id":1,"tags":["a"]}]')).toBe('id: 1; tags: ["a"]');
    expect(jsonToText('{"a":1}')).toBe('{\n  "a": 1\n}');
  });
});

describe('normalizeText', () => {
  it('normalizes newlines and collapses blank runs without touching spaces', () => {
    expect(normalizeText('a b\r\n\r\n\r\n\r\nc  \n')).toBe('a b\n\nc');
  });
});

describe('parseHtml', () => {
  it('keeps headings as markdown and drops scripts, images and link URLs', () => {
    const html = `<html><head><title>Guide</title><script>evil()</script></head><body>
      <h1>Guide</h1><h2>Setup</h2><p>Install the <a href="https://x.test">tool</a> first.</p><img src="a.png" alt="pic"></body></html>`;
    const { text, title } = parseHtml(html);
    expect(title).toBe('Guide');
    expect(text).toContain('# Guide');
    expect(text).toContain('## Setup');
    expect(text).toContain('Install the tool first.');
    expect(text).not.toMatch(/evil|https:|a\.png/);
  });
});

describe('readSSE', () => {
  const response = (parts: string[]) =>
    new Response(
      new ReadableStream({
        start(c) {
          for (const p of parts) c.enqueue(new TextEncoder().encode(p));
          c.close();
        },
      }),
    );

  it('parses events split across chunks, CRLF line endings and comments', async () => {
    const events = [];
    for await (const e of readSSE(response(['data: {"a"', ':1}\r\n\r', '\nevent: done\ndata: x\ndata: y\n\n', ': ping\n\ndata: tail']))) {
      events.push(e);
    }
    expect(events).toEqual([
      { event: 'message', data: '{"a":1}' },
      { event: 'done', data: 'x\ny' },
      { event: 'message', data: 'tail' },
    ]);
  });
});
