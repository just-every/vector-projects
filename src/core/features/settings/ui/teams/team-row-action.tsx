import { useState } from 'react';
import type { Administration } from '../../../administration/schema';
import { useAdministrationCall } from '../admin/administration';
import { teamAccess } from '../team-access';

type Team = Administration['teams'][number];

/** What the viewer may do from the list: Leave, Join or Request to join. Shown on hover and focus of the row. */
export function useRowAction(data: Administration, team: Team) {
  const call = useAdministrationCall();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const access = teamAccess(data, team);
  const asked = team.joinRequests.some(request => request.requesterId === data.viewer.id && request.state === 'pending');
  const run = (verb: 'leave' | 'join' | 'requests') => async () => {
    setPending(true); setError('');
    try { await call(`/api/teams/${team.id}/${verb}`, 'POST', {}); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'That could not be done.'); }
    finally { setPending(false); }
  };
  let action: { label: string; run: () => void } | null = null;
  let note = '';
  if (access.join && access.standing) action = { label: `Leave ${team.name}`, run: run('leave') };
  else if (access.join && !team.archivedAt && team.membershipMode === 'open' && !team.isPrivate) action = { label: `Join ${team.name}`, run: run('join') };
  else if (access.join && !team.archivedAt) {
    if (team.requestsEnabled && access.request) { if (asked) note = 'Request pending'; else action = { label: `Request to join ${team.name}`, run: run('requests') }; }
    else note = 'Invitation required';
  }
  return { action, note, error, pending };
}
