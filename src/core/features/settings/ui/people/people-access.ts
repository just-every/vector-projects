import type { z } from 'zod';
import { matrix, type AssignableRole, type Role } from '../../../roles/matrix';
import type { settingsSchema } from '../../schema';

export type Settings = z.infer<typeof settingsSchema>;
export type Person = Settings['operators'][number];
export const roleLabels: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', guest: 'Guest', viewer: 'Viewer' };

/**
 * What the viewer's role allows here (ROLE-001, OPS-002). The server decides every request;
 * these controls only show the choices it will accept.
 */
export function memberControls(data: Settings) {
  const viewer = data.role;
  const leads = matrix['leaders.manage'].cells[viewer] === 'yes';
  const manages = matrix['members.manage'].cells[viewer] === 'yes';
  const memberInvites = matrix['members.manage'].cells[viewer] === 'member-invites' && data.workspace.memberInvites;
  return {
    inviteRoles: (leads ? ['member', 'guest', 'viewer', 'admin', 'owner'] : manages ? ['member', 'guest', 'viewer'] : memberInvites ? ['member'] : []) as AssignableRole[],
    /** The roles this viewer may give the person; empty when the role is not theirs to change. */
    roleChoices: (person: Person) => (leads ? ['owner', 'admin', 'member', 'guest', 'viewer']
      : manages && ['member', 'guest', 'viewer'].includes(person.role) ? ['member', 'guest', 'viewer'] : []) as AssignableRole[],
    removable: (person: Person) => person.id === data.operatorId
      || (leads && person.id !== data.workspace.setupOperatorId)
      || (manages && ['member', 'guest', 'viewer'].includes(person.role)),
  };
}

/** The last Owner stays (ROLE-001); the server refuses to demote or remove them. */
export const isLastOwner = (data: Settings, person: Person) =>
  person.role === 'owner' && data.operators.filter(other => other.role === 'owner').length === 1;
