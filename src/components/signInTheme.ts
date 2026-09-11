import { useSyncExternalStore, type ComponentProps, type CSSProperties } from 'react';
import type { SignIn } from '@clerk/react';

/** Sets the --d delay that the login page's entrance animations read, for staggering. */
export const delay = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
};

/** Tracks the `dark` class on <html>, which the app and the login page's toggle both set. */
export const useIsDark = () => useSyncExternalStore(subscribe, () => document.documentElement.classList.contains('dark'));

/** Switches the theme before sign-in. New accounts start with it. */
export function setTheme(theme: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem('captbot_theme', theme);
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this visit.
  }
}

type Appearance = NonNullable<ComponentProps<typeof SignIn>['appearance']>;

/** Clerk's sign-in form in the chat app's look: Inter, violet accent, rounded cards, gray borders. */
export function signInAppearance(dark: boolean): Appearance {
  const violet = dark ? '#8b5cf6' : '#7c3aed';
  const border = dark ? '#1f2937' : '#e5e7eb';
  return {
    variables: {
      colorPrimary: violet,
      colorPrimaryForeground: '#ffffff',
      colorForeground: dark ? '#f3f4f6' : '#111827',
      colorMutedForeground: dark ? '#9ca3af' : '#6b7280',
      colorBackground: dark ? '#0f0f0f' : '#ffffff',
      colorInput: dark ? '#1a1a1a' : '#ffffff',
      colorInputForeground: dark ? '#f3f4f6' : '#111827',
      colorNeutral: dark ? '#ffffff' : '#111827',
      colorBorder: border,
      colorRing: violet,
      borderRadius: '0.625rem',
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      fontFamilyButtons: 'Inter, ui-sans-serif, system-ui, sans-serif',
    },
    elements: {
      rootBox: { width: '100%' },
      cardBox: {
        width: '100%',
        maxWidth: '100%',
        borderRadius: '1rem',
        border: `1px solid ${border}`,
        // Same lift as the chat composer.
        boxShadow: dark ? '0 20px 25px -5px rgb(0 0 0 / 0.5)' : '0 20px 25px -5px rgb(229 231 235 / 0.5)',
      },
      card: { border: 'none', boxShadow: 'none' },
      headerTitle: { fontWeight: 600, letterSpacing: '-0.02em' },
      formFieldInput: {
        '&:focus': { borderColor: '#a78bfa', boxShadow: `0 0 0 3px ${dark ? 'rgb(76 29 149 / 0.5)' : '#ede9fe'}` },
      },
    },
  };
}
