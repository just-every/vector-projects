import { BooleanFilters } from "./boolean-filters";
import { useState, useEffect } from "react";
import type { IssueListQuery } from "../list-schema";
import type { WorkspaceOptions } from "../../../shared/workspace-options";
import { defaultIssueListQuery } from "./issue-list-controls";

export function IssueFilters({
  query,
  options,
  onChange,
  onReset,
  fixedGrouping = false,
}: {
  query: IssueListQuery;
  options: WorkspaceOptions | null;
  onChange: (change: Partial<IssueListQuery>) => void;
  onReset: () => void;
  fixedGrouping?: boolean;
}) {
  function choice(
    key: keyof IssueListQuery,
    label: string,
    values: Array<{ id: string; name: string }>,
    empty = "All",
    none?: string,
  ) {
    return (
      <label key={key}>
        {label}
        <select
          aria-label={label}
          value={String(query[key])}
          onChange={(e) => onChange({ [key]: e.target.value })}
        >
          {!(fixedGrouping && key === "team") && <option value="all">{empty}</option>}
          {none && (
            <option value={key === "assignee" ? "unassigned" : "none"}>
              {none}
            </option>
          )}
          {values.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
          {query[key] !== "all" &&
            query[key] !== "none" &&
            query[key] !== "unassigned" &&
            !values.some((v) => v.id === query[key]) && (
              <option value={String(query[key])}>
                Selected value unavailable
              </option>
            )}
        </select>
      </label>
    );
  }
  const [parentDraft, setParentDraft] = useState(
    query.parent === "all" || query.parent === "none" ? "" : query.parent,
  );
  const [parentError, setParentError] = useState("");
  const [parentMode, setParentMode] = useState(
    query.parent === "all" || query.parent === "none"
      ? query.parent
      : "identifier",
  );
  useEffect(() => {
    setParentMode(
      query.parent === "all" || query.parent === "none"
        ? query.parent
        : "identifier",
    );
    setParentDraft(
      query.parent === "all" || query.parent === "none" ? "" : query.parent,
    );
    setParentError("");
  }, [query.parent]);
  const teams = options?.teams ?? [];
  const statuses =
    options?.statuses.filter(
      (s) => query.team === "all" || s.teamId === query.team,
    ) ?? [];
  return (
    <>
      <BooleanFilters value={query.expression} onChange={expression => onChange({ expression })}/>
      <div className="issues-filters">
        <label>
          Title or identifier
          <input
            type="search"
            maxLength={200}
            value={query.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder="Search issues"
          />
        </label>
        {choice(
          "category",
          "Status category",
          [
            "intake",
            "backlog",
            "unstarted",
            "started",
            "completed",
            "canceled",
            "duplicate",
          ].map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1) })),
          // A personal scope (WORK-004) lists completed issues too.
          query.scope === "all" ? "All except completed" : "All",
        )}
        {choice("status", "Status", statuses)}
        {choice(
          "priority",
          "Priority",
          ["urgent", "high", "medium", "low", "none"].map((id) => ({
            id,
            name:
              id === "none" ? "No priority" : id[0].toUpperCase() + id.slice(1),
          })),
        )}
        {choice(
          "assignee",
          "Assignee",
          options?.operators ?? [],
          "Anyone",
          "Unassigned",
        )}
        {choice("team", "Team", teams)}
        {choice(
          "project",
          "Project",
          options?.projects ?? [],
          "All",
          "No project",
        )}
        {choice(
          "cycle",
          "Cycle",
          options?.cycles.filter(
            (c) => query.team === "all" || c.teamId === query.team,
          ) ?? [],
          "All",
          "No cycle",
        )}
        {choice("label", "Label", options?.labels ?? [], "All", "No labels")}
        {choice("start", "Start date", [
          { id: "this_week", name: "Starts this week" },
          { id: "overdue", name: "Before today" },
          { id: "range", name: "Date range" },
          { id: "none", name: "No start date" },
        ])}
        {query.start === "range" && <>
          <label>Start from<input type="date" value={query.startFrom} onChange={e => onChange({ startFrom: e.target.value, ...(query.startTo && e.target.value > query.startTo ? {startTo: e.target.value} : {}) })}/></label>
          <label>Start to<input type="date" value={query.startTo} onChange={e => onChange({ startTo: e.target.value, ...(query.startFrom && e.target.value && e.target.value < query.startFrom ? {startFrom: e.target.value} : {}) })}/></label>
        </>}
        {choice("due", "Due date", [
          { id: "overdue", name: "Overdue" },
          { id: "range", name: "Date range" },
          { id: "none", name: "No due date" },
        ])}
        {query.due === "range" && (
          <>
            <label>
              Due from
              <input
                type="date"
                value={query.dueFrom}
                onChange={(e) =>
                  onChange({
                    dueFrom: e.target.value,
                    ...(query.dueTo && e.target.value > query.dueTo
                      ? { dueTo: e.target.value }
                      : {}),
                  })
                }
              />
            </label>
            <label>
              Due to
              <input
                type="date"
                value={query.dueTo}
                onChange={(e) =>
                  onChange({
                    dueTo: e.target.value,
                    ...(query.dueFrom &&
                    e.target.value &&
                    e.target.value < query.dueFrom
                      ? { dueFrom: e.target.value }
                      : {}),
                  })
                }
              />
            </label>
          </>
        )}
        {choice("blocked", "Blocked state", [
          { id: "blocked", name: "Blocked" },
          { id: "unblocked", name: "Unblocked" },
        ])}
        <div className="issue-parent-filter">
          <label>
            Parent
            <select
              aria-label="Parent"
              value={parentMode}
              onChange={(e) => {
                setParentMode(e.target.value);
                if (e.target.value !== "identifier")
                  onChange({ parent: e.target.value });
              }}
            >
              <option value="all">All</option>
              <option value="none">No parent</option>
              <option value="identifier">Specific parent</option>
            </select>
          </label>
          {parentMode === "identifier" && (
            <>
              <input
                aria-label="Parent identifier"
                placeholder="Parent identifier"
                value={parentDraft}
                onChange={(e) => setParentDraft(e.target.value.toUpperCase())}
              />
              <button
                onClick={() => {
                  if (/^[A-Z]{2,10}-[1-9][0-9]*$/.test(parentDraft)) {
                    setParentError("");
                    onChange({ parent: parentDraft });
                  } else
                    setParentError(
                      "Enter a valid parent identifier, such as ENG-1.",
                    );
                }}
              >
                Apply parent
              </button>
              {parentError && <small role="status">{parentError}</small>}
            </>
          )}
        </div>
        <label>
          Sort
          <select
            aria-label="Sort"
            value={query.sort}
            onChange={(e) =>
              onChange({ sort: e.target.value as IssueListQuery["sort"] })
            }
          >
            {[
              ["newest", "Newest"],
              ["oldest", "Oldest"],
              ["priority", "Urgent to no priority"],
              ["status", "Workflow order"],
              ["start", "Start date"],
              ["due", "Due date"],
              ["updated", "Last update"],
              ["manual", "Manual order"],
            ].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Group by
          <select
            aria-label="Group by"
            disabled={fixedGrouping}
            value={query.grouping}
            onChange={(e) =>
              onChange({
                grouping: e.target.value as IssueListQuery["grouping"],
              })
            }
          >
            {[
              "none",
              "status",
              "assignee",
              "priority",
              "project",
              "cycle",
              "milestone",
              "parent",
              "team",
            ].map((id) => (
              <option key={id} value={id}>
                {id === "milestone" ? "Project milestone" : id === "parent" ? "Parent issue" : id[0].toUpperCase() + id.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button className="issues-reset" onClick={onReset}>
        Reset controls
      </button>
      {query.category === defaultIssueListQuery.category &&
        query.status === "all" && query.scope === "all" && (
          <p className="issues-hint">
            Completed issues are hidden; choose Completed to browse them.
          </p>
        )}
    </>
  );
}
