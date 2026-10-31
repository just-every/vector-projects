import { useEffect, useState, type FormEvent } from "react";
import { fetchJson, useApiResource } from "../../app/api-client";
import { useHydrated } from "../../app/initial-resources";
import type { Administration } from "../administration/schema";
import { rotationView } from "./schema";
export function TeamTriageRotation({
  data,
  team,
}: {
  data: Administration;
  team: Administration["teams"][number];
}) {
  const path = `/api/settings/teams/${team.id}/triage-rotation`,
    resource = useApiResource(path, rotationView, undefined, {
      abortPendingOnDispose: false,
    });
  const hydrated = useHydrated();
  const [order, setOrder] = useState<string[]>(["", ""]),
    [mode, setMode] = useState<"fixed" | "weekly">("weekly"),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const ids = JSON.stringify(resource.data?.operatorIds ?? []);
  useEffect(() => {
    const current = JSON.parse(ids) as (string | null)[];
    setOrder(current.length ? current.map((id) => id ?? "") : ["", ""]);
    setMode(current.length === 1 ? "fixed" : "weekly");
  }, [ids]);
  const people = data.operators.filter(
    (o) =>
      !["guest", "viewer"].includes(o.role) &&
      team.members.some((m) => m.operatorId === o.id),
  );
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const fields = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    setSaved(false);
    try {
      const receipt = await fetchJson(path, rotationView, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startsLocal: fields.get("startsLocal"),
          operatorIds: mode === "fixed" ? order.slice(0, 1) : order,
        }),
      });
      resource.publishReceipt(() => receipt);
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The rotation could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section aria-label={`Triage rotation for ${team.name}`}>
      <h3>Triage responsibility</h3>
      <p>
        Choose a fixed person or a weekly rotation in {data.workspace.timezone}.
        Each new intake item notifies its current responsible member once in
        Inbox, except its actor. Unavailable members receive nothing.
      </p>
      {resource.loading && <p role="status">Loading rotation…</p>}
      {resource.error && (
        <p role="alert">
          {resource.error.message}{" "}
          <button type="button" onClick={resource.reload}>
            Retry rotation
          </button>
        </p>
      )}
      {resource.data && (
        <form
          aria-label={`Triage responsibility for ${team.name}`}
          onSubmit={save}
        >
          <fieldset disabled={pending || !hydrated}>
            <label>
              Responsibility mode
              <select
                aria-label="Responsibility mode"
                value={mode}
                onChange={(event) => {
                  const next = event.target.value as "fixed" | "weekly";
                  setMode(next);
                  if (next === "weekly")
                    setOrder((values) =>
                      values.length < 2 ? [...values, ""] : values,
                    );
                }}
              >
                <option value="fixed">Fixed person</option>
                <option value="weekly">Weekly rotation</option>
              </select>
            </label>
            <label>
              {mode === "fixed" ? "Responsibility starts" : "First handover"} in{" "}
              {data.workspace.timezone}
              <input
                name="startsLocal"
                type="datetime-local"
                required
                key={resource.data.startsLocal ?? "new"}
                defaultValue={resource.data.startsLocal ?? ""}
              />
            </label>
            {mode === "weekly" && (
              <p>
                The first member starts at this boundary. Subsequent members
                take one calendar week each. A repeated or skipped clock minute
                hands over at the next unambiguous minute.
              </p>
            )}
            <ol>
              {(mode === "fixed" ? order.slice(0, 1) : order).map(
                (id, index) => (
                  <li key={index}>
                    <label>
                      {mode === "fixed"
                        ? "Responsible member"
                        : `Rotation member ${index + 1}`}
                      <select
                        aria-label={
                          mode === "fixed"
                            ? "Responsible member"
                            : `Rotation member ${index + 1}`
                        }
                        required
                        value={id}
                        onChange={(event) =>
                          setOrder((values) =>
                            values.map((value, i) =>
                              i === index ? event.target.value : value,
                            ),
                          )
                        }
                      >
                        <option value="">Choose a team member</option>
                        {people.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {mode === "weekly" && (
                      <div className="admin-actions">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() =>
                            setOrder((values) => {
                              const next = [...values];
                              [next[index - 1], next[index]] = [
                                next[index],
                                next[index - 1],
                              ];
                              return next;
                            })
                          }
                        >
                          Move member {index + 1} up
                        </button>
                        <button
                          type="button"
                          disabled={index === order.length - 1}
                          onClick={() =>
                            setOrder((values) => {
                              const next = [...values];
                              [next[index + 1], next[index]] = [
                                next[index],
                                next[index + 1],
                              ];
                              return next;
                            })
                          }
                        >
                          Move member {index + 1} down
                        </button>
                        <button
                          type="button"
                          disabled={order.length <= 2}
                          onClick={() =>
                            setOrder((values) =>
                              values.filter((_, i) => i !== index),
                            )
                          }
                        >
                          Remove member {index + 1}
                        </button>
                      </div>
                    )}
                  </li>
                ),
              )}
            </ol>
            {mode === "weekly" && (
              <button
                type="button"
                disabled={order.length >= 50}
                onClick={() => setOrder((values) => [...values, ""])}
              >
                Add rotation member
              </button>
            )}
            <button type="submit">Save triage responsibility</button>
          </fieldset>
        </form>
      )}
      {resource.data?.startsLocal && (
        <p>
          Current responsible member:{" "}
          {resource.data.responsible?.name ?? "No available member"}.{" "}
          <a href="/app/triage">Open triage handover</a>
        </p>
      )}
      {saved && <p role="status">Triage responsibility saved.</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
