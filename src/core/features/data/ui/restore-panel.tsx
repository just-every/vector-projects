import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ApiError, fetchJson, useApiResource } from "../../../app/api-client";
import { grantSchema, restoreSchema, reviewEffectsSchema } from "./restore-schema";

const endpoint = "/api/data/restore";

export function RestorePanel() {
  const resource = useApiResource(endpoint, restoreSchema, 5000);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const change = async (operator?: { id: string; name: string }) => {
    setPending(operator?.id ?? "effects");
    setError("");
    setMessage("");
    let committed = false;
    try {
      if (operator) {
        await fetchJson(`${endpoint}/operators/${encodeURIComponent(operator.id)}`, grantSchema, { method: "POST" });
      } else {
        await fetchJson(`${endpoint}/review-effects`, reviewEffectsSchema, { method: "POST" });
      }
      committed = true;
      const updated = await fetchJson(endpoint, restoreSchema);
      resource.publishReceipt(() => updated);
      setMessage(operator ? `${operator.name} can now sign in with a fresh sign-in link.` : "Future effects are on. Historical deliveries remain quarantined.");
    } catch (cause) {
      setError(committed
        ? "The change was saved, but the updated restore status could not be loaded. Refresh the status before continuing."
        : cause instanceof ApiError && cause.status === 409
          ? operator ? "Access could not be granted. This person may already be admitted or no longer eligible. Review the refreshed status." : "Future effects could not be changed. Review the refreshed status."
          : cause instanceof Error ? cause.message : "The restore change could not be completed.");
      resource.reload();
    } finally {
      setPending(null);
    }
  };
  const disabled = pending !== null || Boolean(resource.error) || Boolean(error);

  return <section id="after-restore" className="administration-panel" aria-labelledby="restore-heading" aria-busy={pending !== null}>
    <h2 id="restore-heading">After a restore</h2>
    {resource.loading && <p role="status">Loading restore status…</p>}
    {(resource.error || error) && <div role="alert"><p>{error || resource.error?.message}</p><button type="button" disabled={pending !== null} onClick={() => { setError(""); resource.reload(); }}>Refresh restore status</button></div>}
    {message && <p role="status">{message}</p>}
    {resource.data && !resource.data.restored && <p>This installation has not been restored. No restore review is needed.</p>}
    {resource.data?.restored && resource.data.status && <>
      <p>Review the people who can sign in to this restored workspace. Removed people cannot be admitted.</p>
      <ul aria-label="Restored people">{resource.data.operators.map(operator => <li key={operator.id}>
        <div><strong>{operator.name}</strong><span>{operator.email}</span><span>{!operator.eligible ? "Unavailable for sign-in" : operator.approved ? "Can sign in" : "Awaiting access review"}</span></div>
        {Boolean(operator.eligible) && !operator.approved && <button type="button" disabled={disabled} onClick={() => void change(operator)}>{pending === operator.id ? "Granting access…" : `Allow ${operator.name} to sign in`}</button>}
      </li>)}</ul>
      <h3>Future effects</h3>
      <p>{resource.data.status.effectsHeld ? "Sending, receiving and scheduled effects are held. Check your restored workspace and integration destinations before turning them on." : "Future effects are on. Integrations still need their credentials re-entered."}</p>
      <p>Historical deliveries remain quarantined and are never replayed by this review. Secrets are excluded from archives; review destinations and re-enter credentials in <Link to="/app/settings/connections">Connections</Link>.</p>
      {Boolean(resource.data.status.effectsHeld) && <button type="button" disabled={disabled} onClick={() => void change()}>{pending === "effects" ? "Turning on future effects…" : "Turn on future effects"}</button>}
    </>}
  </section>;
}
