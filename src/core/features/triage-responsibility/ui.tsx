import { createContext, useContext, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useApiResource } from "../../app/api-client";
import { triageView } from "./schema";
import type { RotationView } from "./schema";
import { useViewerTime } from "../../app/viewer-time";
import "../notifications/ui/notifications.css";
import "./triage.css";
const Context = createContext<ReturnType<
  typeof useApiResource<typeof triageView>
> | null>(null);
export function TriageProvider({ children }: { children: ReactNode }) {
  const resource = useApiResource(
    "/api/triage-responsibility",
    triageView,
    undefined,
    { abortPendingOnDispose: false },
  );
  return <Context.Provider value={resource}>{children}</Context.Provider>;
}
function useTriage() {
  const resource = useContext(Context);
  if (!resource) throw new Error("Triage provider is required.");
  return resource;
}
export function TriageCount() {
  const resource = useTriage();
  return resource.data && resource.data.count > 0 ? (
    <span
      className="inbox-count"
      aria-label={`${resource.data.count} untouched triage items`}
    >
      {resource.data.count}
    </span>
  ) : null;
}
export function TriagePage() {
  const resource = useTriage();
  return (
    <main className="inbox-page triage-page">
      <header>
        <div>
          <p className="settings-eyebrow">Team handover</p>
          <h1>Triage</h1>
          <p>
            Untouched intake stays with the team when responsibility changes.
          </p>
        </div>
      </header>
      {resource.loading && <p role="status">Loading triage…</p>}
      {resource.error && (
        <p role="alert">
          {resource.error.message}{" "}
          <button type="button" onClick={resource.reload}>
            Retry triage
          </button>
        </p>
      )}
      {resource.data?.teams.length === 0 && (
        <p>
          No triage responsibility is configured for your visible teams.
          Configure responsibility in Settings → Teams.
        </p>
      )}
      {resource.data?.teams.map((team) => (
        <TeamHandover key={team.teamId} team={team} />
      ))}
    </main>
  );
}
function TeamHandover({ team }: { team: RotationView }) {
  const { formatInstant } = useViewerTime();
  return (
    <section className="triage-team" aria-label={`${team.teamName} triage`}>
      <h2>{team.teamName}</h2>
      <p>
        <strong>
          Responsible: {team.responsible?.name ?? "No available member"}
        </strong>
      </p>
      {team.mode === "fixed" && (
        <p>Fixed responsibility. No scheduled handover.</p>
      )}
      {team.nextHandoverAt && (
        <p>
          Next handover:{" "}
          <time dateTime={team.nextHandoverAt}>
            {formatInstant(team.nextHandoverAt)}
          </time>
          . Rotation follows {team.timezone}.
        </p>
      )}
      <h3>{team.untouched.length} untouched items</h3>
      {team.untouched.length ? (
        <ul className="triage-items">
          {team.untouched.map((item) => (
            <li key={item.identifier}>
              <Link
                to="/app/issues/$identifier"
                params={{ identifier: item.identifier }}
              >
                <span>{item.identifier}</span> {item.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>No untouched intake.</p>
      )}
    </section>
  );
}
