import { useId, type CSSProperties } from 'react';
import { cn } from '../lib/utils';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** An answer is being written: the arcs turn and the point beats until it is done. */
  busy?: boolean;
  /** Show "capt" beside the symbol (headers, the start screen); the symbol alone fits the rail and answers. */
  withWord?: boolean;
}

/** Side of the symbol in pixels. */
const SIZES = { sm: 32, md: 40, lg: 84 };

/**
 * The capt mark, "Aperture": on a dark glass tile, two arcs close on a green point like a lens
 * focusing on what matters. The tile stays dark in both themes, so the mark reads the same everywhere.
 */
export function Logo({ size = 'md', className, busy = false, withWord = false }: LogoProps) {
  // Each mark needs its own gradient id: one shared id breaks every mark whenever the first is hidden.
  const gradient = `capt-mark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const px = SIZES[size];
  return (
    <span
      role="img"
      aria-label="capt"
      data-busy={busy || undefined}
      className={cn('logo inline-flex shrink-0 items-center select-none', className)}
      style={{ gap: px * 0.3 }}
    >
      <svg aria-hidden="true" width={px} height={px} viewBox="0 0 48 48" className="shrink-0 overflow-visible">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3dffb0" />
            <stop offset="1" stopColor="#14b8a6" />
          </linearGradient>
        </defs>
        <rect x="0.5" y="0.5" width="47" height="47" rx="13" fill="#0b0d10" stroke="#262b33" />
        {/* The resting angles live on the wrappers, so the arcs' own animations can turn them freely. */}
        <g transform="rotate(47 24 24)">
          <circle className="mark-outer" cx="24" cy="24" r="15" fill="none" stroke={`url(#${gradient})`} strokeWidth="4.5" strokeLinecap="round" strokeDasharray="70 24.2" />
        </g>
        <g transform="rotate(54 24 24)">
          <circle className="mark-inner" cx="24" cy="24" r="8.5" fill="none" stroke="#eef1f4" strokeWidth="3.4" strokeLinecap="round" strokeDasharray="38 15.4" opacity="0.9" />
        </g>
        <circle className="mark-dot" cx="35.5" cy="24" r="2.6" fill="#3dffb0" />
      </svg>
      {withWord && (
        <span aria-hidden="true" className="logo-word inline-flex leading-none font-extrabold whitespace-nowrap text-ink" style={{ fontFamily: "'Geist', var(--font-sans)", fontSize: px * 0.88, letterSpacing: '-0.06em' }}>
          {[...'capt'].map((letter, i) => (
            <i key={i} style={{ '--i': i } as CSSProperties}>
              {letter}
            </i>
          ))}
        </span>
      )}
    </span>
  );
}
