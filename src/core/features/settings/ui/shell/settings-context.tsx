import { createContext, useContext } from 'react';
import type { z } from 'zod';
import type { settingsSchema } from '../../schema';
import type { Role } from '../../../roles/matrix';
import type { SectionKey } from './sections';

type Settings = z.infer<typeof settingsSchema>;
export type SettingsShell = {
  /** The last `/api/settings` read, refreshed every 5 s by the layout. */
  data: Settings | null;
  reload: () => void;
  publish: (next: Settings) => void;
  /** Null until the read answers; 'guest' when the read is refused (a Guest opens Account only). */
  role: Role | null;
  open: readonly SectionKey[];
  error: Error | null;
};

const Context = createContext<SettingsShell | null>(null);
export const SettingsShellProvider = Context.Provider;
export function useSettingsShell() {
  const value = useContext(Context);
  if (!value) throw Error('Settings pages render inside the Settings layout.');
  return value;
}
