import { OCR_SYSTEM } from '../prompts';
import { createChatProvider } from '../providers';
import { withRetry } from '../providers/http';
import { complete } from '../providers/types';
import { getSettings } from '../settings';
import type { ImageAttachment } from '../types';
import { errorText } from './json';

const PAGE_MARK = /^=== page (\d+) ===[ \t]*$/gm;

/** Splits one transcription of several page images into a text per page, by its "=== page N ===" lines. */
export function splitPages(reply: string, count: number): string[] {
  const out = Array<string>(count).fill('');
  const marks = [...reply.matchAll(PAGE_MARK)];
  // No markers: keep the text rather than lose it, filed under the batch's first page.
  if (!marks.length) {
    out[0] = reply.trim();
    return out;
  }
  marks.forEach((m, i) => {
    const n = Number(m[1]);
    const slot = n >= 1 && n <= count ? n - 1 : 0;
    const text = reply.slice(m.index + m[0].length, marks[i + 1]?.index).trim();
    out[slot] = [out[slot], text].filter(Boolean).join('\n\n');
  });
  return out;
}

/** Reads scanned pages with the chat model (the fast one: this is copying, not reasoning). One text per image. */
export async function ocrPages(images: ImageAttachment[]): Promise<string[]> {
  const settings = getSettings();
  try {
    const chat = createChatProvider(settings);
    const reply = await withRetry(() =>
      complete(chat, {
        model: settings.chat.fastModel,
        system: OCR_SYSTEM,
        messages: [{ role: 'user', content: `Transcribe these ${images.length} page image(s), in order.`, images }],
        effort: 'low',
      }),
    );
    return splitPages(reply, images.length);
  } catch (err) {
    throw new Error(`This PDF is scanned, so its pages are read by the chat model, and that failed: ${errorText(err)}`, { cause: err });
  }
}
