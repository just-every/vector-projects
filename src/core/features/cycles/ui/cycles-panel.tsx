import { useDateFormat } from "../../../shared/date-format";
import { CycleSchedulePanel } from "../../cycle-schedule/panel";
import { Link } from "@tanstack/react-router";
import type { FormEvent } from "react";
import type { Administration } from "../../administration/schema";
import { useAdministrationAction } from "../../settings/ui/administration-action";
import { AdministrationFeedback } from "../../settings/ui/administration-feedback";
export function CyclesPanel({
  data,
  onChanged,
  heading = "Cycles",
}: {
  data: Administration;
  onChanged: () => void;
  heading?: string;
}) {
  const { range } = useDateFormat();
  const action = useAdministrationAction(onChanged);
  const mayManage = data.viewer.role !== "guest";
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const capacity = fields.get("capacity");
    if (
      await action.run("/api/settings/cycles", "POST", {
        teamId: fields.get("team"),
        name: fields.get("name"),
        startsLocal: fields.get("start"),
        endsLocal: fields.get("end"),
        capacity: capacity === "" ? null : Number(capacity),
      })
    )
      form.reset();
  }
  return (
    <section
      id="cycles"
      className="administration-panel"
      aria-labelledby="cycles-heading"
    >
      <h2 id="cycles-heading">{heading}</h2>
      <Link className="admin-link" to="/app/cycles">
        All cycles
      </Link>
      {mayManage && <><p>
        Create cycles in workspace time:{" "}
        <strong>{data.workspace.timezone}</strong>. End must follow start;
        cycles for the same team cannot overlap. When clocks change, choose a
        time that occurs once. Times that happen twice or are skipped cannot be
        saved.
      </p>
      <CycleSchedulePanel data={data} onChanged={onChanged} /></>}
      {data.cycles.length === 0 && (
        <p>{mayManage ? "No cycles yet. Create your first cycle below." : "No cycles in your invited teams."}</p>
      )}
      {mayManage && <form aria-label="Create cycle" onSubmit={create}>
        <fieldset disabled={action.pending}>
          <label>
            Cycle team
            <select name="team" required>
              <option value="">Choose a team</option>
              {data.teams
                .filter((team) => !team.archivedAt && team.cyclesEnabled)
                .map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Cycle name
            <input name="name" required maxLength={120} />
          </label>
          <label>
            Cycle start
            <input name="start" type="datetime-local" required />
          </label>
          <label>
            Cycle end
            <input name="end" type="datetime-local" required />
          </label>
          <label>
            Cycle capacity
            <input name="capacity" type="number" min={0} step={1} />
          </label>
          <button>Create cycle</button>
        </fieldset>
      </form>}
      <AdministrationFeedback action={action} />
      {data.cycles.filter(cycle => data.teams.some(team => team.id === cycle.teamId && team.cyclesEnabled)).map((cycle) => (
        <div className="admin-record" key={cycle.id}>
          <Link
            className="admin-link"
            to="/app/cycles/$cycleId"
            params={{ cycleId: cycle.id }}
          >
            Open {cycle.name}
          </Link>
          <p>
            {data.teams.find((team) => team.id === cycle.teamId)?.name} ·{" "}
            {range(cycle.startsAt, cycle.endsAt)}
            {cycle.closedAt ? " · Closed" : ""}
          </p>
        </div>
      ))}
    </section>
  );
}
