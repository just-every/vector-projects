import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { fetchJson } from '../../../../app/api-client';
import { useViewerTime, viewerTimeSchema } from '../../../../app/viewer-time';
import { appearanceSchema, type ThemeChoice } from '../../appearance-schema';
import { ChoiceField } from '../fields/choice-field';
import { SelectField } from '../fields/select-field';
import { useSerialSaves } from '../fields/serial-saves';
import { TextField } from '../fields/text-field';
import { SectionPage } from '../shell/section-page';
import { WorkingDays } from './working-days';
import { checkZone, timeOptions, timeZones } from './clock-options';
import { currentTheme } from './theme';
import './profile.css';

const themes = [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] as const;

function Look() {
  const { operator } = useRouteContext({ from: '/app' });
  const [stored, setStored] = useState<ThemeChoice>(() => typeof document === 'undefined' ? operator.theme : currentTheme());
  const storedRef = useRef(stored);
  storedRef.current = stored;
  // Leaving without saving a refused pick puts the saved look back.
  useEffect(() => () => { document.documentElement.dataset.theme = storedRef.current; }, []);
  return <ChoiceField label="Look" value={stored} options={themes} save={async next => {
    // The page follows the pick at once; a refused save keeps the pick and offers Retry.
    document.documentElement.dataset.theme = next;
    await fetchJson('/api/settings/appearance', appearanceSchema, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: next }),
    });
    setStored(next);
  }} />;
}

type Hours = { timezone: string | null; workingHoursStart: string; workingHoursEnd: string; workingDays: number[] };
function usePersonalTime() {
  const clock = useViewerTime();
  const serial = useSerialSaves<Hours>(clock);
  const save = (change: Partial<Hours>) => serial(async base => {
    const next: Hours = { timezone: base.timezone ?? null, workingHoursStart: base.workingHoursStart, workingHoursEnd: base.workingHoursEnd, workingDays: base.workingDays, ...change };
    const updated = await fetchJson('/api/settings/personal-time', viewerTimeSchema, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next),
    });
    clock.publish(updated);
    return updated;
  });
  return { clock, save };
}

export function ProfileSection() {
  const { clock, save } = usePersonalTime();
  return <SectionPage title="Profile">
    <div className="profile-body">
      <Look />
      <section className="profile-hours" aria-labelledby="profile-hours-title">
        <h2 id="profile-hours-title">Your hours</h2>
        <TextField label="Time zone" value={clock.timezone ?? ''} placeholder={`Same as workspace (${clock.workspaceTimezone})`}
          suggestions={timeZones()} className="field-wide"
          save={async next => { checkZone(next.trim(), true); await save({ timezone: next.trim() || null }); }} />
        <div className="field-pair">
          <SelectField label="Day starts" value={clock.workingHoursStart} options={timeOptions(clock.workingHoursStart)}
            save={next => save({ workingHoursStart: next })} />
          <SelectField label="Day ends" value={clock.workingHoursEnd} options={timeOptions(clock.workingHoursEnd)}
            save={next => save({ workingHoursEnd: next })} />
        </div>
        <WorkingDays value={clock.workingDays} save={next => save({ workingDays: next })} />
      </section>
    </div>
  </SectionPage>;
}
