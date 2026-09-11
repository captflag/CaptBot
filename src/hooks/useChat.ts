import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useRef, useState } from 'react';
import { toast } from '../components/Toaster';
import { db, threadMessages, uid } from '../lib/db';
import { isAbort } from '../lib/providers/http';
import { answer } from '../lib/rag/answer';
import { errorText } from '../lib/rag/json';
import { getSettings } from '../lib/settings';
import type { ChatMessage, ImageAttachment, Thread, WebSource } from '../lib/types';

export interface SendInput {
  text: string;
  images: ImageAttachment[];
  mode: 'chat' | 'research';
  webSearch: boolean;
}

const EMPTY: ChatMessage[] = [];

function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Image question';
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}

function mergeWeb(a: WebSource[] = [], b: WebSource[]): WebSource[] {
  const seen = new Set(a.map((s) => s.uri));
  return [...a, ...b.filter((s) => !seen.has(s.uri) && seen.add(s.uri))];
}

/**
 * Chat controller: persists messages to IndexedDB and streams the assistant
 * reply into an in-memory message until it is saved. One reply runs at a time.
 */
export function useChat(threadId: string | null, onThreadCreated: (id: string) => void, newThreadScope: string[]) {
  const stored = useLiveQuery(() => (threadId ? threadMessages(threadId) : EMPTY), [threadId], EMPTY);
  const [live, setLive] = useState<ChatMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const messages = live && live.threadId === threadId && !stored.some((m) => m.id === live.id) ? [...stored, live] : stored;

  /** Takes the in-flight slot synchronously, so a double click can't start two replies. */
  const claim = useCallback(() => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setLive(null);
    return true;
  }, []);

  const release = useCallback(() => {
    abortRef.current = null;
    busyRef.current = false;
    setBusy(false);
  }, []);

  const run = useCallback(
    async (thread: Thread, history: ChatMessage[], question: ChatMessage) => {
      const controller = new AbortController();
      abortRef.current = controller;
      const mode = question.mode ?? 'chat';
      const msg: ChatMessage = {
        id: uid(),
        threadId: thread.id,
        role: 'assistant',
        content: '',
        createdAt: Math.max(Date.now(), question.createdAt + 1),
        mode,
        model: getSettings().chat.model,
      };
      setLive({ ...msg });

      let frame = 0;
      const flush = () => {
        frame = 0;
        setLive({ ...msg });
      };
      try {
        const events = answer({
          thread,
          history,
          question: question.content,
          images: question.images,
          mode,
          webSearch: Boolean(question.webSearch),
          signal: controller.signal,
        });
        for await (const e of events) {
          if (e.type === 'text') msg.content += e.text;
          else if (e.type === 'retrieval') {
            msg.sources = e.sources;
            msg.trace = e.trace;
          } else if (e.type === 'steps') msg.steps = e.steps;
          else msg.webSources = mergeWeb(msg.webSources, e.webSources);
          if (!frame) frame = requestAnimationFrame(flush);
        }
      } catch (err) {
        if (controller.signal.aborted || isAbort(err)) msg.aborted = true;
        else msg.error = errorText(err);
        msg.steps = msg.steps?.map((s) => (s.status === 'running' ? { ...s, status: 'error', detail: msg.aborted ? 'Stopped' : s.detail } : s));
      } finally {
        cancelAnimationFrame(frame);
        setLive({ ...msg });
        try {
          await db.transaction('rw', db.messages, db.threads, async () => {
            // The chat may have been deleted while the reply streamed; don't leave an orphan behind.
            if (!(await db.threads.get(thread.id))) return;
            await db.messages.put(msg);
            await db.threads.update(thread.id, { updatedAt: Date.now() });
          });
        } catch (err) {
          toast(`The reply couldn't be saved: ${errorText(err)}`, 'error');
        } finally {
          release();
        }
      }
    },
    [release],
  );

  const send = useCallback(
    async (input: SendInput) => {
      if (!claim()) return;
      try {
        const now = Date.now();
        let thread = threadId ? await db.threads.get(threadId) : undefined;
        if (!thread) {
          thread = { id: uid(), title: titleFrom(input.text), collectionIds: newThreadScope, createdAt: now, updatedAt: now };
          await db.threads.add(thread);
          onThreadCreated(thread.id);
        }
        const history = await threadMessages(thread.id);
        const question: ChatMessage = {
          id: uid(),
          threadId: thread.id,
          role: 'user',
          content: input.text,
          createdAt: now,
          images: input.images.length ? input.images : undefined,
          mode: input.mode,
          webSearch: input.webSearch || undefined,
        };
        await db.messages.add(question);
        await run(thread, history, question);
      } catch (err) {
        release();
        throw err;
      }
    },
    [threadId, newThreadScope, onThreadCreated, run, claim, release],
  );

  /** Regenerates an assistant reply from the user message before it, with that message's settings. */
  const retry = useCallback(
    async (assistantId: string) => {
      if (!threadId || !claim()) return;
      try {
        const all = await threadMessages(threadId);
        const idx = all.findIndex((m) => m.id === assistantId);
        const question = all[idx - 1];
        const thread = await db.threads.get(threadId);
        if (idx < 1 || question?.role !== 'user' || !thread) {
          release();
          return;
        }
        await db.messages.delete(assistantId);
        await run(thread, all.slice(0, idx - 1), question);
      } catch (err) {
        release();
        toast(errorText(err), 'error');
      }
    },
    [threadId, run, claim, release],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const togglePin = useCallback((m: ChatMessage) => {
    void db.messages.update(m.id, { pinned: !m.pinned });
  }, []);

  return { messages, busy, liveId: busy ? live?.id : undefined, send, stop, retry, togglePin };
}
