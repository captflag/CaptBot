import { useEffect } from 'react';
import { getAuthToken, serverTierAvailable } from '../lib/auth/session';
import { refreshUsage, useUsage } from '../lib/auth/usage';
import { cn } from '../lib/utils';

/** Today's free-tier allowance. Renders nothing unless the user is signed in. */
export function UsageMeter({ compact = false }: { compact?: boolean }) {
  const usage = useUsage();
  const enabled = serverTierAvailable();

  useEffect(() => {
    if (enabled) void refreshUsage(getAuthToken).catch(() => undefined);
  }, [enabled]);

  const chat = usage.chat;
  if (!enabled || !chat) return null;
  const pct = chat.limit ? Math.max(0, Math.min(100, (chat.remaining / chat.limit) * 100)) : 0;
  const resets = new Date(chat.reset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const low = pct <= 15;

  return (
    <div
      className={compact ? 'mt-1' : 'space-y-1.5'}
      title={`Free tier: ${chat.remaining} of ${chat.limit} AI calls left today, resets at ${resets}`}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-2',
          compact ? 'text-[10px]' : 'text-xs',
          low ? 'text-amber-600 dark:text-amber-500' : 'text-gray-500 dark:text-gray-400',
        )}
      >
        <span className="truncate">{compact ? `${chat.remaining}/${chat.limit} free calls` : `${chat.remaining} of ${chat.limit} AI calls left today`}</span>
        {!compact && <span className="shrink-0">resets at {resets}</span>}
      </div>
      <div className={cn('overflow-hidden rounded-full bg-gray-200 dark:bg-white/10', compact ? 'h-0.5' : 'h-1.5')}>
        <div className={cn('h-full rounded-full transition-all', low ? 'bg-amber-500' : 'bg-accent-500')} style={{ width: `${pct}%` }} />
      </div>
      {!compact && usage.embed && (
        <div className="text-[11px] text-gray-500 dark:text-gray-400">
          {usage.embed.remaining} of {usage.embed.limit} indexing requests left today (each covers up to 100 chunks).
        </div>
      )}
    </div>
  );
}
