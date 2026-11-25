import { Modal } from './ui';

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = mac ? '⌘' : 'Ctrl';

const GROUPS: { title: string; rows: [keys: string[], what: string][] }[] = [
  {
    title: 'Anywhere',
    rows: [
      [[MOD, 'K'], 'Find a chat, document or saved prompt, or run an action'],
      [['?'], 'Show this list'],
      [['Esc'], 'Close a dialog, menu or the evidence pane'],
    ],
  },
  {
    title: 'In the message box',
    rows: [
      [['Enter'], 'Send'],
      [['Shift', 'Enter'], 'New line'],
      [['/'], 'Commands: /research, /web, /tools and your saved prompts'],
      [['↑', '↓', 'Enter'], 'Move through a command list and pick'],
    ],
  },
  {
    title: 'Reading an answer',
    rows: [
      [['←', '→'], 'Previous or next source in the evidence pane'],
      [['Esc'], 'Stop editing a message without sending it'],
    ],
  },
];

/** Every keyboard shortcut in one place. Opened with "?" or from quick find. */
export function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <div className="space-y-5 p-5">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 font-mono text-[10px] tracking-wider text-muted uppercase">{g.title}</h3>
            <dl className="divide-y divide-line rounded-xl border border-line">
              {g.rows.map(([keys, what]) => (
                <div key={what} className="flex items-center justify-between gap-4 px-3 py-2.5">
                  <dt className="text-[13px] text-ink">{what}</dt>
                  <dd className="flex shrink-0 gap-1">
                    {keys.map((k) => (
                      <kbd
                        key={k}
                        className="min-w-6 rounded-md border border-line bg-canvas px-1.5 py-0.5 text-center font-mono text-[11px] text-ink shadow-[0_1px_0_var(--line)]"
                      >
                        {k}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
