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

/** Clerk's sign-in form in the chat app's look: green accent, rounded cards, cool grey borders. */
export function signInAppearance(dark: boolean): Appearance {
  const accent = dark ? '#19b77b' : '#0f9966';
  const border = dark ? '#333842' : '#e1e5ea';
  return {
    variables: {
      colorPrimary: accent,
      colorPrimaryForeground: '#ffffff',
      colorForeground: dark ? '#e9ebee' : '#1c2128',
      colorMutedForeground: dark ? '#8b93a0' : '#6b7380',
      colorBackground: dark ? '#1b1e24' : '#ffffff',
      colorInput: dark ? '#2f343d' : '#ffffff',
      colorInputForeground: dark ? '#e9ebee' : '#1c2128',
      colorNeutral: dark ? '#ffffff' : '#1c2128',
      colorBorder: border,
      colorRing: accent,
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
        boxShadow: dark ? '0 20px 25px -5px rgb(0 0 0 / 0.5)' : '0 20px 25px -5px rgb(199 205 213 / 0.5)',
      },
      card: { border: 'none', boxShadow: 'none' },
      headerTitle: { fontWeight: 600, letterSpacing: '-0.02em' },
      formFieldInput: {
        '&:focus': { borderColor: '#2fc98c', boxShadow: `0 0 0 3px ${dark ? 'rgb(12 125 84 / 0.5)' : '#c9f5e2'}` },
      },
    },
  };
}
