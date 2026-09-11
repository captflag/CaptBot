import { motion } from 'motion/react';
import { cn } from '../lib/utils';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showText?: boolean;
}

const SIZES = { sm: 'h-6 w-6', md: 'h-9 w-9', lg: 'h-20 w-20' };

export function Logo({ size = 'md', className, showText = true }: LogoProps) {
  const small = size === 'sm';
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className={cn('relative flex shrink-0 items-center justify-center', SIZES[size])}>
        <div className="absolute inset-[-20%] rounded-full bg-violet-600/25 blur-xl" />
        {!small && (
          <motion.svg
            viewBox="0 0 100 100"
            className="pointer-events-none absolute inset-[-15%] h-[130%] w-[130%] text-violet-600 opacity-30"
            animate={{ rotate: 360 }}
            transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
          >
            <circle cx="50" cy="50" r="49" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 4" />
          </motion.svg>
        )}
        <motion.div
          className="absolute inset-0 rounded-full border-2 border-transparent border-t-violet-500 border-l-indigo-400/80"
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          className="absolute inset-[12%] rounded-full border-[1.5px] border-transparent border-r-violet-400/40 border-b-cyan-400/80"
          animate={{ rotate: -360 }}
          transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
        />
        <div className="absolute inset-[28%] rounded-full bg-linear-to-br from-indigo-600 via-violet-700 to-violet-900 shadow-inner" />
        <div className="absolute z-10 h-[18%] w-[18%] rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,1)]" />
      </div>
      {showText && size !== 'lg' && (
        <div className="flex flex-col">
          <span className="text-[15px] leading-tight font-bold tracking-tight text-gray-900 dark:text-white">CaptBot</span>
          {!small && <span className="mt-0.5 text-[9px] font-semibold tracking-[0.2em] text-violet-500 uppercase">Knowledge</span>}
        </div>
      )}
    </div>
  );
}
