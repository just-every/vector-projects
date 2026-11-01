import { Outlet, useLocation } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, useApiResource } from '../../../../app/api-client';
import { restoreSchema } from '../../../data/ui/restore-schema';
import { settingsSchema } from '../../schema';
import { LeaveGuard } from '../fields/leave-guard';
import { openSections } from './sections';
import { SettingsNav } from './settings-nav';
import { SettingsShellProvider, type SettingsShell } from './settings-context';
import '../settings.css';
import '../fields/fields.css';
import '../fields/controls.css';
import './rows.css';
import '../settings-shell.css';

/** An Owner's layout asks whether a restore is waiting; only then does Restore join the list. Others never ask. */
function RestoreScope({ owner, children }: { owner: boolean; children: (pending: boolean) => ReactNode }) {
  return owner ? <OwnerRestoreScope>{children}</OwnerRestoreScope> : <>{children(false)}</>;
}
function OwnerRestoreScope({ children }: { children: (pending: boolean) => ReactNode }) {
  const restore = useApiResource('/api/data/restore', restoreSchema, 30000);
  return <>{children(Boolean(restore.data?.restored && restore.data.status))}</>;
}

/** True while the content column is wide enough for the rail beside the pane (the same 54rem the CSS switches on). */
function useRailMode(shell: React.RefObject<HTMLElement | null>) {
  const [rail, setRail] = useState(true);
  useEffect(() => {
    const element = shell.current;
    if (!element) return;
    const measure = () => setRail(element.clientWidth >= 54 * parseFloat(getComputedStyle(document.documentElement).fontSize));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shell]);
  return rail;
}

/**
 * Settings: one section list (the rail on a wide screen, the index page on a phone) and one pane for the open
 * section. `/app/settings` is the index at every width; CSS, never a redirect, decides what shows.
 */
export function SettingsLayout() {
  const settings = useApiResource('/api/settings', settingsSchema, 5000);
  const pathname = useLocation({ select: location => location.pathname.replace(/\/$/, '') });
  const refused = settings.error instanceof ApiError && settings.error.status === 403;
  const role = settings.data?.role ?? (refused ? 'guest' : null);
  const index = pathname === '/app/settings';
  const shellElement = useRef<HTMLElement>(null);
  const rail = useRailMode(shellElement);
  const publish = useCallback((next: NonNullable<typeof settings.data>) => settings.publishReceipt(() => next), [settings.publishReceipt]);
  return <RestoreScope owner={role === 'owner'}>{restorePending => {
    const open = openSections(role, restorePending);
    const shell: SettingsShell = { data: settings.data, reload: settings.reload, publish, role, open, error: refused ? null : settings.error };
    return <SettingsShellProvider value={shell}>
      <main className="settings-shell" ref={shellElement}>
        <div className="settings-frame" data-view={index ? 'index' : 'section'}>
          <LeaveGuard />
          {index && <h1 className="settings-index-title">Settings</h1>}
          <SettingsNav open={open} pathname={pathname} lines={index && role !== null} loading={role === null && !settings.error} rail={rail} />
          <div className="settings-pane"><Outlet /></div>
        </div>
      </main>
    </SettingsShellProvider>;
  }}</RestoreScope>;
}
