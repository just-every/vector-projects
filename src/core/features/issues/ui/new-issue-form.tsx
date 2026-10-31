import { useAccountDrafts } from '../../drafts/use-drafts';
import { DraftList } from '../../drafts/list';
import { preferenceSchema } from "../../views/schema";
import { lastCreatedTeamKey, preferredTeam } from "./preferred-team";
import { administrationSchema } from "../../administration/schema";
import { useViewerTime } from '../../../app/viewer-time';
import { MentionTextarea } from "../../notifications/ui/mention-textarea";
import { useCanGoBack, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, fetchJson, useApiResource } from "../../../app/api-client";
import { workspaceOptionsSchema } from "../../../shared/workspace-options";
import { issueDetailSchema } from "./data";
import { navigationPageSchema, offerNavigationReceipt } from '../../../app/navigation-receipt';
import { isSafeHttpsUrl } from "../../links/schema";
import {
  createIssuePayload,
  createIntakePayload,
  emptyNewIssueDraft,
  hasUnsavedDraft,
  newIssueDraftKey,
  parseNewIssueDraft,
  type NewIssueDraft,
} from "./new-issue-draft";

const allowedStatusCategories = new Set([
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
]);
const createdIssueSchema = issueDetailSchema.extend({ page: navigationPageSchema.optional() });
// Back stays in Vector: the Navigation API knows whether the entry behind this tab's form is one
// of this site's pages; without it, the router knows the entries it made itself.
const vectorPageBehind = (routerCanGoBack: boolean) =>
  (window as Window & { navigation?: { canGoBack: boolean } }).navigation?.canGoBack ?? routerCanGoBack;

