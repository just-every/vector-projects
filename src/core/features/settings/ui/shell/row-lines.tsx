import { useApiResource } from '../../../../app/api-client';
import { useViewerTime } from '../../../../app/viewer-time';
import { administrationSchema } from '../../../administration/schema';
import { channelPreferencesSchema, channelLabels } from '../../../notifications/ui/channel-data';
import { configSchema, personalTokensSchema } from '../../../integrations/ui/client';
import { teamAccess } from '../team-access';
import { themeLabel, currentTheme } from '../sections/theme';
import type { SectionKey } from './sections';
import { useSettingsShell } from './settings-context';

const names = (items: string[]) => items.length > 3 ? `${items.slice(0, 3).join(', ')} +${items.length - 3}` : items.join(', ');
const plural = (count: number, one: string, many = one + 's') => `${count} ${count === 1 ? one : many}`;
const Line = ({ text }: { text: string | null | undefined }) => text ? <span className="settings-nav-line">{text}</span> : null;

/**
 * The phone index's live line for one row. Only rows the role may open render, so a role never triggers a read it is
 * refused, and each line names only what that row's own reads returned.
 */
export function RowLine({ section }: { section: SectionKey }) {
  switch (section) {
    case 'profile': return <ProfileLine />;
    case 'notifications': return <NotificationsLine />;
    case 'workspace': return <WorkspaceLine />;
    case 'people': return <PeopleLine />;
    case 'teams': return <AdministrationLine of="teams" />;
    case 'labels': return <AdministrationLine of="labels" />;
    case 'connections': return <ConnectionsLine />;
    case 'developers': return <DeveloperLine />;
    case 'move-in': return <Line text="Linear, Jira or CSV" />;
    default: return null;
  }
}

function ProfileLine() {
  const clock = useViewerTime();
  return <Line text={`${themeLabel(currentTheme())} · ${clock.workingHoursStart}-${clock.workingHoursEnd} · ${clock.effectiveTimezone}`} />;
}
function NotificationsLine() {
  const channels = useApiResource('/api/settings/notifications/channels', channelPreferencesSchema);
  const on = channels.data?.channels.filter(channel => channel.emailMode !== 'off').map(channel => channelLabels[channel.kind].toLowerCase());
  if (!on) return null;
  return <Line text={on.length ? `Email for ${on.length > 2 ? `${on.length} events` : on.join(' and ')}` : 'Email is off'} />;
}
function WorkspaceLine() {
  const { data } = useSettingsShell();
  return <Line text={data && `${data.workspace.timezone} · reminders at ${data.workspace.reminderTime}`} />;
}
function PeopleLine() {
  const { data } = useSettingsShell();
  return <Line text={data && names(data.operators.map(operator => operator.name))} />;
}
function AdministrationLine({ of }: { of: 'teams' | 'labels' }) {
  const { data } = useApiResource('/api/settings/administration', administrationSchema);
  if (!data) return null;
  const listed = of === 'teams'
    ? data.teams.filter(team => !team.archivedAt && teamAccess(data, team).opens).map(team => team.name)
    : data.labels.map(label => label.name);
  return <Line text={listed.length ? names(listed) : of === 'teams' ? 'No teams yet' : 'No labels yet'} />;
}
function DeveloperLine() {
  const { data } = useApiResource('/api/settings/integrations/tokens', personalTokensSchema);
  if (!data) return null;
  const active = data.tokens.filter(token => !token.revokedAt).length;
  return <Line text={active ? plural(active, 'API token') : 'No API tokens'} />;
}
/** Connections' overall state needs the Slack app, channel and error reads, which the index does not make. */
function ConnectionsLine() {
  const { data } = useApiResource('/api/settings/integrations', configSchema);
  if (!data) return null;
  const parts = [
    data.github.length ? plural(data.github.length, 'repository', 'repositories') : '',
    data.destinations.length ? plural(data.destinations.length, 'webhook') : '',
    data.sources.length ? plural(data.sources.length, 'source') : '',
  ].filter(Boolean);
  return <Line text={parts.length ? parts.join(' · ') : 'No repositories, webhooks or sources yet'} />;
}
