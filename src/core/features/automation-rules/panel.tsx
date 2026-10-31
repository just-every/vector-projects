import "./panel.css";
import { useState, type FormEvent } from "react";
import { fetchJson, useApiResource } from "../../app/api-client";
import { dueRulesSchema, type DueRule } from "./schema";

const utc = (instant: string) =>
  new Date(instant).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export function DueRulesPanel() {
  const resource = useApiResource(
    "/api/settings/automation",
    dueRulesSchema,
    5000,
  );
  return (
    <section
      id="automation"
      className="administration-panel"
      aria-labelledby="automation-heading"
    >
      <h2 id="automation-heading">Due-soon automation</h2>
      <p>
        Two workspace calendar days before an issue is due, notify its current
        assignee and move eligible open work into its team’s active open cycle.
        Existing closed-cycle history stays intact.
      </p>
      <p>
        Runs once for each issue and due date. Notifications respect Inbox
        mutes. Fixed due-today and overdue reminders continue independently.
      </p>
      {resource.error && (
        <p role="alert">
          {resource.error.message}{" "}
          <button onClick={resource.reload}>Retry automation</button>
        </p>
      )}
      {resource.loading && <p role="status">Loading automation…</p>}
      {resource.data && (
        <>
          <DueRuleForm
            key={resource.data.rule?.version ?? 0}
            rule={resource.data.rule}
            reload={resource.reload}
          />
          <h3>Recent runs</h3>
          <p>
            Only work you can currently access appears here. A missing active
            cycle leaves both actions pending; the rule retries during the same
            calendar day.
          </p>
          {resource.data.runs.length ? (
            <ul className="due-rule-runs">
              {resource.data.runs.map((run) => (
                <li key={run.id}>
                  <a href={"/app/issues/" + run.identifier}>{run.identifier}</a>{" "}
                  · Due {run.dueDate} ·{" "}
                  {run.outcome === "succeeded" ? "Succeeded" : "Failed"}
                  {run.reason
                    ? " · " + run.reason
                    : run.cycleName
                      ? " · " + run.cycleName
                      : ""}
                  {run.outcome === "succeeded" &&
                    (run.notified
                      ? " · Assignee notified"
                      : " · Notification muted")}
                  {run.outcome === "succeeded" &&
                    run.failureReason &&
                    run.failedAt && (
                      <span>
                        {" "}
                        · Recovered after {run.failureReason} at{" "}
                        <time dateTime={run.failedAt}>{utc(run.failedAt)}</time>
                      </span>
                    )}
                  {" · "}
                  <time dateTime={run.at}>{utc(run.at)}</time>
                </li>
              ))}
            </ul>
          ) : (
            <p>No runs yet.</p>
          )}
        </>
      )}
    </section>
  );
}
function DueRuleForm({
  rule,
  reload,
}: {
  rule: DueRule | null;
  reload: () => void;
}) {
  const [name, setName] = useState(rule?.name ?? "Due in two days");
  const [enabled, setEnabled] = useState(rule?.enabled ?? false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await fetchJson("/api/settings/automation/due-soon", dueRulesSchema, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          enabled,
          expectedVersion: rule?.version ?? 0,
        }),
      });
      reload();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The rule could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form aria-label="Due-soon rule" onSubmit={save}>
      <fieldset disabled={busy}>
        <legend>{rule ? "Workspace rule" : "Create workspace rule"}</legend>
        <label>
          Rule name
          <input
            value={name}
            required
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="admin-checkbox">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Enable due-soon rule
        </label>
        <p>
          Owner:{" "}
          {rule ? (rule.ownerName ?? "No current owner") : "You, when saved"}.
          Saving assigns responsibility to you. Rules pause if their owner loses
          workspace rule authority.
        </p>
        {rule?.enabled && !rule.ownerActive && (
          <p role="status">
            Paused: its owner no longer has workspace rule authority. Save the
            rule to take responsibility and resume it.
          </p>
        )}
        <button type="submit">
          {rule ? "Save due-soon rule" : "Create due-soon rule"}
        </button>
      </fieldset>
      {message && <p role="alert">{message}</p>}
    </form>
  );
}
