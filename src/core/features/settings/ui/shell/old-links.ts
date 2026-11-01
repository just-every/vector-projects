/**
 * Where every old Settings link lands. The browser maps a fragment (it never reaches the server); the server keeps the
 * old `/app/settings/<name>` redirects. Both end on the canonical path with the history entry replaced.
 */
export const oldLinks: Record<string, string> = {
  appearance: '/app/settings/profile',
  'personal-time': '/app/settings/profile',
  'workspace-time': '/app/settings/workspace',
  members: '/app/settings/people',
  operators: '/app/settings/people',
  teams: '/app/settings/teams',
  labels: '/app/settings/labels',
  housekeeping: '/app/settings/housekeeping',
  integrations: '/app/settings/connections',
  'oauth-apps': '/app/settings/developers/apps',
  notifications: '/app/settings/notifications',
  data: '/app/settings/move-in',
  'after-restore': '/app/settings/restore',
  projects: '/app/projects',
  cycles: '/app/cycles',
};

/** Old `/app/settings/<name>` paths that no concrete route owns any more. */
export const oldNames = ['appearance', 'personal-time', 'workspace-time', 'members', 'projects', 'cycles', 'data', 'after-restore', 'integrations', 'oauth-apps'] as const;

export const hashTarget = (hash: string) => oldLinks[hash.replace(/^#/, '')] ?? '/app/settings';
