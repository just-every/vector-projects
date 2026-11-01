import { RemovePerson } from './remove-person';
import { PersonRole } from './person-role';
import { RolesFold } from './roles-fold';
import { isLastOwner, memberControls, roleLabels, type Person, type Settings } from './people-access';

/** One person, in the pane under "People › name": their role (stored as it changes), how roles work, and Remove. */
export function PersonRecord({ data, person }: { data: Settings; person: Person }) {
  const controls = memberControls(data);
  const roles = controls.roleChoices(person);
  const lastOwner = isLastOwner(data, person);
  const own = person.id === data.operatorId;
  return <div className="person-record">
    {roles.length
      ? <PersonRole person={person} roles={roles} teams={data.teams} lastOwner={lastOwner} />
      : <p className="record-line"><span>Role</span><strong>{roleLabels[person.role]}{person.id === data.workspace.setupOperatorId ? ' · Installation owner' : ''}</strong></p>}
    <RolesFold />
    {controls.removable(person) && <>
      <hr className="record-rule" />
      <RemovePerson person={person} own={own} lastOwner={lastOwner} ownerSetUp={data.workspace.setupOperatorId !== null} />
    </>}
  </div>;
}
