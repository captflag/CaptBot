export interface SSEEvent {
  event: string;
  data: string;
}

/** Minimal spec-compliant Server-Sent Events reader over a fetch Response body. */
export async function* readSSE(res: Response, signal?: AbortSignal): AsyncGenerator<SSEEvent> {
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const onAbort = () => reader.cancel().catch(() => {});
  signal?.addEventListener('abort', onAbort, { once: true });

  let buf = '';
  let pendingCR = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      let chunk = value;
      if (pendingCR) chunk = '\r' + chunk;
      pendingCR = chunk.endsWith('\r');
      if (pendingCR) chunk = chunk.slice(0, -1);
      buf += chunk.replace(/\r\n?/g, '\n');

      let idx: number;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const evt = parseBlock(block);
        if (evt) yield evt;
      }
    }
    const tail = parseBlock(buf);
    if (tail) yield tail;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

export function parseBlock(block: string): SSEEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: data.join('\n') } : null;
}
