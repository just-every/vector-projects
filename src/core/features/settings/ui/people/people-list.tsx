import { Link } from '@tanstack/react-router';
import { rememberListScroll } from '../shell/list-scroll';
import { roleLabels, type Settings } from './people-access';

/** Name, then email · role; the signed-in person marked. Each row opens that person's record. */
export function PeopleList({ data }: { data: Settings }) {
  return <ul className="settings-rows" aria-label="People">
    {data.operators.map(person => <li key={person.id}>
      <Link className="settings-row" to="/app/settings/people/$operatorId" params={{ operatorId: person.id }} onClick={() => rememberListScroll('people')}>
        <span className="row-main">
          <span className="row-name">{person.name}{person.id === data.operatorId ? ' (you)' : ''}</span>
          <span className="row-meta">{person.email} · {roleLabels[person.role]}{person.id === data.workspace.setupOperatorId ? ' · Installation owner' : ''}</span>
        </span>
        <span className="row-chevron" aria-hidden="true">›</span>
      </Link>
    </li>)}
  </ul>;
}
