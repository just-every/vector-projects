import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { fetchJson, useApiResource } from '../../../../app/api-client';
import { administrationSchema, type Administration } from '../../../administration/schema';
import { SectionPage, Skeleton } from '../shell/section-page';
import { useSettingsShell } from '../shell/settings-context';

type Value = { data: Administration; publish: (next: Administration) => void; reload: () => void };
const Context = createContext<Value | null>(null);
export function useAdministration() {
  const value = useContext(Context);
  if (!value) throw Error('Administration reads render inside a section that loaded them.');
  return value;
}

/** Reads the administration snapshot once for a section and shares it, with its reload, with every control under it. */
export function AdministrationScope({ title, children }: { title: string; children: ReactNode }) {
  const administration = useApiResource('/api/settings/administration', administrationSchema);
  const { publishReceipt, reload } = administration;
  const publish = useCallback((next: Administration) => publishReceipt(() => next), [publishReceipt]);
  if (administration.data) return <Context.Provider value={{ data: administration.data, publish, reload }}>{children}</Context.Provider>;
  if (administration.error) return <SectionPage title={title}><p role="alert">{administration.error.message} <button type="button" className="field-retry" onClick={reload}>Retry</button></p></SectionPage>;
  return <SectionPage title={title}><Skeleton /></SectionPage>;
}

/**
 * One call to an administration door. Every one answers with the new snapshot, which is published before the call
 * resolves so no older read flashes back; `/api/settings` is refreshed too, for the lists that read it.
 */
export function useAdministrationCall() {
  const { publish } = useAdministration();
  const shell = useSettingsShell();
  return useCallback(async (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => {
    const result = await fetchJson(path, administrationSchema, {
      method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    publish(result);
    shell.reload();
    return result;
  }, [publish, shell.reload]);
}
