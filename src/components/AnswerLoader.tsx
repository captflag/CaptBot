import type { CSSProperties } from 'react';

export type AnswerPhase = 'searching' | 'writing' | 'thinking';

const TITLES: Record<AnswerPhase, string> = {
  searching: 'Searching your documents',
  writing: 'Writing the answer',
  thinking: 'Thinking',
};

/**
 * Shown until the first words of an answer arrive: three bars rising in turn, and a line that
 * says what is really happening (the chat view derives it from retrieval progress, not a timer).
 */
export function AnswerLoader({ phase, label }: { phase: AnswerPhase; label?: string }) {
  const title = label ?? TITLES[phase];
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2.5 py-1">
      <span aria-hidden="true" className="loader-bars">
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ '--i': i } as CSSProperties} />
        ))}
      </span>
      {/* Keyed by the text, so each new status fades in rather than swapping abruptly. */}
      <span key={title} className="loader-text anim-fade text-[13px] font-semibold">
        {title}
      </span>
    </div>
  );
}
