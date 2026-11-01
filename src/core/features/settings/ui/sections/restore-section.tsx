import { Link } from '@tanstack/react-router';
import { RestorePanel } from '../../../data/ui/restore-panel';
import { Denied } from '../shell/section-gate';
import { SectionPage, Skeleton } from '../shell/section-page';
import { useSettingsShell } from '../shell/settings-context';

/** Restore review exists only while a restore is pending, and only for an Owner; otherwise one quiet line. */
export function RestoreSection() {
  const { role, open } = useSettingsShell();
  if (role === null) return <SectionPage title="Restore"><Skeleton /></SectionPage>;
  if (role !== 'owner') return <Denied title="Restore" />;
  if (!open.includes('restore'))
    return <SectionPage title="Restore"><p className="settings-notfound" role="status">No restore is waiting for review. <Link to="/app/settings">Back to Settings</Link></p></SectionPage>;
  return <SectionPage title="Restore" legacy><RestorePanel /></SectionPage>;
}
