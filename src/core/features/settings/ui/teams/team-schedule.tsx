import type { Administration } from '../../../administration/schema';
import { useAdministrationCall } from '../admin/administration';
import { SelectField, type Option } from '../fields/select-field';
import { useSerialSaves } from '../fields/serial-saves';

type Team = Administration['teams'][number];
type Schedule = { weeks: number; startWeekday: number; cooldownWeeks: number; upcomingCount: number };
const defaults: Schedule = { weeks: 2, startWeekday: 1, cooldownWeeks: 0, upcomingCount: 3 };
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const count = (from: number, to: number, unit: string, many = unit + 's'): Option<string>[] =>
  Array.from({ length: to - from + 1 }, (_, index) => ({ value: String(from + index), label: `${from + index} ${from + index === 1 ? unit : many}` }));
const lengths = count(1, 8, 'week');
const cooldowns = count(0, 8, 'week');
const upcoming = count(1, 24, 'cycle');
const days: Option<string>[] = weekdays.map((day, index) => ({ value: String(index), label: day }));

const current = (data: Administration, team: Team): Schedule => {
  const stored = data.cycleSchedules.find(item => item.teamId === team.id);
  return stored ? { weeks: stored.weeks, startWeekday: stored.startWeekday, cooldownWeeks: stored.cooldownWeeks, upcomingCount: stored.upcomingCount } : defaults;
};

/** The automatic cycle schedule: four choices that travel as one record, each stored as it changes. Read-only it is plain text. */
export function TeamSchedule({ data, team, editable }: { data: Administration; team: Team; editable: boolean }) {
  const call = useAdministrationCall();
  const schedule = current(data, team);
  const serial = useSerialSaves<Schedule>(schedule);
  const store = (change: Partial<Schedule>) => serial(async base => {
    const result = await call(`/api/settings/teams/${team.id}/cycle-schedule`, 'PUT', { ...base, ...change });
    return current(result, team);
  });
  return <section className="team-block" aria-label="Automatic cycle schedule">
    <h2 className="group-heading">Automatic cycle schedule</h2>
    <p className="field-hint">Cycles start at midnight in {data.workspace.timezone}.</p>
    {editable
      ? <div className="schedule-grid">
        <SelectField label="Cycle length" value={String(schedule.weeks)} options={lengths} save={next => store({ weeks: Number(next) })} />
        <SelectField label="Starts on" value={String(schedule.startWeekday)} options={days} save={next => store({ startWeekday: Number(next) })} />
        <SelectField label="Cooldown" value={String(schedule.cooldownWeeks)} options={cooldowns} save={next => store({ cooldownWeeks: Number(next) })} />
        <SelectField label="Keep upcoming" value={String(schedule.upcomingCount)} options={upcoming} save={next => store({ upcomingCount: Number(next) })} />
      </div>
      : <dl className="plain-values">
        <div><dt>Cycle length</dt><dd>{lengths.find(item => item.value === String(schedule.weeks))?.label}</dd></div>
        <div><dt>Starts on</dt><dd>{weekdays[schedule.startWeekday]}</dd></div>
        <div><dt>Cooldown</dt><dd>{cooldowns.find(item => item.value === String(schedule.cooldownWeeks))?.label}</dd></div>
        <div><dt>Keep upcoming</dt><dd>{upcoming.find(item => item.value === String(schedule.upcomingCount))?.label}</dd></div>
      </dl>}
  </section>;
}
