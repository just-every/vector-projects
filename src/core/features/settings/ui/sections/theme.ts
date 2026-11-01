import type { ThemeChoice } from '../../appearance-schema';

export const themeLabel = (theme: ThemeChoice) => ({ system: 'System', light: 'Light', dark: 'Dark' })[theme];
/** The look the page is wearing now: the saved choice at load, then whatever was last picked. */
export const currentTheme = (): ThemeChoice => {
  const applied = typeof document === 'undefined' ? undefined : document.documentElement.dataset.theme;
  return applied === 'light' || applied === 'dark' ? applied : 'system';
};
