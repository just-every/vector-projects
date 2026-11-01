import {TeamTriageRotation} from '../../triage-responsibility/panel';
import '../../documents/ui/documents.css';
import { CreateSlackChannel } from "../../projects/ui/project-slack-choice";
import {TeamJoinRules} from "./team-join-rules";
import {TeamMetadata} from './team-metadata';
import {TeamPrivacy} from './team-privacy';
import { useHydrated } from "../../../app/initial-resources";
import { useState, type FormEvent } from "react";
import { useAdministrationAction } from "./administration-action";
import { AdministrationFeedback } from "./administration-feedback";
import { teamAccess } from "./team-access";
import { TeamMembers } from "./team-members";
import { TeamPermissions } from "./team-permissions";
import { decide } from "../../roles/policy";
import { TeamEmailIntake } from "../../email-intake/ui/team-email-intake";

import { GithubRules, useGithubRules, type GithubRulesResource } from "../../integrations/ui/github-rules";

import type { Administration } from "../../administration/schema";
type Team = Administration["teams"][number];
type Status = Team["statuses"][number];
const categories = [
  "intake",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
  "duplicate",
];
export function TeamsPanel({
  data,
  onChanged,
  openTeamId,
}: {
  data: Administration;
  onChanged: () => void;
  /** The team whose record the path names; its editor opens. */
  openTeamId?: string;
}) {
  const githubRules = useGithubRules();
  const handleChanged = () => {
    onChanged();
    githubRules.reload();
  };
  const action = useAdministrationAction(handleChanged);
  const creates = decide({ role: data.viewer.role, memberInvites: false, memberTeamCreation: data.workspace.memberTeamCreation, teams: new Map() }, { row: "teams.create" }) === "allow";
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (
      await action.run("/api/settings/teams", "POST", {
        name: fields.get("name"),
        identifierPrefix: fields.get("prefix"),
        createSlackChannel: fields.has("createSlackChannel"),
        isPrivate: fields.has('isPrivate'),
      })
    )
      form.reset();
  }
  return (
    <section
      id="teams"
      className="administration-panel"
      aria-labelledby="teams-heading"
    >
      <h2 id="teams-heading">Teams</h2>
      <p>
        Teams organise work. Archived teams retain their issues and history.
        Public work is visible across the workspace. Private work is for its team members and Owners.
      </p>
      <h3>Team directory</h3>
      <ul className="team-directory">
        {data.teams.map((team) => {
          const access = teamAccess(data, team);
          return (
            <li key={team.id}>
              <span>
                {team.name} · {team.identifierPrefix}
                {team.archivedAt ? " · Archived" : ""}{team.isPrivate ? ' · Private' : ''}
                {access.standing === "owner" ? " · You own this team" : access.standing ? " · You are a member" : ""}
              </span>
              {access.join && (access.standing ? (
                <button type="button" disabled={action.pending} onClick={() => void action.run(`/api/teams/${team.id}/leave`, "POST", {})}>
                  Leave {team.name}
                </button>
              ) : !team.archivedAt && (team.membershipMode === "open" && !team.isPrivate ? (
                <button type="button" disabled={action.pending} onClick={() => void action.run(`/api/teams/${team.id}/join`, "POST", {})}>
                  Join {team.name}
                </button>
              ) : team.requestsEnabled && access.request ? (
                <button type="button" disabled={action.pending || team.joinRequests.some(request=>request.requesterId===data.viewer.id&&request.state==="pending")} onClick={()=>void action.run(`/api/teams/${team.id}/requests`,"POST",{})}>
                  {team.joinRequests.some(request=>request.requesterId===data.viewer.id&&request.state==="pending") ? "Request pending for " : "Request to join "}{team.name}
                </button>
              ) : <span>Invitation required</span>))}
            </li>
          );
        })}
      </ul>
      {creates && <form aria-label="Create team" onSubmit={create}>
        <fieldset disabled={action.pending}>
          <label>
            Team name
            <input name="name" required maxLength={120} />
          </label>
          <label>
            Identifier prefix
            <input
              name="prefix"
              required
              pattern="[A-Z]{2,10}"
              minLength={2}
              maxLength={10}
              title="Two to ten uppercase letters"
            />
          </label>
          {(data.viewer.role === "owner" || data.viewer.role === "admin") && <>
            <label className="admin-checkbox"><input name="isPrivate" type="checkbox"/>Private team</label>
            <CreateSlackChannel />
          </>}
          <button type="submit">Create team</button>
        </fieldset>
      </form>}
      <AdministrationFeedback action={action} />
      {data.teams.filter((team) => teamAccess(data, team).opens).map((team) => (
        <TeamEditor key={team.id} data={data} team={team} onChanged={handleChanged} githubRules={githubRules} initiallyOpen={team.id === openTeamId} />
      ))}
    </section>
  );
}
function TeamEditor({
  data,
  team,
  onChanged,
  githubRules,
  initiallyOpen,
}: {
  data: Administration;
  team: Team;
  onChanged: () => void;
  githubRules: GithubRulesResource;
  initiallyOpen: boolean;
}) {
  const action = useAdministrationAction(onChanged);
  const hydrated = useHydrated();
  const access = teamAccess(data, team);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    await action.run(`/api/settings/teams/${team.id}`, "PATCH", {
      name: fields.get("name"),
      cyclesEnabled: fields.has("cyclesEnabled"),
      autoCycleStarted: fields.has("autoCycleStarted"),
      autoCycleCompleted: fields.has("autoCycleCompleted"),
      ...(team.prefixEditable
        ? { identifierPrefix: fields.get("prefix") }
        : {}),
    });
  }
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (
      await action.run(`/api/settings/teams/${team.id}/statuses`, "POST", {
        name: fields.get("name"),
        category: fields.get("category"),
      })
    )
      form.reset();
  }
  const statuses = [...team.statuses].sort((a, b) => a.position - b.position);
  return (
    <details open={initiallyOpen || undefined}>
      <summary>
        {team.name} · {team.identifierPrefix}
        {team.archivedAt ? " · Archived" : ""}
      </summary>
      {(data.viewer.role === 'owner' || data.viewer.role === 'admin') && <TeamPrivacy team={team} onChanged={onChanged}/>}
      {!team.canRead && data.viewer.role==='admin' && <TeamMetadata data={data} team={team}/>}
      {access.settings && !team.archivedAt && <GithubRules teamId={team.id} resource={githubRules} />}
      {team.canRead && <>
      <p><a className="document-team-link" href={'/app/teams/'+team.id}>Team documents</a></p>
      {!access.settings && <p>Only this team&apos;s owners and Admins change its settings.</p>}
      {access.settings && !access.archive && <p>Only this team&apos;s owners and Admins archive or unarchive it.</p>}
      <form aria-label={`Edit ${team.name}`} onSubmit={save}>
        <fieldset disabled={action.pending || !hydrated || !access.settings}>
          <label>
            Team name
            <input
              name="name"
              required
              maxLength={120}
              defaultValue={team.name}
            />
          </label>
          {team.prefixEditable ? (
            <label>
              Identifier prefix
              <input
                name="prefix"
                required
                pattern="[A-Z]{2,10}"
                minLength={2}
                maxLength={10}
                defaultValue={team.identifierPrefix}
              />
            </label>
          ) : (
            <p>
              Identifier prefix {team.identifierPrefix} is frozen because this
              team has issued an identifier.
            </p>
          )}
          <label className="admin-checkbox"><input type="checkbox" name="cyclesEnabled" key={String(team.cyclesEnabled)} defaultChecked={team.cyclesEnabled} />
            Enable cycles
          </label>
          <p>Turning cycles off hides cycle controls and pauses automation. Commitments, schedules and closed snapshots stay available when you turn cycles on again.</p>
          <label className="admin-checkbox"><input type="checkbox" name="autoCycleStarted" defaultChecked={team.autoCycleStarted} />
            Add uncommitted work to the active cycle when it starts
          </label>
          <label className="admin-checkbox"><input type="checkbox" name="autoCycleCompleted" defaultChecked={team.autoCycleCompleted} />
            Add uncommitted work to the active cycle when it completes
          </label>
          <p>These rules use this team’s current open cycle. Existing commitments stay in place. Turn either rule off here to stop it.</p>
          <button type="submit">Save team</button>
          <button
            type="button"
            disabled={!access.archive}
            onClick={() =>
              void action.run(`/api/settings/teams/${team.id}`, "PATCH", {
                archived: !team.archivedAt,
              })
            }
          >
            {team.archivedAt ? "Unarchive team" : "Archive team"}
          </button>
        </fieldset>
      </form>
      {access.settings && !team.archivedAt && <TeamTriageRotation data={data} team={team}/>}
      <TeamMembers data={data} team={team} onChanged={onChanged} />
      <TeamJoinRules data={data} team={team} onChanged={onChanged}/>
      <TeamPermissions data={data} team={team} onChanged={onChanged} />
      {access.settings && <TeamEmailIntake teamId={team.id} teamName={team.name} archived={team.archivedAt !== null} />}
      <h3>Workflow</h3>
      <p>
        Each category keeps at least one status. The first status in a category
        is its default.
      </p>
      {!access.workflow && <p>Only this team&apos;s owners and Admins change its workflow.</p>}
      {statuses.map((status, index) => (
        <StatusEditor
          key={status.id}
          teamId={team.id}
          status={status}
          statuses={statuses}
          index={index}
          editable={access.workflow}
          onChanged={onChanged}
        />
      ))}
      <form aria-label={`Add status to ${team.name}`} onSubmit={add}>
        <fieldset disabled={action.pending || !hydrated || !access.workflow}>
          <label>
            Status name
            <input name="name" required maxLength={120} />
          </label>
          <label>
            Status category
            <select name="category">
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category[0].toUpperCase() + category.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Add status</button>
        </fieldset>
      </form>
      <AdministrationFeedback action={action} />
      </>}
    </details>
  );
}
function StatusEditor({
  teamId,
  status,
  statuses,
  index,
  editable,
  onChanged,
}: {
  teamId: string;
  status: Status;
  statuses: Status[];
  index: number;
  editable: boolean;
  onChanged: () => void;
}) {
  const action = useAdministrationAction(onChanged);
  const locked = action.pending || !editable;
  const [destination, setDestination] = useState("");
  const choices = statuses.filter(
    (s) => s.category === status.category && s.id !== status.id,
  );
  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action.run(
      `/api/settings/teams/${teamId}/statuses/${status.id}`,
      "PATCH",
      { name: new FormData(event.currentTarget).get("name") },
    );
  }
  function reorder(offset: number) {
    const ids = statuses.map((s) => s.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    void action.run(`/api/settings/teams/${teamId}/statuses/order`, "PUT", {
      statusIds: ids,
    });
  }
  return (
    <div
      className="admin-status"
      role="group"
      aria-label={`Workflow status ${status.name}`}
    >
      <p>
        {status.category[0].toUpperCase() + status.category.slice(1)}
        {statuses.find((s) => s.category === status.category)?.id === status.id
          ? " · Default"
          : ""}
      </p>
      <form aria-label={`Rename ${status.name}`} onSubmit={rename}>
        <label>
          Status name
          <input
            name="name"
            required
            maxLength={120}
            defaultValue={status.name}
            disabled={locked}
          />
        </label>
        <button disabled={locked}>Rename status</button>
      </form>
      <div className="admin-actions">
        <button
          type="button"
          disabled={locked || index === 0}
          onClick={() => reorder(-1)}
        >
          Move up
        </button>
        <button
          type="button"
          disabled={locked || index === statuses.length - 1}
          onClick={() => reorder(1)}
        >
          Move down
        </button>
      </div>
      {choices.length ? (
        <>
          <label>
            Destination status
            <select
              value={destination}
              disabled={locked}
              onChange={(event) => setDestination(event.target.value)}
            >
              <option value="">Choose a same-category destination</option>
              {choices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={locked || !destination}
            onClick={() =>
              void action.run(
                `/api/settings/teams/${teamId}/statuses/${status.id}`,
                "DELETE",
                { destinationStatusId: destination },
              )
            }
          >
            Remove status
          </button>
        </>
      ) : (
        <p>This category’s last status cannot be removed.</p>
      )}
      <AdministrationFeedback action={action} />
    </div>
  );
}
