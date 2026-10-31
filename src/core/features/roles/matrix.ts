/** The CONTRACT.md role matrix rows that today's doors act under (ROLE-001).
 * Pure data shared by the server policy and the Settings screens. */
export const roles = ['owner', 'admin', 'member', 'guest', 'viewer'] as const
export type Role = typeof roles[number]
/** Roles an invitation or role change may name. */
export const assignableRoles = ['owner', 'admin', 'member', 'guest', 'viewer'] as const
export type AssignableRole = typeof assignableRoles[number]

/** yes/no, or the subject-dependent cells of the matrix:
 * - teams: the member's teams (a readable public team counts)
 * - invited-teams: only teams a Guest belongs to; any other team is invisible (404)
 * - team-owner: a team owner of the subject's team (ROLE-007)
 * - team-setting / planning-setting: team owners, or every team member while the
 *   team's ROLE-009 permission is All team members
 * - member-invites: only while the workspace lets Members invite Members
 * - own: the feature itself admits only the subject's owner
 * - lead: the subject project's lead
 * - approved-initiative: the feature admits only an initiative the member may edit, bound to a
 *   destination an Owner or Admin approved for that initiative (INIT-001) */
export type Cell = 'yes' | 'no' | 'teams' | 'invited-teams' | 'team-owner' | 'team-setting' | 'planning-setting' | 'member-invites' | 'member-team-creation' | 'own' | 'lead' | 'approved-initiative'
type Row = { action: string; cells: Record<Role, Cell> }
const row = (action: string, owner: Cell, admin: Cell, member: Cell, guest: Cell, viewer: Cell = 'no'): Row => ({ action, cells: { owner, admin, member, guest, viewer } })

