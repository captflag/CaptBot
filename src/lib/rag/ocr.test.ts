import { describe, expect, it } from 'vitest';
import { splitPages } from './ocr';

describe('splitPages', () => {
  it('files each page of a batch transcription under its own page', () => {
    const reply = 'Here you go:\n=== page 1 ===\n# Invoice\nTotal: 42\n=== page 2 ===\n\n=== page 3 ===\nSigned, A.';
    expect(splitPages(reply, 3)).toEqual(['# Invoice\nTotal: 42', '', 'Signed, A.']);
  });

  it('keeps the text when the model writes no markers, or numbers a page that was not sent', () => {
    expect(splitPages('just text', 2)).toEqual(['just text', '']);
    expect(splitPages('=== page 1 ===\na\n=== page 7 ===\nb', 2)).toEqual(['a\n\nb', '']);
  });
});
