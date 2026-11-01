import { useId, useState } from 'react';
import { fetchJson } from '../../../../app/api-client';
import type { AssignableRole } from '../../../roles/matrix';
import { settingsSchema } from '../../schema';
import { FailureLine, SavedMark } from '../fields/field-feedback';
import { useAutosave } from '../fields/use-autosave';
import { useSettingsShell } from '../shell/settings-context';
import { roleLabels, type Person } from './people-access';
import { TeamPicker } from './team-picker';

type RoleValue = { role: AssignableRole; teams: string[] };
const sameValue = (a: RoleValue, b: RoleValue) => a.role === b.role && a.teams.length === b.teams.length && a.teams.every(team => b.teams.includes(team));

/**
 * A person's role, stored as it changes. A Guest needs at least one team, so a Guest pick with none waits for a tick
 * (a plain line, nothing sent); the Viewer's private teams store as they are ticked.
 */
export function PersonRole({ person, roles, teams, lastOwner }: {
  person: Person; roles: AssignableRole[]; teams: { id: string; name: string }[]; lastOwner: boolean;
}) {
  const id = useId();
  const shell = useSettingsShell();
  const field = useAutosave<RoleValue>({
    value: { role: person.role as AssignableRole, teams: person.teamIds }, same: sameValue, label: `Role for ${person.name}`,
    save: async next => {
      const updated = await fetchJson(`/api/settings/operators/${person.id}/role`, settingsSchema, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: next.role, ...(next.role === 'guest' || next.role === 'viewer' ? { teamIds: next.teams } : {}) }),
      });
      shell.publish(updated);
    },
  });
  const [waiting, setWaiting] = useState<RoleValue | null>(null);
  const shown = waiting ?? field.shown;
  function choose(next: RoleValue) {
    // Not a failure to retry: the line under the select says why the last Owner stays.
    if (lastOwner && next.role !== 'owner') return;
    if (next.role === 'guest' && next.teams.length === 0) { setWaiting(next); return; }
    setWaiting(null);
    void field.commit(next);
  }
  return <div className="person-role">
    <div className="field">
      <div className="field-head"><label htmlFor={id}>Role</label><SavedMark state={field.state} /></div>
      <select id={id} value={shown.role} onChange={event => choose({ role: event.target.value as AssignableRole, teams: shown.teams })}>
        {roles.map(choice => <option key={choice} value={choice}>{roleLabels[choice]}</option>)}
      </select>
      {lastOwner && <p className="field-hint">The last Owner cannot be demoted or removed. Make another member an Owner first.</p>}
      <FailureLine failed={field.failed} reason={field.reason} onRetry={field.retry} />
    </div>
    {(shown.role === 'guest' || shown.role === 'viewer') && <>
      <TeamPicker role={shown.role} teams={teams} selected={shown.teams} onChange={ids => choose({ role: shown.role, teams: ids })} />
      {waiting && <p className="field-hint" role="status">Choose at least one team.</p>}
    </>}
  </div>;
}
