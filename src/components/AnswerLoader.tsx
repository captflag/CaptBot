import { DotFlow } from '@/components/ui/dot-flow';

// Frames index a 7×7 dot grid (0–48); patterns taken from the DotFlow demo.
const SEARCHING = [
  [9, 16, 17, 15, 23],
  [10, 17, 18, 16, 24],
  [11, 18, 19, 17, 25],
  [18, 25, 26, 24, 32],
  [25, 32, 33, 31, 39],
  [32, 39, 40, 38, 46],
  [31, 38, 39, 37, 45],
  [30, 37, 38, 36, 44],
  [23, 30, 31, 29, 37],
  [31, 29, 37, 22, 24, 23, 38, 36],
  [16, 23, 24, 22, 30],
];

const WRITING = [
  [45, 38, 31, 24, 17, 23, 25],
  [38, 31, 24, 17, 10, 16, 18],
  [31, 24, 17, 10, 3, 9, 11],
  [24, 17, 10, 3, 2, 4],
  [17, 10, 3],
  [10, 3],
  [3],
  [],
  [45],
  [45, 38, 44, 46],
  [45, 38, 31, 37, 39],
  [45, 38, 31, 24, 30, 32],
];

const THINKING = [
  [0, 2, 4, 6, 20, 34, 48, 46, 44, 42, 28, 14, 8, 22, 36, 38, 40, 26, 12, 10, 16, 30, 24, 18, 32],
  [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 45, 47],
  [8, 22, 36, 38, 40, 26, 12, 10, 16, 30, 24, 18, 32],
  [9, 11, 15, 17, 19, 23, 25, 29, 31, 33, 37, 39],
  [16, 30, 24, 18, 32],
  [17, 23, 31, 25],
  [24],
  [17, 23, 31, 25],
  [16, 30, 24, 18, 32],
  [9, 11, 15, 17, 19, 23, 25, 29, 31, 33, 37, 39],
  [8, 22, 36, 38, 40, 26, 12, 10, 16, 30, 24, 18, 32],
  [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 45, 47],
];

export type AnswerPhase = 'searching' | 'writing' | 'thinking';

const PHASES: Record<AnswerPhase, { title: string; frames: number[][]; duration: number }> = {
  searching: { title: 'Searching your documents', frames: SEARCHING, duration: 150 },
  writing: { title: 'Writing the answer', frames: WRITING, duration: 100 },
  thinking: { title: 'Thinking', frames: THINKING, duration: 150 },
};

/**
 * Shown until the first token arrives. The label tracks the phase the answer is
 * really in (it is not a timed script): the chat view derives the phase from
 * retrieval progress.
 */
export function AnswerLoader({ phase }: { phase: AnswerPhase }) {
  const { title, frames, duration } = PHASES[phase];
  return (
    <div role="status" aria-live="polite" aria-label={title} className="w-fit">
      {/* One looping item per phase (repeatCount -1); remounting on phase change lets DotFlow re-measure its label. */}
      <DotFlow key={phase} items={[{ title, frames, duration, repeatCount: -1 }]} />
    </div>
  );
}
