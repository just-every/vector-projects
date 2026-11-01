import { useState } from 'react';
import type { Administration } from '../../../administration/schema';
import { useAdministrationCall } from '../admin/administration';
import { ConfirmLine } from '../fields/confirm-line';

type Team = Administration['teams'][number];

/** Archive asks once under its control; Unarchive is one enabled action. */
export function TeamArchive({ team }: { team: Team }) {
  const call = useAdministrationCall();
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const archive = (archived: boolean) => call(`/api/settings/teams/${team.id}`, 'PATCH', { archived });
  if (team.archivedAt) return <div className="team-archive">
    <button type="button" className="button-quiet" disabled={pending} onClick={async () => {
      setPending(true); setError('');
      try { await archive(false); } catch (cause) { setError(cause instanceof Error ? cause.message : 'The team could not be unarchived.'); } finally { setPending(false); }
    }}>Unarchive team</button>
    {error && <p className="confirm-error" role="alert">{error}</p>}
  </div>;
  return <div className="team-archive">
    {!asking && <button type="button" className="link-button danger" onClick={() => setAsking(true)}>Archive {team.name}</button>}
    {asking && <ConfirmLine question={`Archive ${team.name}?`} detail="You can unarchive it later." confirm="Archive team" onConfirm={() => archive(true)} onCancel={() => setAsking(false)} />}
  </div>;
}
