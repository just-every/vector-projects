/** Settings forms register their submitted HTTP door, including its dynamic row
 * resolver. Source coverage enumerates the actual reachable JSX independently.
 * Keys are source modules and their enclosing component; values follow form order.
 * Controls that save as they change (Profile, Workspace, a person's role, a team's details, workflow, people, planning and Git rules, a label's name, colour and projects switch) are not forms: they call their PATCH/PUT door directly. */
export const settingsFormDoors: Record<string, readonly string[]> = {
  'triage-responsibility/panel.tsx#TeamTriageRotation': ['PUT /settings/teams/:id/triage-rotation'],
  'integrations/ui/channel-settings.tsx#ChannelSettings': [
    'POST /settings/integrations/slack', 'POST /settings/integrations/slack/signing-secret',
    'POST /settings/integrations/channels/allowed', 'POST /settings/integrations/channels',
    'POST /settings/integrations/channels/initiative-approvals',
  ],
  'integrations/ui/slack-app-settings.tsx#SlackAppSettings': ['POST /settings/integrations/slack/app/create', 'POST /settings/integrations/slack/app'],
  'integrations/ui/slack-member-mappings.tsx#SlackMemberMappings': ['POST /settings/integrations/slack/app/members'],
  'integrations/ui/token-settings.tsx#TokenSettings': ['POST /settings/integrations/tokens'],
  'oauth-apps/ui/settings-panel.tsx#OAuthAppsPanel': ['POST /settings/oauth-apps'],
  'integrations/ui/source-settings.tsx#SourceSettings': ['POST /settings/integrations/sources'],
  'integrations/ui/error-settings.tsx#ErrorSettings': ['POST /settings/integrations/errors'],
  'integrations/ui/webhook-settings.tsx#WebhookSettings': ['POST /settings/integrations/destinations'],
  'integrations/ui/delivery-setup.tsx#DeliverySetup': ['POST /settings/integrations/delivery'],
  'integrations/ui/github-settings.tsx#GithubSettings': ['POST /settings/integrations/github'],
  'email-intake/ui/team-email-intake.tsx#ActiveTeamEmailIntake': ['PUT /settings/teams/:teamId/email-intake'],
  'email-intake/ui/event-key.tsx#EventWebhookKey': ['PUT /settings/teams/:teamId/email-intake/event-key'],
  'cycles/ui/cycles-panel.tsx#CyclesPanel': ['POST /settings/cycles'],
  'settings/ui/people/invite-form.tsx#InviteForm': ['POST /settings/operators/invite'],
  'settings/ui/teams/new-team-form.tsx#NewTeamForm': ['POST /settings/teams'],
  'settings/ui/teams/add-status.tsx#AddStatus': ['POST /settings/teams/:id/statuses'],
  'settings/ui/labels/new-label-form.tsx#NewLabelForm': ['POST /settings/labels'],
  'data/ui/data-panel.tsx#DataPanel': ['POST /data/import/preview'],
}

/** Private server functions with writes must name their HTTP authority door.
 * Current server functions only read, independently checked from source. */
export const serverFunctionDoors: Record<string, string> = {}

/** Seed-owned write commands carry the caller's native session to these doors.
 * Base resource setup, reset and local restore have no workspace actor. */
export const commandDoors: Record<string, Record<string, readonly string[]>> = {
  'scripts/data/import-issues.mjs': {
    preview: ['POST /data/import/preview'],
    apply: ['POST /data/import/preview', 'POST /data/import/apply'],
    status: ['GET /data/import/runs/:id'],
    resume: ['POST /data/import/runs/:id/resume'],
    rollback: ['GET /data/import/runs/:id/rollback', 'POST /data/import/runs/:id/rollback'],
    report: ['GET /data/import/runs/:id/report', 'GET /data/import/runs/:id/report.csv'],
  },
}
