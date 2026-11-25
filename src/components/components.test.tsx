import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SourceRef } from '../lib/types';
import { Markdown } from './Markdown';
import { Menu, MenuItem } from './Menu';
import { Modal } from './ui';

// jsdom has no layout, so nothing counts as shown; treat every attached element as visible.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentNode;
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const focused = () => document.activeElement as HTMLElement;

describe('Modal', () => {
  function Harness({ open }: { open: boolean }) {
    return (
      <>
        <button>Open</button>
        <Modal open={open} onClose={() => {}} title="Settings">
          <input aria-label="Name" />
          <input aria-label="Token" />
        </Modal>
      </>
    );
  }

  it('moves focus in, keeps Tab inside, and gives focus back on close', () => {
    const { rerender } = render(<Harness open={false} />);
    screen.getByText('Open').focus();
    rerender(<Harness open />);

    expect(focused()).toBe(screen.getByLabelText('Close'));
    screen.getByLabelText('Token').focus();
    fireEvent.keyDown(focused(), { key: 'Tab' });
    expect(focused()).toBe(screen.getByLabelText('Close'));
    fireEvent.keyDown(focused(), { key: 'Tab', shiftKey: true });
    expect(focused()).toBe(screen.getByLabelText('Token'));

    rerender(<Harness open={false} />);
    expect(focused()).toBe(screen.getByText('Open'));
  });
});

describe('Menu', () => {
  it('opens on the first item, moves with the arrow keys, and Esc returns to the button', () => {
    const picked = vi.fn();
    render(
      <Menu label="Chat actions" button="⋯" buttonClassName="">
        <MenuItem label="Rename" onSelect={picked} />
        <MenuItem label="Star" onSelect={picked} />
        <MenuItem label="Delete" onSelect={picked} />
      </Menu>,
    );
    const button = screen.getByRole('button', { name: 'Chat actions' });
    fireEvent.click(button);
    expect(focused()).toBe(screen.getByRole('menuitem', { name: 'Rename' }));
    fireEvent.keyDown(focused(), { key: 'ArrowDown' });
    expect(focused()).toBe(screen.getByRole('menuitem', { name: 'Star' }));
    fireEvent.keyDown(focused(), { key: 'End' });
    expect(focused()).toBe(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.keyDown(focused(), { key: 'ArrowDown' });
    expect(focused()).toBe(screen.getByRole('menuitem', { name: 'Rename' }));

    fireEvent.keyDown(focused(), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(focused()).toBe(button);
    expect(picked).not.toHaveBeenCalled();
  });
});

describe('citation chips', () => {
  const source = {
    n: 1,
    docId: 'd1',
    docName: 'report.md',
    text: 'Panels turn about a fifth of sunlight into power.',
    start: 0,
    end: 10,
    headingPath: ['Solar'],
  } as SourceRef;

  function renderAnswer() {
    const onCite = vi.fn();
    render(<Markdown content="Efficiency is about 20% [1]." sourceCount={1} onCite={onCite} citeSource={() => source} />);
    return { onCite, chip: screen.getByRole('button', { name: 'Open source 1' }) };
  }

  it('opens the passage on click where there is a pointer that hovers', () => {
    const { onCite, chip } = renderAnswer();
    fireEvent.click(chip);
    expect(onCite).toHaveBeenCalledWith(1);
  });

  it('on touch screens, shows the passage on the first tap and opens it on the second', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(hover: none)' }));
    const { onCite, chip } = renderAnswer();

    fireEvent.click(chip);
    expect(onCite).not.toHaveBeenCalled();
    expect(chip.parentElement?.hasAttribute('data-peek')).toBe(true);
    expect(screen.getByRole('tooltip').textContent).toContain('Tap the number again');

    fireEvent.click(chip);
    expect(onCite).toHaveBeenCalledWith(1);
  });

  it('on touch screens, tapping elsewhere hides the preview', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(hover: none)' }));
    const { chip } = renderAnswer();
    fireEvent.click(chip);
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(chip.parentElement?.hasAttribute('data-peek')).toBe(false);
  });
});
