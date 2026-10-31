import { useViewerTime } from '../../../app/viewer-time';
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useHydrated } from "../../../app/initial-resources";
import { ApiError, fetchJson } from "../../../app/api-client";
import type { StreamOptions } from "../../streams/ui/data";
import { issueDetailSchema, type IssueDetailData } from "./data";

import { intakeRecommendation } from "./intake-recommendation";

type DecisionPanelProps = {
  issue: IssueDetailData;
  options: StreamOptions | null;
  optionsError: Error | null;
  onRefresh: () => void;
};

type DecisionKind = "accept" | "defer" | "decline" | "return";

export function DecisionPanel({
  issue,
  options,
  optionsError,
  onRefresh,
}: DecisionPanelProps) {
  const { futureInstant, effectiveTimezone } = useViewerTime();
  const hydrated = useHydrated();
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const panel = panelRef.current;
    const inspector = panel?.closest<HTMLElement>(".issue-inspector");
    if (!panel || !inspector) return;
    const observer = new ResizeObserver(() => {
      const height = `${panel.getBoundingClientRect().height}px`;
      inspector.style.setProperty("--decision-sheet-height", height);
      document.documentElement.style.setProperty(
        "--decision-sheet-height",
        height,
      );
    });
    observer.observe(panel);
    return () => {
      observer.disconnect();
      inspector.style.removeProperty("--decision-sheet-height");
      document.documentElement.style.removeProperty("--decision-sheet-height");
    };
  }, []);
  const [routingExpanded, setRoutingExpanded] = useState(false);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let previousScroll = window.scrollY;
    const onScroll = () => {
      const currentScroll = window.scrollY;
      if (!window.matchMedia("(max-width: 46rem)").matches) return;
      if (currentScroll < 40) {
        setCompact(false);
        previousScroll = currentScroll;
      } else if (currentScroll > 80 && currentScroll - previousScroll > 24) {
        const active = document.activeElement;
        if (!(
          active instanceof HTMLElement &&
          active.matches("input, select, textarea") &&
          panelRef.current?.contains(active)
        )) {
          setCompact(true);
          setRoutingExpanded(false);
        }
        previousScroll = currentScroll;
      } else if (currentScroll < previousScroll) previousScroll = currentScroll;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const [selectedKind, setKind] = useState<DecisionKind>("accept");
  const kind =
    selectedKind === "return" && !issue.deferredUntil ? "accept" : selectedKind;
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const recommendation = intakeRecommendation(issue, options);
  const [accept, setAccept] = useState<{
    assigneeOperatorId: string;
    priority: string;
    statusId: string;
    cycleId: string;
    reason: string;
  }>({ ...recommendation, reason: "" });
  const [edited, setEdited] = useState(false);
  const routing = edited ? accept : recommendation;
  useEffect(() => {
    if (!edited)
      setAccept({ ...intakeRecommendation(issue, options), reason: "" });
  }, [issue, options, edited]);
  const [defer, setDefer] = useState({ returnAt: "", reason: "" });
  const [declineReason, setDeclineReason] = useState("");
  if (issue.status.category !== "intake") return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    const path = kind;
    let body: Record<string, unknown> = { expectedVersion: issue.version };
    if (kind === "accept") {
      body = {
        ...body,
        assigneeOperatorId: accept.assigneeOperatorId || null,
        priority: accept.priority,
        cycleId: accept.cycleId || null,
        reason: accept.reason || undefined,
        ...(accept.statusId ? { statusId: accept.statusId } : {}),
      };
    }
    if (kind === "defer") {
      try {
        body = {...body, returnAt: futureInstant(defer.returnAt), reason: defer.reason || undefined};
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Choose a future return time.');
        return;
      }
    }
    if (kind === "decline") body = { ...body, reason: declineReason };
    setSubmitting(true);
    try {
      await fetchJson(
        `/api/issues/${issue.identifier}/${path}`,
        issueDetailSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (kind === "defer") {
        setKind("accept");
        setRoutingExpanded(false);
        setDefer({ returnAt: "", reason: "" });
      }
      setMessage(
        `${kind === "accept" ? "Accepted" : kind === "defer" ? "Deferred" : kind === "return" ? "Returned for decision" : "Declined"} and refreshed from the workspace.`,
      );
      onRefresh();
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        typeof error.body === "object" &&
        error.body !== null &&
        "error" in error.body &&
        error.body.error === "stale_version"
      ) {
        setMessage(
          "This issue changed elsewhere. The current version has been loaded; review it before submitting again.",
        );
        onRefresh();
      } else {
        setMessage(
          error instanceof Error
            ? error.message
            : "The decision could not be saved.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const teamStatuses =
    options?.statuses.filter(
      (status) =>
        status.teamId === issue.team.id &&
        ["started", "unstarted"].includes(status.category),
    ) ?? [];
  const teamCycles =
    options?.cycles.filter((cycle) => cycle.teamId === issue.team.id) ?? [];
  return (
    <section
      ref={panelRef}
      className={`decision-panel${routingExpanded ? " is-routing-expanded" : ""}${compact && kind === "accept" ? " is-compact" : ""}`}
      aria-labelledby="decision-heading"
    >
      <div className="decision-heading">
        <div>
          <h2 id="decision-heading">Make the triage call</h2>
        </div>
      </div>
      <div
        className="decision-tabs"
        role="tablist"
        aria-label="Intake decisions"
      >
        {(
          [
            "accept",
            "defer",
            "decline",
            ...(issue.deferredUntil ? ["return" as const] : []),
          ] as const
        ).map((item) => (
          <button
            type="button"
            key={item}
            role="tab"
            aria-selected={kind === item}
            className={kind === item ? "is-active" : ""}
            disabled={submitting || !hydrated}
            onClick={() => setKind(item)}
          >
            {item === "return"
              ? "End deferral"
              : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>
      {optionsError ? (
        <p className="form-message form-message--error" role="alert">
          Available assignees and workflow choices could not be loaded:{" "}
          {optionsError.message}
        </p>
      ) : null}
      {kind === "accept" ? (
        <div className="decision-mobile-summary">
          {options ? (
            <p>
              Suggested routing:{" "}
              {routing.assigneeOperatorId ? "assign " : "leave "}
              {options.operators.find(
                (operator) => operator.id === routing.assigneeOperatorId,
              )?.name ?? "unassigned"}
              ,{" "}
              {routing.priority === "none"
                ? "no priority"
                : `${routing.priority} priority`}
              , start{" "}
              {options.statuses.find((status) => status.id === routing.statusId)
                ?.name ?? "Unstarted"}
            </p>
          ) : optionsError ? null : (
            // The recommendation needs workspace options; never show a guess.
            <p role="status">Loading suggested routing…</p>
          )}
          <button
            type="button"
            aria-expanded={routingExpanded}
            disabled={!hydrated}
            aria-label={
              routingExpanded
                ? "Close routing and reason"
                : "Adjust routing and reason"
            }
            onClick={() => {
              setRoutingExpanded(!routingExpanded);
              setCompact(false);
            }}
          >
            {routingExpanded
              ? "Close routing and reason"
              : compact
                ? "Routing"
                : "Adjust routing and reason"}
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="decision-expand"
        onClick={() => setCompact(false)}
        aria-label="Show all decisions"
      >
        Decisions
      </button>
      <form onSubmit={submit} className="decision-form">
        <fieldset
          className="decision-controls"
          disabled={!hydrated || submitting || (kind === "accept" && options === null)}
        >
          <div className="decision-fields">
            {kind === "accept" ? (
              <div className="decision-routing">
                <label>
                  <span>
                    Assignee{" "}
                    {recommendation.recommended.assignee &&
                    accept.assigneeOperatorId ===
                      recommendation.assigneeOperatorId ? (
                      <small
                        className="recommended-label"
                        id={`recommended-assignee-${issue.identifier}`}
                      >
                        Recommended
                      </small>
                    ) : null}
                  </span>
                  <select
                    aria-label="Assignee"
                    aria-describedby={
                      recommendation.recommended.assignee &&
                      accept.assigneeOperatorId ===
                        recommendation.assigneeOperatorId
                        ? `recommended-assignee-${issue.identifier}`
                        : undefined
                    }
                    value={accept.assigneeOperatorId}
                    disabled={options === null}
                    onChange={(event) => {
                      setEdited(true);
                      setAccept({
                        ...accept,
                        assigneeOperatorId: event.target.value,
                      });
                    }}
                  >
                    <option value="">Unassigned</option>
                    {options?.operators.map((operator) => (
                      <option key={operator.id} value={operator.id}>
                        {operator.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>
                    Priority{" "}
                    {recommendation.recommended.priority &&
                    accept.priority === recommendation.priority ? (
                      <small
                        className="recommended-label"
                        id={`recommended-priority-${issue.identifier}`}
                      >
                        Recommended
                      </small>
                    ) : null}
                  </span>
                  <select
                    aria-label="Priority"
                    aria-describedby={
                      recommendation.recommended.priority &&
                      accept.priority === recommendation.priority
                        ? `recommended-priority-${issue.identifier}`
                        : undefined
                    }
                    value={accept.priority}
                    onChange={(event) => {
                      setEdited(true);
                      setAccept({ ...accept, priority: event.target.value });
                    }}
                  >
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="none">No priority</option>
                  </select>
                </label>
                <label>
                  <span>
                    Start status{" "}
                    {recommendation.recommended.status &&
                    accept.statusId === recommendation.statusId ? (
                      <small
                        className="recommended-label"
                        id={`recommended-status-${issue.identifier}`}
                      >
                        Recommended
                      </small>
                    ) : null}
                  </span>
                  <select
                    aria-label="Start status"
                    aria-describedby={
                      recommendation.recommended.status &&
                      accept.statusId === recommendation.statusId
                        ? `recommended-status-${issue.identifier}`
                        : undefined
                    }
                    value={accept.statusId}
                    disabled={options === null}
                    onChange={(event) => {
                      setEdited(true);
                      setAccept({ ...accept, statusId: event.target.value });
                    }}
                  >
                    <option value="">Default</option>
                    {teamStatuses.map((status) => (
                      <option key={status.id} value={status.id}>
                        {status.name}
                      </option>
                    ))}
                  </select>
                </label>
                {options?.teams.find(team => team.id === issue.team.id)?.cyclesEnabled && <label>
                  <span>
                    Cycle{" "}
                    {recommendation.recommended.cycle &&
                    accept.cycleId === recommendation.cycleId ? (
                      <small
                        className="recommended-label"
                        id={`recommended-cycle-${issue.identifier}`}
                      >
                        Recommended
                      </small>
                    ) : null}
                  </span>
                  <select
                    aria-label="Cycle"
                    aria-describedby={
                      recommendation.recommended.cycle &&
                      accept.cycleId === recommendation.cycleId
                        ? `recommended-cycle-${issue.identifier}`
                        : undefined
                    }
                    value={accept.cycleId}
                    disabled={options === null}
                    onChange={(event) => {
                      setEdited(true);
                      setAccept({ ...accept, cycleId: event.target.value });
                    }}
                  >
                    <option value="">No cycle</option>
                    {teamCycles.map((cycle) => (
                      <option key={cycle.id} value={cycle.id}>
                        {cycle.name}
                      </option>
                    ))}
                  </select>
                </label>}
                <label className="decision-form__wide">
                  Reason <span>(optional)</span>
                  <textarea
                    value={accept.reason}
                    onChange={(event) => {
                      setEdited(true);
                      setAccept({ ...accept, reason: event.target.value });
                    }}
                    rows={2}
                  />
                </label>
              </div>
            ) : null}
            {kind === "defer" ? (
              <>
                <label className="decision-form__wide">
                  Return for decision ({effectiveTimezone})
                  <input
                    type="datetime-local"
                    required
                    value={defer.returnAt}
                    onChange={(event) =>
                      setDefer({ ...defer, returnAt: event.target.value })
                    }
                  />
                </label>
                <label className="decision-form__wide">
                  Reason <span>(optional)</span>
                  <textarea
                    value={defer.reason}
                    onChange={(event) =>
                      setDefer({ ...defer, reason: event.target.value })
                    }
                    rows={3}
                  />
                </label>
              </>
            ) : null}
            {kind === "return" ? (
              <p className="decision-form__wide">
                Return this issue to Needs decision now. Its earlier deferral
                remains in triage history.
              </p>
            ) : null}
            {kind === "decline" ? (
              <label className="decision-form__wide">
                Reason <span>(required)</span>
                <textarea
                  required
                  value={declineReason}
                  onChange={(event) => setDeclineReason(event.target.value)}
                  rows={3}
                />
              </label>
            ) : null}
          </div>
          <div className="decision-actions">
            <button
              className={`decision-submit decision-submit--${kind}`}
              type="submit"
              disabled={!hydrated || submitting || (kind === "accept" && options === null)}
            >
              {submitting
                ? "Saving…"
                : kind === "accept"
                  ? "Accept and route work"
                  : kind === "defer"
                    ? "Defer decision"
                    : kind === "return"
                      ? "End deferral now"
                      : "Decline issue"}
            </button>
          </div>
        </fieldset>
      </form>
      {message ? (
        <p className="form-message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
