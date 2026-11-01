import { useDateFormat } from "../../../shared/date-format";
import { WorkloadPanel } from '../../workload/panel';
import { CycleReportPanel } from "../../cycle-report/panel";
import { ClosureSnapshot } from "./closure-snapshot";
import { remainingScopeCopy, capacityRiskCopy } from "./capacity-copy";
import { canSelectCycle } from "./commitment-choices";
import { CommitIssueForm } from "./commit-issue-form";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { fetchJson, useApiResource } from "../../../app/api-client";
import {
  administrationSchema,
  cycleDetailSchema,
  type CycleDetail,
} from "../../administration/schema";
import { issueDetailSchema } from "../../issues/ui/data";
import "../../settings/ui/settings.css";
import "./cycles.css";
export function CycleDetailPage({ cycleId }: { cycleId: string }) {
  const { range, zone } = useDateFormat();
  const detail = useApiResource(`/api/cycles/${cycleId}`, cycleDetailSchema);
  const administration = useApiResource(
    "/api/metadata",
    administrationSchema,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function change(
    identifier: string,
    cycle: string | null,
    version?: number,
  ) {
    if (pending) return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const expectedVersion =
        version ??
        (
          await fetchJson(
            `/api/issues/${encodeURIComponent(identifier)}`,
            issueDetailSchema,
          )
        ).version;
      await fetchJson(
        `/api/issues/${encodeURIComponent(identifier)}`,
        issueDetailSchema,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedVersion, cycleId: cycle }),
        },
      );
      setMessage("Cycle commitment saved.");
      detail.reload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Commitment could not be saved.",
      );
      detail.reload();
    } finally {
      setPending(false);
    }
  }
  if (!detail.data)
    return (
      <main className="settings-page">
        {detail.error ? (
          <p role="alert">
            {detail.error.message}
            <button onClick={detail.reload}>Retry cycle</button>
          </p>
        ) : (
          <p role="status">Loading cycle…</p>
        )}
      </main>
    );
  const { cycle, progress } = detail.data;
  const cyclesEnabled = administration.data?.teams.some(team => team.id === cycle.teamId && team.cyclesEnabled) === true;
  const choices =
    administration.data?.cycles.filter(
      (item) => item.teamId === cycle.teamId && !item.closedAt,
    ) ?? [];
  return (
    <main
      className="settings-page administration-panel"
      aria-labelledby="cycle-title"
    >
      <Link className="admin-link" to="/app/cycles">
        ← Cycles
      </Link>
      <header>
        <h1 id="cycle-title">{cycle.name}</h1>
        <p>
          {
            administration.data?.teams.find((team) => team.id === cycle.teamId)
              ?.name
          }{" "}
          · {zone}
        </p>
        <p>
          {range(cycle.startsAt, cycle.endsAt)}
        </p>
      </header>
      <section aria-label="Cycle progress">
        <h2>Progress</h2>
        <p>
          {progress.percentage === null
            ? "No committed work."
            : `${progress.completed} / ${progress.total} ${progress.unit === "points" ? "points" : "by issue count"} completed · ${progress.percentage}%`}
        </p>
        <p>
          {progress.capacity === null
            ? "No capacity set."
            : `Capacity: ${progress.capacity} points.`}{" "}
          {remainingScopeCopy(
            progress.remainingPoints,
            progress.unestimatedRemaining,
          )}
        </p>
        <p>Capacity check: {capacityRiskCopy(progress.capacityRisk)}</p>
        {cyclesEnabled && !cycle.closedAt && (
          <p>
            This cycle closes automatically after its end. Unstarted and Started
            work rolls into the next cycle.
          </p>
        )}
      </section>
      <WorkloadPanel cycleId={cycleId} />
      <CycleReportPanel report={detail.data.report} closed={!!cycle.closedAt && !!detail.data.snapshot} rolloverFailed={!!detail.data.failure} />
      {detail.data.failure && (
        <section
          className="cycle-closure-failure"
          aria-label="Failed cycle operation"
        >
          <h2>Rollover could not be completed</h2>
          <p>
            No next cycle existed at close. These unfinished issues were
            uncommitted: {detail.data.failure.identifiers.join(", ")}.
          </p>
          <p>
            Creating a later cycle does not move them. Review and commit them
            explicitly.
          </p>
        </section>
      )}
      {detail.data.snapshot && (
        <ClosureSnapshot snapshot={detail.data.snapshot} />
      )}
      {cycle.closedAt && !detail.data.snapshot && (
        <p>No visible closure snapshot is available for this closed cycle.</p>
      )}
      {cyclesEnabled && !cycle.closedAt && (
        <section aria-labelledby="committed-issues-heading">
          <h2 id="committed-issues-heading">Committed issues</h2>
          {detail.error && (
            <p role="alert">
              {detail.error.message}{" "}
              <button onClick={detail.reload}>Reload commitments</button>
            </p>
          )}
          {administration.error && (
            <p role="alert">
              {administration.error.message}{" "}
              <button onClick={administration.reload}>
                Reload cycle choices
              </button>
            </p>
          )}
          {!administration.data && !administration.error && (
            <p role="status">Loading issue choices…</p>
          )}
          {administration.data && (
            <CommitIssueForm
              teamId={cycle.teamId}
              teamArchived={
                !!administration.data?.teams.find(
                  (team) => team.id === cycle.teamId,
                )?.archivedAt
              }
              pending={pending}
              commit={(identifier) => change(identifier, cycleId)}
            />
          )}
          {pending && <p role="status">Saving commitment…</p>}
          {error && <p role="alert">{error}</p>}
          {message && <p role="status">{message}</p>}
          {detail.data.issues.length === 0 && (
            <p>No issues are committed to this cycle.</p>
          )}
          {detail.data.issues.map((issue) => (
            <CycleIssue
              key={issue.id}
              issue={issue}
              choices={choices}
              disabled={pending || !administration.data}
              change={change}
            />
          ))}
        </section>
      )}
    </main>
  );
}
function CycleIssue({
  issue,
  choices,
  disabled,
  change,
}: {
  issue: CycleDetail["issues"][number];
  choices: Array<{ id: string; name: string }>;
  disabled: boolean;
  change: (
    identifier: string,
    cycle: string | null,
    version?: number,
  ) => Promise<void>;
}) {
  return (
    <div
      className="admin-record"
      role="group"
      aria-label={`Cycle issue ${issue.identifier}`}
    >
      <Link
        to="/app/issues/$identifier"
        params={{ identifier: issue.identifier }}
      >
        {issue.identifier} · {issue.title}
      </Link>
      <p>
        {issue.category} ·{" "}
        {issue.estimate === null ? "Unestimated" : `${issue.estimate} points`}
      </p>
      <label>
        Cycle commitment for {issue.identifier}
        <select
          value={issue.cycleId}
          disabled={disabled}
          onChange={(event) =>
            void change(
              issue.identifier,
              event.target.value || null,
              issue.version,
            )
          }
        >
          <option value="">No cycle</option>
          {!choices.some((cycle) => cycle.id === issue.cycleId) && (
            <option value={issue.cycleId}>Current cycle</option>
          )}
          {choices.map((cycle) => (
            <option
              key={cycle.id}
              value={cycle.id}
              disabled={
                !canSelectCycle(issue.category, issue.cycleId, cycle.id)
              }
            >
              {cycle.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
