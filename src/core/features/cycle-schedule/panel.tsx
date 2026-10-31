import type { FormEvent } from "react";
import type { Administration } from "../administration/schema";
import { useAdministrationAction } from "../settings/ui/administration-action";
import { AdministrationFeedback } from "../settings/ui/administration-feedback";
const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export function CycleSchedulePanel({
  data,
  onChanged,
}: {
  data: Administration;
  onChanged: () => void;
}) {
  const action = useAdministrationAction(onChanged);
  async function save(event: FormEvent<HTMLFormElement>, teamId: string) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    await action.run(`/api/settings/teams/${teamId}/cycle-schedule`, "PUT", {
      weeks: Number(fields.get("weeks")),
      startWeekday: Number(fields.get("weekday")),
      cooldownWeeks: Number(fields.get("cooldown")),
      upcomingCount: Number(fields.get("upcoming")),
    });
  }
  return (
    <section aria-labelledby="schedule-heading">
      <h3 id="schedule-heading">Automatic cycle schedule</h3>
      <p>
        Keep upcoming cycles ready for rollover. Cycles start at midnight in{" "}
        {data.workspace.timezone}. Saving applies the cadence to future
        automatic cycles; cycles already started keep their dates.
      </p>
      {data.teams
        .filter((t) => !t.archivedAt && t.cyclesEnabled)
        .map((team) => {
          const schedule = data.cycleSchedules.find(
            (s) => s.teamId === team.id,
          );
          return (
            <form
              key={team.id + JSON.stringify(schedule)}
              aria-label={`Cycle schedule ${team.name}`}
              onSubmit={(event) => save(event, team.id)}
            >
              <h4>
                {team.name}
                {schedule ? " · Scheduled" : ""}
              </h4>
              <fieldset disabled={action.pending}>
                <label>
                  Cycle length (weeks)
                  <input
                    name="weeks"
                    type="number"
                    min={1}
                    max={8}
                    required
                    defaultValue={schedule?.weeks ?? 2}
                  />
                </label>
                <label>
                  Start weekday
                  <select
                    name="weekday"
                    defaultValue={schedule?.startWeekday ?? 1}
                  >
                    {weekdays.map((day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Cooldown (weeks)
                  <input
                    name="cooldown"
                    type="number"
                    min={0}
                    max={8}
                    required
                    defaultValue={schedule?.cooldownWeeks ?? 0}
                  />
                </label>
                <label>
                  Upcoming cycles to keep
                  <input
                    name="upcoming"
                    type="number"
                    min={1}
                    max={24}
                    required
                    defaultValue={schedule?.upcomingCount ?? 3}
                  />
                </label>
                <button>Save cycle schedule</button>
              </fieldset>
            </form>
          );
        })}
      <AdministrationFeedback action={action} />
    </section>
  );
}