export function NewIssueForm() {
  const { effectiveTimezone } = useViewerTime();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const options = useApiResource("/api/options", workspaceOptionsSchema);
  const administration = useApiResource("/api/metadata", administrationSchema);
  const boardPreference = useApiResource("/api/preferences/board", preferenceSchema);
  const [values, setValues] = useState<NewIssueDraft>(emptyNewIssueDraft);
  const openingDefaults = useRef(emptyNewIssueDraft);
  const [draftReady, setDraftReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const storageKey = options.data
    ? newIssueDraftKey(options.data.workspace.id, options.data.operator.id)
    : null;

  const account = useAccountDrafts(values, setValues, draftReady && options.data?.operator.role !== 'viewer',
    storageKey, openingDefaults.current, submitting);

  useEffect(() => {
    if (!storageKey || draftReady || !options.data || !administration.data || !boardPreference.data) return;
    const defaults = { ...emptyNewIssueDraft, teamId: preferredTeam(options.data, administration.data,
      [boardPreference.data.filters.team]) };
    const project = new URLSearchParams(window.location.search).get("project");
    if (project && options.data.projects.some(choice => choice.id === project)) defaults.projectId = project;
    openingDefaults.current = defaults;
    let draft = defaults;
    try {
      defaults.teamId = preferredTeam(options.data, administration.data, [
        window.localStorage.getItem(lastCreatedTeamKey(options.data.workspace.id, options.data.operator.id)),
        boardPreference.data.filters.team,
      ]);
      const stored = window.localStorage.getItem(storageKey);
      const restored =
        stored === null ? null : parseNewIssueDraft(JSON.parse(stored));
      // Choosing Issue or Intake alone is not unsent content.
      if (restored) {
        const candidate = { ...restored, teamId: restored.teamId || defaults.teamId };
        if (defaults.projectId) { candidate.projectId = defaults.projectId; candidate.mode = "issue"; }
        if (hasUnsavedDraft(candidate, { ...defaults, mode: candidate.mode })) {
          draft = candidate;
          setNotice("Restored your unsent draft from this browser.");
        }
      }
    } catch {
      setStorageError("This browser could not read the unsent draft.");
    }
    setValues(draft);
    setDraftReady(true);
  }, [draftReady, storageKey, options.data, administration.data, boardPreference.data]);

  useEffect(() => {
    if (!draftReady || !storageKey) return;
    try {
      if (hasUnsavedDraft(values, { ...openingDefaults.current, mode: values.mode }))
        window.localStorage.setItem(storageKey, JSON.stringify(values));
      else window.localStorage.removeItem(storageKey);
    } catch {
      setStorageError("This browser could not save the unsent draft.");
    }
  }, [draftReady, storageKey, values]);

  const statuses = useMemo(
    () =>
      options.data?.statuses.filter(
        (status) =>
          status.teamId === values.teamId &&
          allowedStatusCategories.has(status.category),
      ) ?? [],
    [options.data, values.teamId],
  );
  const cycles = useMemo(
    () =>
      options.data?.cycles.filter((cycle) => cycle.teamId === values.teamId) ??
      [],
    [options.data, values.teamId],
  );

  const changeTeam = (teamId: string) =>
    setValues((current) => ({
      ...current,
      teamId,
      statusId:
        current.statusId &&
        options.data?.statuses.some(
          (status) =>
            status.id === current.statusId &&
            status.teamId === teamId &&
            allowedStatusCategories.has(status.category),
        )
          ? current.statusId
          : "",
      cycleId:
        current.cycleId &&
        options.data?.cycles.some(
          (cycle) => cycle.id === current.cycleId && cycle.teamId === teamId,
        )
          ? current.cycleId
          : "",
    }));

  const toggleLabel = (labelId: string) =>
    setValues((current) => ({
      ...current,
      labelIds: current.labelIds.includes(labelId)
        ? current.labelIds.filter((id) => id !== labelId)
        : [...current.labelIds, labelId],
    }));

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmissionError(null);
    setSubmitting(true);
    try {
      const isIntake = values.mode === "intake";
      const draft = isIntake ? null : await account.flush();
      const issue = await fetchJson(
        isIntake ? "/api/intake" : "/api/issues",
        createdIssueSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...(!isIntake ? { 'x-vector-page': 'issue', ...(draft ? { 'x-vector-draft-id': draft.id, 'x-vector-draft-revision': String(draft.revision) } : {}) } : {}) },
          body: JSON.stringify(
            isIntake ? createIntakePayload(values, effectiveTimezone) : createIssuePayload(values),
          ),
        },
      );
      account.consumed();
      try {
        if (storageKey) window.localStorage.removeItem(storageKey);
      } catch {
        setStorageError(
          "The issue was created, but this browser could not clear its draft.",
        );
      }
      try {
        if (options.data) window.localStorage.setItem(
          lastCreatedTeamKey(options.data.workspace.id, options.data.operator.id), values.teamId);
      } catch {
        setStorageError("The issue was created, but this browser could not remember its team.");
      }
      const retire = issue.page ? offerNavigationReceipt('/app/issues/' + issue.identifier, issue.page) : undefined;
      try {
        await navigate({ to: "/app/issues/$identifier", params: { identifier: issue.identifier } });
      } finally { retire?.(); }
    } catch (error) {
      setSubmissionError(
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "Unable to create this issue.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const back = <button type="button" className="detail-back" onClick={() => vectorPageBehind(canGoBack) ? window.history.back() : void navigate({ to: "/app" })}>← Back</button>;
  const loadError = options.error || administration.error || boardPreference.error;
  if (loadError)
    return (
      <main className="new-issue-state new-issue-state--error" role="alert">
        {back}
        <strong>Unable to load issue options.</strong>
        <span>{loadError.message}</span>
        <button type="button" onClick={() => { options.reload(); administration.reload(); boardPreference.reload(); }}>
          Try again
        </button>
      </main>
    );
  if (!options.data || !administration.data || !boardPreference.data)
    return (
      <main className="new-issue-state" aria-live="polite">
        {back}
        Loading issue options…
      </main>
    );

  if (options.data.operator.role === 'viewer') return <main className="new-issue-state"><h1>New issue</h1><p>Your Viewer role is read-only.</p></main>;
  const labelsPerIssue = options.data.labelsPerIssue;

  return (
    <main className="new-issue-page" aria-labelledby="new-issue-title">
      <form
        className="new-issue-form"
        onSubmit={submit}
        aria-busy={submitting}
        onInvalidCapture={(event) => {
          let disclosure = (event.target as HTMLElement).closest("details");
          while (disclosure) {
            disclosure.open = true;
            disclosure = disclosure.parentElement?.closest("details") ?? null;
          }
        }}
      >
        <fieldset
          className="new-issue-controls"
          disabled={submitting || !draftReady || !account.initialized}
          aria-label="Issue creation fields"
        >
          <header className="new-issue-header">
            <div>
              {back}
              <h1 id="new-issue-title">
                {values.mode === "intake" ? "New intake" : "New issue"}
              </h1>
            </div>
            <button
              className="new-issue-submit"
              type="submit"
              disabled={submitting}
            >
              {submitting
                ? "Creating…"
                : values.mode === "intake"
                  ? "Create intake"
                  : "Create issue"}
            </button>
          </header>
          <DraftList drafts={account.drafts}
            open={draft => { void account.open(draft).catch(account.report); }}
            discard={draft => { void account.discard(draft).catch(account.report); }}
            create={() => { void account.newDraft().catch(account.report); }} />
          {account.message ? <p className="new-issue-message" aria-live="polite">{account.message}</p> : null}
          {notice ? (
            <p className="new-issue-message" aria-live="polite">
              {notice}
            </p>
          ) : null}
          {storageError ? (
            <p
              className="new-issue-message new-issue-message--error"
              role="alert"
            >
              {storageError}
            </p>
          ) : null}
          {submissionError ? (
            <p
              className="new-issue-message new-issue-message--error"
              role="alert"
            >
              {submissionError}
            </p>
          ) : null}
          <fieldset className="new-issue-mode">
            <legend>Create</legend>
            <label>
              <input
                type="radio"
                name="creation-mode"
                value="issue"
                checked={values.mode === "issue"}
                disabled={submitting}
                onChange={() => setValues({ ...values, mode: "issue" })}
              />
              Issue<span>Ready for work</span>
            </label>
            <label>
              <input
                type="radio"
                name="creation-mode"
                value="intake"
                checked={values.mode === "intake"}
                disabled={submitting}
                onChange={() => setValues({ ...values, mode: "intake" })}
              />
              Intake<span>Needs a decision</span>
            </label>
          </fieldset>
          <section className="new-issue-section">
            <label className="new-issue-title-field">
              Title<span>Required</span>
              <input
                value={values.title}
                onChange={(event) =>
                  setValues({ ...values, title: event.target.value })
                }
                required
                maxLength={500}
                autoFocus
              />
            </label>
            <label>
              Team<span>Required</span>
              <select
                value={values.teamId}
                onChange={(event) => changeTeam(event.target.value)}
                required
              >
                <option value="">Choose a team</option>
                {options.data.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="new-issue-description">
              Description <span>Markdown supported</span>
              <MentionTextarea
                aria-label="Description"
                value={values.description}
                onValueChange={(description) =>
                  setValues({ ...values, description })
                }
                maxLength={100_000}
              />
            </label>
          </section>
          {values.mode === "intake" ? (
            <>
              <section
                className="new-issue-fields new-issue-fields--single"
                aria-label="Intake context"
              >
                <label>
                  Observed time ({effectiveTimezone})
                  <span>
                    Optional · defaults to now, shown in your local time
                  </span>
                  <input
                    type="datetime-local"
                    value={values.intakeObservedAt}
                    onChange={(event) =>
                      setValues({
                        ...values,
                        intakeObservedAt: event.target.value,
                      })
                    }
                  />
                </label>
              </section>
              <IntakeEvidenceFields values={values} setValues={setValues} />
              <details className="new-issue-more">
                <summary>Outcome and impact</summary>
                <div>
                  <label>
                    Expected outcome
                    <textarea
                      value={values.expectedOutcome}
                      onChange={(event) =>
                        setValues({
                          ...values,
                          expectedOutcome: event.target.value,
                        })
                      }
                      maxLength={20_000}
                    />
                  </label>
                  <label>
                    Customer impact
                    <textarea
                      value={values.customerImpact}
                      onChange={(event) =>
                        setValues({
                          ...values,
                          customerImpact: event.target.value,
                        })
                      }
                      maxLength={20_000}
                    />
                  </label>
                </div>
              </details>
            </>
          ) : (
            <details className="new-issue-more new-issue-context">
              <summary>Optional context</summary>
              <div>
                <section
                  className="new-issue-fields"
                  aria-label="Issue context"
                >
                  <label>
                    Status<span>Optional</span>
                    <select
                      value={values.statusId}
                      onChange={(event) =>
                        setValues({ ...values, statusId: event.target.value })
                      }
                      disabled={!values.teamId}
                    >
                      <option value="">Default for team</option>
                      {statuses.map((status) => (
                        <option key={status.id} value={status.id}>
                          {status.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Assignee
                    <select
                      value={values.assigneeOperatorId}
                      onChange={(event) =>
                        setValues({
                          ...values,
                          assigneeOperatorId: event.target.value,
                        })
                      }
                    >
                      <option value="">Unassigned</option>
                      {options.data.operators.map((operator) => (
                        <option key={operator.id} value={operator.id}>
                          {operator.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Project
                    <select
                      value={values.projectId}
                      onChange={(event) =>
                        setValues({ ...values, projectId: event.target.value, milestoneId: "" })
                      }
                    >
                      <option value="">No project</option>
                      {options.data.projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Milestone
                    <select value={values.milestoneId} disabled={!values.projectId}
                      onChange={event => setValues({...values, milestoneId:event.target.value})}>
                      <option value="">No milestone</option>
                      {options.data.milestones.filter(item => item.projectId === values.projectId).map(item => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Cycle
                    <select
                      value={values.cycleId}
                      onChange={(event) =>
                        setValues({ ...values, cycleId: event.target.value })
                      }
                      disabled={!values.teamId}
                    >
                      <option value="">No cycle</option>
                      {cycles.map((cycle) => (
                        <option key={cycle.id} value={cycle.id}>
                          {cycle.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Priority
                    <select
                      value={values.priority}
                      onChange={(event) =>
                        setValues({
                          ...values,
                          priority: event.target
                            .value as NewIssueDraft["priority"],
                        })
                      }
                    >
                      <option value="urgent">Urgent</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                      <option value="none">No priority</option>
                    </select>
                  </label>
                  <label>
                    Estimate <span>Points</span>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      value={values.estimate}
                      onChange={(event) =>
                        setValues({ ...values, estimate: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Start date
                    <input type="date" value={values.startDate}
                      onChange={(event) => setValues({ ...values, startDate: event.target.value })} />
                  </label>
                  <label>
                    Due date
                    <input
                      type="date"
                      value={values.dueDate}
                      onChange={(event) =>
                        setValues({ ...values, dueDate: event.target.value })
                      }
                    />
                  </label>
                </section>
                <fieldset className="new-issue-labels">
                  <legend>Labels{values.labelIds.length >= labelsPerIssue - 1 ? ` · ${values.labelIds.length} of ${labelsPerIssue}` : ""}</legend>
                  {options.data.labels.length === 0 ? (
                    <span>No labels are available.</span>
                  ) : (
                    <div>
                      {options.data.labels.map((label) => (
                        <label key={label.id}>
                          <input
                            type="checkbox"
                            checked={values.labelIds.includes(label.id)}
                            disabled={
                              !values.labelIds.includes(label.id) &&
                              values.labelIds.length >= labelsPerIssue
                            }
                            onChange={() => toggleLabel(label.id)}
                          />
                          <i
                            style={{ background: label.color }}
                            aria-hidden="true"
                          />
                          {label.name}
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
                <div className="new-issue-outcome-fields">
                  <label>
                    Expected outcome
                    <textarea
                      value={values.expectedOutcome}
                      onChange={(event) =>
                        setValues({
                          ...values,
                          expectedOutcome: event.target.value,
                        })
                      }
                      maxLength={20_000}
                    />
                  </label>
                  <label>
                    Customer impact
                    <textarea
                      value={values.customerImpact}
                      onChange={(event) =>
                        setValues({
                          ...values,
                          customerImpact: event.target.value,
                        })
                      }
                      maxLength={20_000}
                    />
                  </label>
                </div>
              </div>
            </details>
          )}
        </fieldset>
      </form>
    </main>
  );
}

function IntakeEvidenceFields({
  values,
  setValues,
}: {
  values: NewIssueDraft;
  setValues: React.Dispatch<React.SetStateAction<NewIssueDraft>>;
}) {
  const measurementNames = values.intakeMeasurements.map((row) =>
    row.name.trim(),
  );
  const invalidMeasurements =
    new Set(measurementNames).size !== measurementNames.length ||
    values.intakeMeasurements.some(
      (row) =>
        !row.name.trim() ||
        row.name.trim().length > 100 ||
        (row.type === "text" && row.value.length > 20_000) ||
        (row.type === "number" &&
          (!row.value.trim() || !Number.isFinite(Number(row.value)))) ||
        (row.type === "boolean" &&
          row.value !== "true" &&
          row.value !== "false"),
    );
  const invalidReports = values.intakeCustomerReports.some(
    (row) =>
      !row.summary.trim() ||
      row.summary.trim().length > 100_000 ||
      row.customer.trim().length > 500 ||
      (row.link !== "" &&
        (row.link.length > 2000 || !isSafeHttpsUrl(row.link))),
  );
  const changeMeasurement = (
    index: number,
    patch: Partial<NewIssueDraft["intakeMeasurements"][number]>,
  ) =>
    setValues((current) => ({
      ...current,
      intakeMeasurements: current.intakeMeasurements.map((row, position) =>
        position === index ? { ...row, ...patch } : row,
      ),
    }));
  const changeReport = (
    index: number,
    patch: Partial<NewIssueDraft["intakeCustomerReports"][number]>,
  ) =>
    setValues((current) => ({
      ...current,
      intakeCustomerReports: current.intakeCustomerReports.map(
        (row, position) => (position === index ? { ...row, ...patch } : row),
      ),
    }));
  return (
    <>
      <section
        className="new-issue-section new-intake-evidence"
        aria-label="Intake evidence"
      >
        <label>
          Evidence summary<span>Optional · defaults to the title</span>
          <textarea
            value={values.intakeSummary}
            maxLength={100_000}
            onChange={(event) =>
              setValues({ ...values, intakeSummary: event.target.value })
            }
          />
        </label>
        <label>
          Evidence link<span>Optional · HTTPS</span>
          <input
            type="url"
            maxLength={2000}
            value={values.intakeLink}
            placeholder="https://"
            onChange={(event) =>
              setValues({ ...values, intakeLink: event.target.value })
            }
          />
        </label>
      </section>
      <details
        className="new-issue-more new-intake-more"
        open={values.intakeMeasurements.length > 0 || undefined}
        onToggle={(event) => {
          if (
            !event.currentTarget.open &&
            (invalidMeasurements ||
              event.currentTarget.querySelector(":invalid"))
          )
            event.currentTarget.open = true;
        }}
      >
        <summary>Measurements · optional</summary>
        <div className="new-intake-rows">
          {values.intakeMeasurements.map((row, index) => (
            <fieldset className="new-intake-row" key={index}>
              <legend>Measurement {index + 1}</legend>
              <div className="new-intake-measurement-fields">
                <label>
                  Name
                  <input
                    aria-label={`Measurement ${index + 1} name`}
                    required
                    maxLength={100}
                    value={row.name}
                    onChange={(event) =>
                      changeMeasurement(index, { name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Type
                  <select
                    aria-label={`Measurement ${index + 1} type`}
                    value={row.type}
                    onChange={(event) =>
                      changeMeasurement(index, {
                        type: event.target.value as typeof row.type,
                        value: "",
                      })
                    }
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="boolean">Yes or no</option>
                  </select>
                </label>
                <label>
                  Value
                  {row.type === "boolean" ? (
                    <select
                      aria-label={`Measurement ${index + 1} value`}
                      required
                      value={row.value}
                      onChange={(event) =>
                        changeMeasurement(index, { value: event.target.value })
                      }
                    >
                      <option value="">Choose a value</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : (
                    <input
                      aria-label={`Measurement ${index + 1} value`}
                      type={row.type === "number" ? "number" : "text"}
                      step={row.type === "number" ? "any" : undefined}
                      required={row.type === "number"}
                      maxLength={20_000}
                      value={row.value}
                      onChange={(event) =>
                        changeMeasurement(index, { value: event.target.value })
                      }
                    />
                  )}
                </label>
              </div>
              <button
                className="new-intake-row-action"
                type="button"
                aria-label={`Remove measurement ${index + 1}`}
                onClick={() =>
                  setValues((current) => ({
                    ...current,
                    intakeMeasurements: current.intakeMeasurements.filter(
                      (_, position) => position !== index,
                    ),
                  }))
                }
              >
                Remove measurement
              </button>
            </fieldset>
          ))}
          <button
            className="new-intake-row-action"
            type="button"
            disabled={values.intakeMeasurements.length >= 50}
            onClick={() =>
              setValues((current) => ({
                ...current,
                intakeMeasurements: [
                  ...current.intakeMeasurements,
                  { name: "", value: "", type: "text" },
                ],
              }))
            }
          >
            Add measurement
          </button>
        </div>
      </details>
      <details
        className="new-issue-more new-intake-more"
        open={values.intakeCustomerReports.length > 0 || undefined}
        onToggle={(event) => {
          if (
            !event.currentTarget.open &&
            (invalidReports || event.currentTarget.querySelector(":invalid"))
          )
            event.currentTarget.open = true;
        }}
      >
        <summary>Customer reports · optional</summary>
        <div className="new-intake-rows">
          {values.intakeCustomerReports.map((row, index) => (
            <fieldset className="new-intake-row" key={index}>
              <legend>Customer report {index + 1}</legend>
              <label>
                Customer<span>Optional</span>
                <input
                  aria-label={`Customer report ${index + 1} customer`}
                  maxLength={500}
                  value={row.customer}
                  onChange={(event) =>
                    changeReport(index, { customer: event.target.value })
                  }
                />
              </label>
              <label>
                Report summary<span>Required</span>
                <textarea
                  aria-label={`Customer report ${index + 1} summary`}
                  required
                  maxLength={100_000}
                  value={row.summary}
                  onChange={(event) =>
                    changeReport(index, { summary: event.target.value })
                  }
                />
              </label>
              <label>
                Report link<span>Optional · HTTPS</span>
                <input
                  aria-label={`Customer report ${index + 1} link`}
                  type="url"
                  maxLength={2000}
                  placeholder="https://"
                  value={row.link}
                  onChange={(event) =>
                    changeReport(index, { link: event.target.value })
                  }
                />
              </label>
              <button
                className="new-intake-row-action"
                type="button"
                aria-label={`Remove customer report ${index + 1}`}
                onClick={() =>
                  setValues((current) => ({
                    ...current,
                    intakeCustomerReports: current.intakeCustomerReports.filter(
                      (_, position) => position !== index,
                    ),
                  }))
                }
              >
                Remove customer report
              </button>
            </fieldset>
          ))}
          <button
            className="new-intake-row-action"
            type="button"
            disabled={values.intakeCustomerReports.length >= 50}
            onClick={() =>
              setValues((current) => ({
                ...current,
                intakeCustomerReports: [
                  ...current.intakeCustomerReports,
                  { customer: "", summary: "", link: "" },
                ],
              }))
            }
          >
            Add customer report
          </button>
        </div>
      </details>
    </>
  );
}
