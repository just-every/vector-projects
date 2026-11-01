import { fetchJson, useApiResource } from '../../../../app/api-client';
import { useViewerTime } from '../../../../app/viewer-time';
import { administrationSchema } from '../../../administration/schema';
import { SelectField } from '../fields/select-field';
import { useSerialSaves } from '../fields/serial-saves';
import { SwitchField } from '../fields/switch-field';
import { TextField } from '../fields/text-field';
import { SectionGate } from '../shell/section-gate';
import { SectionPage, Skeleton } from '../shell/section-page';
import { useSettingsShell } from '../shell/settings-context';
import { settingsSchema } from '../../schema';
import { checkZone, timeOptions, timeZones } from './clock-options';
import './profile.css';

const creators = [{ value: 'admins', label: 'Owners and Admins only' }, { value: 'members', label: 'Members too' }] as const;
const put = (path: string, membersMayCreate: boolean) => fetchJson(path, administrationSchema, {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ membersMayCreate }),
});

function WorkspaceFields() {
  const shell = useSettingsShell();
  const clock = useViewerTime();
  const administration = useApiResource('/api/settings/administration', administrationSchema);
  const workspace = shell.data!.workspace;
  // `PATCH /api/settings` always needs the zone: a change to anything else sends the stored one.
  const serial = useSerialSaves(workspace);
  const patch = (change: { timezone?: string; reminderTime?: string; memberInvites?: boolean }) => serial(async base => {
    const updated = await fetchJson('/api/settings', settingsSchema, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timezone: base.timezone, ...change }),
    });
    shell.publish(updated);
    clock.publish({ ...updated.personalTime, workspaceTimezone: updated.workspace.timezone, reminderTime: updated.workspace.reminderTime });
    administration.reload();
    return updated.workspace;
  });
  const admin = administration.data;
  return <div className="profile-body">
    <TextField label="Time zone" value={workspace.timezone} suggestions={timeZones()} className="field-wide"
      hint="Calendar days and cycle boundaries follow this zone."
      save={async next => { checkZone(next.trim(), false); await patch({ timezone: next.trim() }); }} />
    <SelectField label="Daily reminder" value={workspace.reminderTime} options={timeOptions(workspace.reminderTime)}
      hint="Due reminders arrive at this time in each person’s zone." save={next => patch({ reminderTime: next })} />
    <SwitchField label="Members can invite other Members" value={workspace.memberInvites} save={next => patch({ memberInvites: next })} />
    {admin ? <>
      <SelectField label="Who may create teams" value={admin.workspace.memberTeamCreation ? 'members' : 'admins'} options={creators}
        save={next => put('/api/settings/teams/creation', next === 'members').then(result => administration.publishReceipt(() => result))} />
      <SelectField label="Who may create labels" value={admin.workspace.memberLabelCreation ? 'members' : 'admins'} options={creators}
        save={next => put('/api/settings/labels/creation', next === 'members').then(result => administration.publishReceipt(() => result))} />
    </> : <Skeleton />}
  </div>;
}

export function WorkspaceSection() {
  return <SectionGate section="workspace" title="Workspace">
    <SectionPage title="Workspace"><WorkspaceFields /></SectionPage>
  </SectionGate>;
}
