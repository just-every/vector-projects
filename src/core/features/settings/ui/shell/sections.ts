import { opensSettingsPage, type Role } from '../../../roles/matrix';

export type SectionKey = 'profile' | 'notifications' | 'workspace' | 'people' | 'teams' | 'labels'
  | 'connections' | 'developers' | 'move-in' | 'audit' | 'restore';
export type SectionGroup = 'You' | 'Workspace' | 'Connect' | 'Data';

/** The section list, in the order it is shown. One list serves the rail and the phone index. */
export const sections = [
  { key: 'profile', label: 'Profile', group: 'You', path: '/app/settings/profile' },
  { key: 'notifications', label: 'Notifications', group: 'You', path: '/app/settings/notifications' },
  { key: 'workspace', label: 'Workspace', group: 'Workspace', path: '/app/settings/workspace' },
  { key: 'people', label: 'People', group: 'Workspace', path: '/app/settings/people' },
  { key: 'teams', label: 'Teams', group: 'Workspace', path: '/app/settings/teams' },
  { key: 'labels', label: 'Labels', group: 'Workspace', path: '/app/settings/labels' },
  { key: 'connections', label: 'Connections', group: 'Connect', path: '/app/settings/connections' },
  { key: 'developers', label: 'Developers', group: 'Connect', path: '/app/settings/developers' },
  { key: 'move-in', label: 'Move in', group: 'Data', path: '/app/settings/move-in' },
  { key: 'audit', label: 'Audit log', group: 'Data', path: '/app/settings/audit' },
  { key: 'restore', label: 'Restore', group: 'Data', path: '/app/settings/restore' },
] as const satisfies readonly { key: SectionKey; label: string; group: SectionGroup; path: string }[];
export type SectionPath = typeof sections[number]['path'];
export const sectionByKey = (key: SectionKey) => sections.find(section => section.key === key)!;

/**
 * Which sections a role may open (the "Open Settings pages" row). A Guest, whose settings read is refused,
 * is passed as 'guest'. Restore is listed only to an Owner while a restore is pending.
 */
export function openSections(role: Role | null, restorePending: boolean): SectionKey[] {
  if (role === null) return [];
  const open = (key: SectionKey) => {
    switch (key) {
      case 'profile': case 'notifications': return true;
      case 'workspace': case 'connections': case 'move-in': case 'audit': return role === 'owner' || role === 'admin';
      case 'people': return opensSettingsPage(role, 'directory');
      case 'teams': return opensSettingsPage(role, 'teams');
      case 'labels': return opensSettingsPage(role, 'labels');
      case 'developers': return opensSettingsPage(role, 'personal-integrations');
      case 'restore': return role === 'owner' && restorePending;
    }
  };
  return sections.filter(section => open(section.key)).map(section => section.key);
}

/** The section a pathname belongs to, for the current marker. Nested paths keep their section current. */
export function sectionOfPath(pathname: string): SectionKey | null {
  const path = pathname.replace(/\/$/, '');
  if (path === '/app/settings') return 'profile';
  return sections.find(section => path === section.path || path.startsWith(section.path + '/'))?.key ?? null;
}
