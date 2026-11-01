import { useEffect, useId, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { ApiError, fetchJson } from '../../../../app/api-client';
import type { AssignableRole } from '../../../roles/matrix';
import { ConfirmLine } from '../fields/confirm-line';
import { readInviteDraft, saveInviteDraft } from './invite-draft';
import { roleLabels } from './people-access';
import { TeamPicker } from './team-picker';

type Ask = null | 'confirm' | 'needed' | 'sending' | 'email';
const accepted = z.object({ status: z.literal('accepted'), delivery: z.enum(['local', 'email']) });
const post = (path: string, body: unknown) => fetchJson(path, accepted, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/**
 * Invite, in place at the head of People, only when asked. The one ask sits under Send invitation: the server's
 * step-up (a one-use link to your own email) when it wants one, otherwise one confirm line.
 */
export function InviteForm({ roles, teams, onClose, onSent }: {
  roles: AssignableRole[]; teams: { id: string; name: string }[]; onClose: () => void; onSent: (role: AssignableRole) => void;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>(roles[0] ?? 'member');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [ask, setAsk] = useState<Ask>(null);
  const [returned, setReturned] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  // Coming back from the confirmation link: the typed values are still here, and the ask has been answered.
  useEffect(() => {
    const draft = readInviteDraft();
    if (!draft) return;
    setName(draft.displayName); setEmail(draft.email); setTeamIds(draft.teamIds);
    if (roles.includes(draft.role)) setRole(draft.role);
    setReturned(true);
    setMessage('Once you have confirmed it’s you, send the invitation again.');
  }, [roles]);

  const needsTeam = role === 'guest' && teamIds.length === 0;
  async function send() {
    setFailed(false); setMessage('');
    try {
      await post('/api/settings/operators/invite', { email, displayName: name, role, ...(role === 'guest' || role === 'viewer' ? { teamIds } : {}) });
      saveInviteDraft(null);
      onSent(role);
      onClose();
    } catch (error) {
      setAsk(null);
      if (error instanceof ApiError && (error.body as { error?: unknown } | null)?.error === 'step_up_required') {
        saveInviteDraft({ email, displayName: name, role, teamIds });
        setReturned(false); setAsk('needed');
      } else { setFailed(true); setMessage(error instanceof Error ? error.message : 'The invitation could not be sent.'); }
    }
  }
  async function confirmIdentity() {
    setAsk('sending'); setMessage(''); setFailed(false);
    try { await post('/api/settings/operators/confirm-identity', {}); setAsk('email'); }
    catch (error) { setAsk('needed'); setFailed(true); setMessage(error instanceof Error ? error.message : 'The confirmation link could not be sent.'); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (returned) void send();
    else setAsk('confirm');
  }
  return <form className="invite-form" aria-label="Invite someone" onSubmit={submit}>
    <h2>Invite someone</h2>
    <div className="invite-pair">
      <div className="field"><div className="field-head"><label htmlFor={`${id}-name`}>Name</label></div>
        <input id={`${id}-name`} type="text" required maxLength={120} value={name} autoComplete="off" onChange={event => { setName(event.target.value); setAsk(null); }} /></div>
      <div className="field"><div className="field-head"><label htmlFor={`${id}-email`}>Email</label></div>
        <input id={`${id}-email`} type="email" required maxLength={254} value={email} autoComplete="off" onChange={event => { setEmail(event.target.value); setAsk(null); }} /></div>
    </div>
    <div className="field"><div className="field-head"><label htmlFor={`${id}-role`}>Role</label></div>
      <select id={`${id}-role`} value={role} onChange={event => { setRole(event.target.value as AssignableRole); setAsk(null); }}>
        {roles.map(choice => <option key={choice} value={choice}>{roleLabels[choice]}</option>)}
      </select></div>
    {(role === 'guest' || role === 'viewer') && <TeamPicker role={role} teams={teams} selected={teamIds} onChange={ids => { setTeamIds(ids); setAsk(null); }} />}
    <div className="confirm-actions">
      <button type="submit" className="button-ink" disabled={needsTeam || ask === 'sending'}>Send invitation</button>
      <button type="button" className="button-text" onClick={() => { saveInviteDraft(null); onClose(); }}>Cancel</button>
    </div>
    {message && <p className={failed ? 'confirm-error' : 'field-hint'} role={failed ? 'alert' : 'status'}>{message}</p>}
    {ask === 'confirm' && <ConfirmLine question={`Invite ${name} as ${role === 'admin' ? 'an' : 'a'} ${roleLabels[role]}?`}
      detail={`They get access to this workspace as soon as they accept, at ${email}.`} confirm="Confirm and send" onConfirm={send} onCancel={() => setAsk(null)} />}
    {(ask === 'needed' || ask === 'sending') && <div className="confirm-line" role="group" aria-label="Confirm it’s you">
      <p className="confirm-detail" role="status">Inviting someone gives them access to this workspace, so confirm it’s you first. Vector sends a one-use confirmation link to your own email address.</p>
      <div className="confirm-actions"><button type="button" className="button-quiet" disabled={ask === 'sending'} onClick={() => void confirmIdentity()}>Send confirmation link</button></div>
    </div>}
    {ask === 'email' && <div className="confirm-line" role="group" aria-label="Confirm it’s you">
      <p className="confirm-detail" role="status">Check your email for the confirmation link, open it in this browser and press Confirm. You come back here to send the invitation. The link works once, for 15 minutes.</p>
    </div>}
  </form>;
}
