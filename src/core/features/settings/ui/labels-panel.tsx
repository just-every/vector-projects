import { useHydrated } from "../../../app/initial-resources";
import { useId, useRef, useState, type FormEvent } from "react";
import type { Administration } from "../../administration/schema";
import { LabelChip } from "../../../app/ui/label-chip";
import { useAdministrationAction } from "./administration-action";
import { AdministrationFeedback } from "./administration-feedback";
import { LabelGroupsPanel } from "./label-groups-panel";
export function LabelsPanel({
  labels,
  labelGroups,
  onChanged,
  readOnly = false,
  memberLabelCreation,
}: {
  labels: Administration["labels"];
  labelGroups: Administration["labelGroups"];
  onChanged: () => void;
  readOnly?: boolean;
  memberLabelCreation: boolean;
}) {
  const action = useAdministrationAction(onChanged);
  const hydrated = useHydrated();
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (
      await action.run("/api/settings/labels", "POST", {
        name: fields.get("name"),
        color: fields.get("color"),
        projectsEnabled: fields.get("projectsEnabled") === "on",
        groupId: fields.get("groupId") || null,
      })
    )
      form.reset();
  }
  return (
    <section
      id="labels"
      className="administration-panel"
      aria-labelledby="labels-heading"
    >
      <h2 id="labels-heading">Labels</h2>
      {readOnly && <p>Workspace labels are read-only here. Owners and Admins manage labels.</p>}
      {!readOnly && <form aria-label="Label creation permission" onSubmit={async event => {
        event.preventDefault();
        await action.run("/api/settings/labels/creation", "PUT", {membersMayCreate: new FormData(event.currentTarget).get("membersMayCreate") === "members"});
      }}>
        <fieldset disabled={action.pending || !hydrated}>
          <label htmlFor="label-creation-permission">Who may create labels</label>
            <select id="label-creation-permission" name="membersMayCreate" key={String(memberLabelCreation)} defaultValue={memberLabelCreation ? "members" : "admins"}>
              <option value="members">Members too</option>
              <option value="admins">Owners and Admins only</option>
            </select>
          <button>Save label permission</button>
        </fieldset>
      </form>}
      {!readOnly && <form aria-label="Create label" onSubmit={create}>
        <fieldset disabled={action.pending || !hydrated}>
          <label>
            Label name
            <input name="name" required maxLength={120} />
          </label>
          <label>
            Label colour
            <input name="color" type="color" defaultValue="#8fa3f0" />
          </label>
          <GroupSelect groups={labelGroups} />
          <label><input type="checkbox" name="projectsEnabled" />Use for projects</label>
          <button>Create label</button>
        </fieldset>
      </form>}
      <AdministrationFeedback action={action} />
      {!readOnly && <LabelGroupsPanel groups={labelGroups} labels={labels} onChanged={onChanged} />}
      {labels.map((label) => (
        readOnly
          ? <p key={label.id}><LabelChip name={label.name} color={label.color} />{label.groupId && <> {labelGroups.find(group => group.id === label.groupId)?.name}</>}</p>
          : <LabelEditor key={label.id} label={label} labels={labels} groups={labelGroups} onChanged={onChanged} />
      ))}
    </section>
  );
}
function GroupSelect({ groups, value = "" }: { groups: Administration["labelGroups"]; value?: string }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id}>Label group</label>
      <select id={id} name="groupId" defaultValue={value}>
        <option value="">No group</option>
        {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select>
    </>
  );
}
function LabelEditor({
  label,
  labels,
  groups,
  onChanged,
}: {
  label: Administration["labels"][number];
  labels: Administration["labels"];
  groups: Administration["labelGroups"];
  onChanged: () => void;
}) {
  const action = useAdministrationAction(onChanged);
  const hydrated = useHydrated();
  const [color, setColor] = useState(label.color);
  const [confirm, setConfirm] = useState(false);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action.run(`/api/settings/labels/${label.id}`, "PATCH", {
      name: new FormData(event.currentTarget).get("name"),
      color,
      projectsEnabled: new FormData(event.currentTarget).get("projectsEnabled") === "on",
      groupId: new FormData(event.currentTarget).get("groupId") || null,
    });
  }
  return (
    <details>
      <summary>
        <LabelChip name={label.name} color={label.color} />
      </summary>
      <form aria-label={`Edit label ${label.name}`} onSubmit={save}>
        <fieldset disabled={action.pending || !hydrated}>
          <label>
            Label name
            <input
              name="name"
              required
              maxLength={120}
              defaultValue={label.name}
            />
          </label>
          <label>
            Label colour
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
          </label>
          <GroupSelect groups={groups} value={label.groupId ?? ""} />
          <label><input type="checkbox" name="projectsEnabled" defaultChecked={label.projectsEnabled} />Use for projects</label>
          <LabelChip name={label.name} color={color} />
          <button>Save label</button>
          <button
            ref={deleteTrigger}
            type="button"
            onClick={() => setConfirm(true)}
          >
            Delete label
          </button>
        </fieldset>
      </form>
      <form aria-label={`Merge label ${label.name}`} onSubmit={async event => {
        event.preventDefault();
        await action.run(`/api/settings/labels/${label.id}/merge`, "POST", {destinationLabelId: new FormData(event.currentTarget).get("destinationLabelId")});
      }}>
        <fieldset disabled={action.pending || !hydrated}>
          <label htmlFor={`merge-label-${label.id}`}>Merge into</label>
            <select id={`merge-label-${label.id}`} name="destinationLabelId" required defaultValue="">
              <option value="" disabled>Choose destination label</option>
              {labels.filter(candidate=>candidate.id!==label.id).map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          <p>Merging relabels issues, projects and saved-view filters and removes this label.</p>
          <button>Merge label</button>
        </fieldset>
      </form>
      {confirm && (
        <div role="group" aria-label="Confirm label deletion">
          <p id={`delete-label-${label.id}`}>
            Delete {label.name}? It will be removed from projects, issues and saved-view
            filters.
          </p>
          <div className="admin-actions">
            <button
              disabled={action.pending || !hydrated}
              type="button"
              autoFocus
              aria-describedby={`delete-label-${label.id}`}
              onClick={() =>
                void action.run(`/api/settings/labels/${label.id}`, "DELETE")
              }
            >
              Confirm delete label
            </button>
            <button
              disabled={action.pending || !hydrated}
              type="button"
              onClick={() => {
                setConfirm(false);
                deleteTrigger.current?.focus();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <AdministrationFeedback action={action} />
    </details>
  );
}
