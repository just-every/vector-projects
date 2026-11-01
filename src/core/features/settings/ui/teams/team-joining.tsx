import { useState } from 'react';
import type { Administration } from '../../../administration/schema';
import { useAdministrationCall } from '../admin/administration';
import { ChoiceField } from '../fields/choice-field';
import { useSerialSaves } from '../fields/serial-saves';
import { SwitchField } from '../fields/switch-field';
import { teamAccess } from '../team-access';
import { memberName } from './team-names';

type Team = Administration['teams'][number];
type Joining = { mode: Team['membershipMode']; requests: boolean };
const modes = [{ value: 'open', label: 'Open' }, { value: 'invite_only', label: 'Invite only' }] as const;

/** Joining this team (Open / Invite only, Accept membership requests) and the requests waiting for an answer. */
export function TeamJoining({ data, team }: { data: Administration; team: Team }) {
  const call = useAdministrationCall();
  const access = teamAccess(data, team);
  const serial = useSerialSaves<Joining>({ mode: team.membershipMode, requests: team.requestsEnabled });
  if (!access.membership) return null;
  // Both choices travel in one PUT, so two quick changes go one after the other and neither overwrites the other.
  const store = (change: Partial<Joining>) => serial(async base => {
    const next = { ...base, ...change };
    const result = await call(`/api/settings/teams/${team.id}/membership`, 'PUT', { mode: next.mode, requestsEnabled: next.requests });
    const stored = result.teams.find(item => item.id === team.id)!;
    return { mode: stored.membershipMode, requests: stored.requestsEnabled };
  });
  const pending = team.joinRequests.filter(request => request.state === 'pending');
  const decide = (requester: string, decision: 'approved' | 'declined') =>
    call(`/api/settings/teams/${team.id}/requests/${requester}/decision`, 'POST', { decision });
  return <section className="team-block" aria-label={`Membership for ${team.name}`}>
    <h2 className="group-heading">Joining this team</h2>
    <ChoiceField label="Who can join" value={team.membershipMode} options={modes} save={next => store({ mode: next })} />
    <SwitchField label="Accept membership requests" value={team.requestsEnabled} save={next => store({ requests: next })} />
    {pending.map(request => <RequestRow key={request.requesterId} name={memberName(data, request.requesterId) === 'Former member' ? request.name : memberName(data, request.requesterId)}
      onApprove={() => decide(request.requesterId, 'approved')} onDecline={() => decide(request.requesterId, 'declined')} />)}
  </section>;
}

function RequestRow({ name, onApprove, onDecline }: { name: string; onApprove: () => Promise<unknown>; onDecline: () => Promise<unknown> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const run = (action: () => Promise<unknown>) => async () => {
    setPending(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'That could not be done.'); } finally { setPending(false); }
  };
  return <div className="request-row" role="group" aria-label={`Request from ${name}`}>
    <p>{name} requested membership.</p>
    <div className="confirm-actions">
      <button type="button" className="button-quiet" disabled={pending} onClick={run(onApprove)}>Approve {name}</button>
      <button type="button" className="button-text" disabled={pending} onClick={run(onDecline)}>Decline {name}</button>
    </div>
    {error && <p className="confirm-error" role="alert">{error}</p>}
  </div>;
}
