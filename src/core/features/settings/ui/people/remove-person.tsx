import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { fetchJson } from '../../../../app/api-client';
import { ConfirmLine } from '../fields/confirm-line';
import { useSettingsShell } from '../shell/settings-context';
import type { Person } from './people-access';

const removed = z.object({ removed: z.boolean(), signedOut: z.boolean() });

/** Remove (or, for yourself, leave), asked once under the control with its consequence. */
export function RemovePerson({ person, own, lastOwner, ownerSetUp }: { person: Person; own: boolean; lastOwner: boolean; ownerSetUp: boolean }) {
  const shell = useSettingsShell();
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const label = own ? 'Leave workspace' : `Remove ${person.name}`;
  if (lastOwner) return <p className="field-hint">The last Owner cannot be removed.</p>;
  if (!ownerSetUp) return <p className="field-hint">Removing people needs the installation owner. Ask whoever set up Vector to finish owner setup first.</p>;
  async function remove() {
    const result = await fetchJson(`/api/settings/operators/${person.id}`, removed, { method: 'DELETE' });
    if (result.signedOut) { window.location.assign('/signin'); return; }
    shell.reload();
    await navigate({ to: '/app/settings/people', replace: true });
  }
  return <div className="person-remove">
    {!asking && <button type="button" className="link-button danger" onClick={() => setAsking(true)}>{label}</button>}
    {asking && <ConfirmLine question={own ? 'Leave this workspace?' : 'Remove this member?'} confirm="Confirm removal" danger
      detail={`${own ? 'Your sessions will end.' : 'Their sessions will end.'} Open issues will be unassigned, and projects and shared views will transfer. Retained history will show an anonymous member.`}
      onConfirm={remove} onCancel={() => setAsking(false)} />}
  </div>;
}
