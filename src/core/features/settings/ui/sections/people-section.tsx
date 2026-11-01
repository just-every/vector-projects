import { useEffect, useState } from 'react';
import type { AssignableRole } from '../../../roles/matrix';
import { InviteForm } from '../people/invite-form';
import { readInviteDraft } from '../people/invite-draft';
import { memberControls, roleLabels } from '../people/people-access';
import { PeopleList } from '../people/people-list';
import { PersonRecord } from '../people/person-record';
import { SectionGate } from '../shell/section-gate';
import { useRestoreListScroll } from '../shell/list-scroll';
import { NotFoundLine, SectionPage } from '../shell/section-page';
import { useSettingsShell } from '../shell/settings-context';
import '../people/people.css';

/** People: the directory, with Invite in place; a record path opens that person under "People › name". */
export function PeopleSection({ operatorId }: { operatorId?: string }) {
  return <SectionGate section="people" title="People"><People operatorId={operatorId} /></SectionGate>;
}

function People({ operatorId }: { operatorId?: string }) {
  const shell = useSettingsShell();
  const data = shell.data!;
  const parent = { label: 'People', to: '/app/settings/people' } as const;
  const person = operatorId ? data.operators.find(operator => operator.id === operatorId) : undefined;
  if (operatorId && !person) return <SectionPage title="People"><NotFoundLine what="That person" back={parent} /></SectionPage>;
  if (person) return <SectionPage title={person.name} parent={parent} record={person.name} sub={person.email}><PersonRecord data={data} person={person} /></SectionPage>;
  return <Directory />;
}

function Directory() {
  const shell = useSettingsShell();
  const data = shell.data!;
  const roles = memberControls(data).inviteRoles;
  const [inviting, setInviting] = useState(false);
  const [sent, setSent] = useState<AssignableRole | null>(null);
  useRestoreListScroll('people');
  // Coming back from the confirmation link continues the invitation that was being written.
  useEffect(() => { if (roles.length && readInviteDraft()) setInviting(true); }, [roles.length]);
  const opener = roles.length && !inviting
    ? <button type="button" className="button-quiet" onClick={() => { setSent(null); setInviting(true); }}>Invite</button> : undefined;
  return <SectionPage title="People" action={opener}>
    {sent && <p className="people-notice" role="status">Invitation submitted for delivery. The new {roleLabels[sent]} appears here after accepting it.</p>}
    {inviting && <InviteForm roles={roles} teams={data.teams} onClose={() => setInviting(false)} onSent={setSent} />}
    <PeopleList data={data} />
  </SectionPage>;
}
