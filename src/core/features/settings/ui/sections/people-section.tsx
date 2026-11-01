import { SectionGate } from '../shell/section-gate';
import { NotFoundLine, SectionPage } from '../shell/section-page';
import { useSettingsShell } from '../shell/settings-context';
import { MembersPanel } from '../members-panel';

/** People. A record path shows the directory under the person's breadcrumb until the record page replaces it. */
export function PeopleSection({ operatorId }: { operatorId?: string }) {
  return <SectionGate section="people" title="People"><People operatorId={operatorId} /></SectionGate>;
}

function People({ operatorId }: { operatorId?: string }) {
  const shell = useSettingsShell();
  const data = shell.data!;
  const person = operatorId ? data.operators.find(operator => operator.id === operatorId) : undefined;
  const parent = { label: 'People', to: '/app/settings/people' } as const;
  if (operatorId && !person) return <SectionPage title="People"><NotFoundLine what="That person" back={parent} /></SectionPage>;
  return <SectionPage title="People" legacy parent={person ? parent : undefined} record={person?.name}>
    <MembersPanel data={data} denied={false} onChanged={shell.reload} />
  </SectionPage>;
}
