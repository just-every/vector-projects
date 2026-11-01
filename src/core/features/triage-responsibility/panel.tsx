import { useEffect, useState, type FormEvent } from "react";
import { fetchJson, useApiResource } from "../../app/api-client";
import { useHydrated } from "../../app/initial-resources";
import type { Administration } from "../administration/schema";
import { Disclosure } from "../settings/ui/fields/disclosure";
import { rotationView } from "./schema";

/** The team's weekly triage rotation, in its People tab: the first handover, then members in order by their selects. */
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
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const ids = JSON.stringify(resource.data?.operatorIds ?? []);
  useEffect(() => {
    const current = JSON.parse(ids) as (string | null)[];
    setOrder(current.length ? current.map((id) => id ?? "") : ["", ""]);
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
          operatorIds: order,
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
    <section className="triage-rotation" aria-label={`Triage rotation for ${team.name}`}>
      <h2 className="group-heading">Triage responsibility</h2>
      <p className="field-hint">Each week one member hears about new intake items in Inbox.</p>
      {resource.loading && <p role="status">Loading rotation…</p>}
      {resource.error && (
        <p role="alert">
          {resource.error.message}{" "}
          <button type="button" className="field-retry" onClick={resource.reload}>
            Retry
          </button>
        </p>
      )}
      {resource.data && (
        <form
          aria-label={`Weekly triage rotation for ${team.name}`}
          onSubmit={save}
        >
          <fieldset disabled={pending || !hydrated}>
            <div className="field">
              <div className="field-head"><label htmlFor={`rotation-start-${team.id}`}>First handover in {data.workspace.timezone}</label></div>
              <input
                id={`rotation-start-${team.id}`}
                name="startsLocal"
                type="datetime-local"
                required
                key={resource.data.startsLocal ?? "new"}
                defaultValue={resource.data.startsLocal ?? ""}
              />
            </div>
            <ol className="rotation-list">
              {order.map((id, index) => (
                <li key={index}>
                  <span className="rotation-number" aria-hidden="true">{index + 1}</span>
                  <div className="field">
                    <select
                      aria-label={`Rotation member ${index + 1}`}
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
                  </div>
                  {order.length > 2 && (
                    <button
                      type="button"
                      className="button-text"
                      onClick={() =>
                        setOrder((values) =>
                          values.filter((_, i) => i !== index),
                        )
                      }
                    >
                      Remove member {index + 1}
                    </button>
                  )}
                </li>
              ))}
            </ol>
            <div className="confirm-actions">
              <button
                type="button"
                className="button-quiet"
                disabled={order.length >= 50}
                onClick={() => setOrder((values) => [...values, ""])}
              >
                Add rotation member
              </button>
              <button type="submit" className="button-quiet">Save triage rotation</button>
            </div>
          </fieldset>
        </form>
      )}
      {resource.data?.startsLocal && (
        <p className="field-hint">
          Current responsible member:{" "}
          {resource.data.responsible?.name ?? "No available member"}.{" "}
          <a href="/app/triage">Open triage handover</a>
        </p>
      )}
      {saved && <p className="field-hint" role="status">Triage rotation saved.</p>}
      {error && <p className="confirm-error" role="alert">{error}</p>}
      <Disclosure title="How this works">
        <p>The rotation follows {data.workspace.timezone}. Each new native or signed-source intake item notifies its current responsible member once in Inbox, except its actor. Unavailable members receive nothing.</p>
        <p>The first member starts at the first handover. Each member after takes one calendar week. A repeated or skipped clock minute hands over at the next unambiguous minute.</p>
      </Disclosure>
    </section>
  );
}