export const matrix = {
  'work.read': row('Read visible work (OPS-001, ROLE-002, ROLE-003, ROLE-013)', 'yes', 'yes', 'yes', 'invited-teams', 'yes'),
  'viewers.manage': row('Invite or suspend Viewers; change between Member, Guest and Viewer (ROLE-013)', 'yes', 'yes', 'no', 'no'),
  'reports.read': row('Open Insights and shared dashboards (REPORT-001)', 'yes', 'yes', 'yes', 'no', 'yes'),
  'dashboards.write': row('Create, edit or share a dashboard (REPORT-003)', 'yes', 'yes', 'own', 'no'),
  'calendar.feeds': row('Create, rotate or revoke a calendar feed (CAL-001)', 'yes', 'yes', 'own', 'no', 'own'),
  'initiatives.write': row('Create and edit initiatives; add projects to them (INIT-001)', 'yes', 'yes', 'yes', 'no'),
  'releases.write': row('Create, edit or release a release (RELEASE-001)', 'yes', 'yes', 'teams', 'no'),
  'members.manage': row('Invite, or remove by suspension, Members and Guests (OPS-002, OPS-004, ROLE-011)', 'yes', 'yes', 'member-invites', 'no'),
  'leaders.manage': row('Invite, promote to, or remove by suspension Owners and Admins (OPS-002, ROLE-001, ROLE-011)', 'yes', 'no', 'no', 'no'),
  'workspace.leave': row('Leave the workspace oneself, which suspends (OPS-004, ROLE-011)', 'yes', 'yes', 'yes', 'yes', 'yes'),
  'workspace.settings': row('Change workspace settings: timezone, the invite, label-creation and deletion settings, notification defaults (OPS-003, OPS-002, ISSUE-014, ISSUE-010, NOTIFY-007)', 'yes', 'yes', 'no', 'no'),
  'teams.creation-setting': row('Set who may create teams (TEAM-008)', 'yes', 'yes', 'no', 'no'),
  'teams.create': row('Create a team (TEAM-008)', 'yes', 'yes', 'member-team-creation', 'no'),
  'teams.privacy': row('Make a team private or public (ROLE-002)', 'yes', 'yes', 'no', 'no'),
  'teams.members': row('Manage a team\'s members and team owners (ROLE-007, TEAM-007, ROLE-013)', 'yes', 'yes', 'team-owner', 'no'),
  'teams.permissions': row('Set a team\'s two permissions, *Who manages team settings* and *Who manages cycles and templates* (ROLE-009)', 'yes', 'yes', 'team-owner', 'no'),
  'teams.membership': row('Set open or invite-only membership; approve join requests; add Members to an invite-only or private team (TEAM-007)', 'yes', 'yes', 'team-owner', 'no'),
  'teams.request': row('Request membership of an invite-only or private team (TEAM-007)', 'yes', 'yes', 'yes', 'no'),
  'teams.join': row('Join an open public team or leave one\'s team (ROLE-007, TEAM-007)', 'yes', 'yes', 'yes', 'no'),
  'teams.settings': row('Change team settings: name and unused prefix, the sub-issue completion/reopening rule, triage, cycles and estimates on or off, estimate scale, default template, Git automation rules, auto-close and auto-archive (TEAM-001, ISSUE-019, TEAM-005, GITHUB-003, AUTO-003)', 'yes', 'yes', 'team-setting', 'no'),
  'teams.workflow': row('Add, rename, reorder or remove workflow statuses (TEAM-002, TEAM-004)', 'yes', 'yes', 'team-setting', 'no'),
  'teams.archive': row('Archive or unarchive a team, whatever its *Who manages team settings* permission (TEAM-003)', 'yes', 'yes', 'team-owner', 'no'),
  'documents.write': row("Write, edit and comment on documents under projects, issues, initiatives and teams they can see (PROJ-013)", 'yes', 'yes', 'yes', 'invited-teams'),
  'issues.write': row('Create, edit and comment on issues in the member\'s teams (ISSUE-001, ISSUE-008)', 'yes', 'yes', 'yes', 'invited-teams'),
  'reactions.write': row('Add or remove reactions on issue descriptions and comments (ISSUE-017)', 'yes', 'yes', 'yes', 'invited-teams'),
  'issues.copy': row('Copy an issue (ROLE-003/ROLE-008; ISSUE-023 action)', 'yes', 'yes', 'teams', 'invited-teams'),
  'email.reply': row('Reply by email to an intake sender (TRIAGE-005)', 'yes', 'yes', 'teams', 'no'),
  'comments.own': row('Edit own comment; resolve or reopen any thread (ISSUE-008)', 'yes', 'yes', 'yes', 'invited-teams'),
  'media.write': row('Paste, drop or upload images and video into a description, comment or document they can edit, and tick its checklists (ISSUE-024, ISSUE-025)', 'yes', 'yes', 'yes', 'invited-teams'),
  'comments.edit-others': row('Edit another member\'s comment, including ticking its checklists (ISSUE-008, ISSUE-025)', 'no', 'no', 'no', 'no'),
  'comments.delete-own': row('Delete own comment (ISSUE-008)', 'yes', 'yes', 'yes', 'yes'),
  'comments.delete-others': row('Delete another member\'s comment (ISSUE-008)', 'yes', 'yes', 'team-owner', 'no'),
  'issues.delete-permanent': row('Permanently delete an issue before retention ends (ISSUE-010)', 'yes', 'yes', 'no', 'no'),
  'labels.create': row('Create and apply labels (ISSUE-014)', 'yes', 'yes', 'yes', 'no'),
  'labels.manage': row('Rename, recolor, merge or delete a workspace label (ISSUE-014)', 'yes', 'yes', 'no', 'no'),
  'intake.create': row('Create an intake item by hand or submit a request form (INTAKE-001, TRIAGE-004)', 'yes', 'yes', 'yes', 'invited-teams'),
  'intake.decide': row('Accept, defer, end a deferral or decline an intake item (INTAKE-005, INTAKE-006, INTAKE-007)', 'yes', 'yes', 'teams', 'no'),
  'sources.manage': row('Register, rotate or revoke a signal source and its signing secret (INTAKE-011)', 'yes', 'yes', 'no', 'no'),
  'issue-templates.workspace': row('Manage workspace issue templates (ISSUE-016)', 'yes', 'yes', 'no', 'no'),
  'issue-templates.team': row('Manage team issue templates (ISSUE-016, ROLE-009)', 'yes', 'yes', 'planning-setting', 'no'),
  'cycles.manage': row('Create, edit, complete or delete a cycle (CYCLE-001)', 'yes', 'yes', 'planning-setting', 'no'),
  'cycles.schedule': row('Set a team\'s cycle schedule (ROLE-007/ROLE-009; CYCLE-007 action)', 'yes', 'yes', 'planning-setting', 'no'),
  'cycles.commit': row('Commit, move or uncommit an issue in a cycle (CYCLE-002)', 'yes', 'yes', 'teams', 'invited-teams'),
  'projects.write': row('Create a project and edit its fields, members and contributing teams (PROJ-001, PROJ-014)', 'yes', 'yes', 'yes', 'no'),
  'projects.status': row('Change a project\'s status; archive or unarchive it (PROJ-002, PROJ-009, PROJ-016)', 'yes', 'yes', 'yes', 'no'),
  'projects.delete': row('Delete a project after its confirmation, keeping its issues (PROJ-003, PROJ-017)', 'yes', 'yes', 'no', 'no'),
  'milestones.write': row('Create and edit milestones (PROJ-011)', 'yes', 'yes', 'yes', 'no'),
  'views.private': row('Save, update or delete a private view (VIEW-002)', 'yes', 'yes', 'yes', 'yes'),
  'views.share': row('Share a saved view with the workspace or a team (VIEW-002)', 'yes', 'yes', 'yes', 'no'),
  'views.open-shared': row('Open or duplicate a shared view (VIEW-002)', 'yes', 'yes', 'yes', 'invited-teams'),
  'views.edit-shared': row('Update or delete a shared view (VIEW-002)', 'own', 'own', 'own', 'no'),
  'integrations.manage': row('Connect, repair or remove integrations; manage OAuth apps, agents, their budgets and model providers (ROLE-001, INTEG-001, INTEG-002, API-004, AGENT-004, AGENT-009, SEC-002)', 'yes', 'yes', 'no', 'no'),
  'channels.bind-project': row('Bind a project to a Slack channel an Owner or Admin already bound or allowed, and post to it (SLACK-003)', 'yes', 'yes', 'yes', 'no'),
  'channels.bind-initiative': row('Bind an editable initiative to an eligible Owner- or Admin-approved destination and manage only that initiative’s selected events (INIT-001)', 'yes', 'yes', 'approved-initiative', 'no'),
  'channels.create': row('Have the Slack bot create a channel in the customer\'s Slack workspace for a new team or project (SLACK-003)', 'yes', 'yes', 'no', 'no'),
  'tokens.personal': row('Create personal API tokens (API-001)', 'yes', 'yes', 'yes', 'no'),
  'identity.personal': row('Authorize an OAuth app for oneself; link one\'s own Slack or Teams identity (API-004, SLACK-001, SLACK-004, TEAMS-001)', 'yes', 'yes', 'yes', 'no'),
  'audit.read': row('Browse and export the audit log (ROLE-005)', 'yes', 'yes', 'no', 'no'),
  'data.export': row('Export the portable archive (DATA-001)', 'yes', 'yes', 'no', 'no'),
  'data.restore': row('Restore an archive over HTTP and review the restored workspace (DATA-005)', 'yes', 'no', 'no', 'no'),
  'data.aliases': row('Manage active imported source prefixes (DATA-018)', 'yes', 'no', 'no', 'no'),
  'data.import': row('Preflight, apply, resume, repeat or roll back an import run or migration (DATA-002, DATA-003, DATA-006, DATA-008, DATA-009, DATA-010, DATA-012, DATA-013, DATA-014, DATA-015, DATA-016, DATA-017)', 'yes', 'yes', 'no', 'no'),
  'data.erase-imported': row('Erase an imported person (DATA-011)', 'yes', 'yes', 'no', 'no'),
} satisfies Record<string, Row>
export type RowId = keyof typeof matrix

/** The "Open Settings pages" row (ROLE-008): Owners and Admins open every page. */
export const settingsPages = ['account', 'directory', 'labels', 'teams', 'personal-integrations'] as const
export type SettingsPage = typeof settingsPages[number]
export const openSettingsPages: Record<Role, 'all' | readonly SettingsPage[]> = {
  owner: 'all', admin: 'all', member: settingsPages, guest: ['account'], viewer: ['account', 'directory', 'labels'],
}
export function opensSettingsPage(role: Role, page: SettingsPage) {
  const open = openSettingsPages[role]
  return open === 'all' || open.includes(page)
}
