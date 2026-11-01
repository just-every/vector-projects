import { useId, useState, type FormEvent } from "react";
import { fetchJson, useApiResource } from "../../../app/api-client";
import { useHydrated } from "../../../app/initial-resources";
import { useViewerTime } from "../../../app/viewer-time";
import { Disclosure } from "../../settings/ui/fields/disclosure";
import { EventWebhookKey } from "./event-key";
import { emailSettingsSchema } from "./schema";

type Team = { teamId: string; teamName: string };

/** A team's email intake, loaded when its tab opens: off, then on with its address, senders and acknowledgement. */
export function TeamEmailIntake({ archived, ...team }: Team & { archived: boolean }) {
  if (archived) return <section className="team-block" aria-label={`Email intake for ${team.teamName}`}>
    <h2 className="group-heading">Email intake</h2>
    <p className="field-hint">Email intake is unavailable while this team is archived. Unarchive the team to manage its retained settings.</p>
  </section>;
  return <ActiveTeamEmailIntake {...team} />;
}

function ActiveTeamEmailIntake({ teamId, teamName }: Team) {
  const { formatInstant } = useViewerTime();
  const hydrated = useHydrated();
  const id = useId();
  const path = `/api/settings/teams/${teamId}/email-intake`;
  const resource = useApiResource(path, emailSettingsSchema, undefined, { abortPendingOnDispose: false });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [on, setOn] = useState<boolean | null>(null);
  const data = resource.data;
  const enabled = on ?? data?.settings.enabled ?? false;
  // The address, the senders and the switches are one record (the server needs a sender once intake is on), so they save together.
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !data) return;
    const fields = new FormData(event.currentTarget);
    setPending(true); setError(""); setSaved(false);
    try {
      const receipt = await fetchJson(path, emailSettingsSchema, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled, address: fields.get("address") ?? data.settings.address,
          allowedSenders: String(fields.get("allowedSenders") ?? data.settings.allowedSenders.join("\n")).split(/\r?\n/).map(value => value.trim()).filter(Boolean),
          acknowledgement: fields.has("acknowledgement") || (!enabled && data.settings.acknowledgement),
        }),
      });
      resource.publishReceipt(() => receipt);
      setOn(null); setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Email intake settings could not be saved.");
    } finally { setPending(false); }
  }
  return <section className="team-block" aria-label={`Email intake for ${teamName}`}>
    <h2 className="group-heading">Email intake</h2>
    {resource.error && <p role="alert">{resource.error.message} <button type="button" className="field-retry" onClick={resource.reload}>Retry</button></p>}
    {resource.loading && <p role="status">Loading email intake…</p>}
    {data && <>
      <form className="intake-form" aria-label={`Configure email intake for ${teamName}`} onSubmit={save}>
        <div className="field field-switch">
          <label className="switch-row" htmlFor={`${id}-enabled`}>
            <input id={`${id}-enabled`} type="checkbox" role="switch" checked={enabled} disabled={!hydrated} aria-describedby={`${id}-hint`} onChange={event => { setOn(event.target.checked); setSaved(false); }} />
            <span className="switch-track" aria-hidden="true" /><span className="switch-label">Enable email intake</span>
          </label>
          <p className="field-hint" id={`${id}-hint`}>Forward mail from Gmail, Outlook or a shared inbox to a private team address.</p>
        </div>
        {enabled && <>
          <div className="field"><div className="field-head"><label htmlFor={`${id}-address`}>Private intake address</label></div>
            <input id={`${id}-address`} type="email" name="address" maxLength={254} defaultValue={data.settings.address} disabled={!hydrated} /></div>
          <div className="field"><div className="field-head"><label htmlFor={`${id}-senders`}>Allowed sender addresses</label></div>
            <textarea id={`${id}-senders`} name="allowedSenders" rows={4} spellCheck={false} defaultValue={data.settings.allowedSenders.join("\n")} aria-describedby={`${id}-senders-hint`} disabled={!hydrated} />
            <p className="field-hint" id={`${id}-senders-hint`}>One full email address per line. An empty list admits no senders.</p></div>
          <div className="field field-switch">
            <label className="switch-row" htmlFor={`${id}-ack`}>
              <input id={`${id}-ack`} type="checkbox" role="switch" name="acknowledgement" defaultChecked={data.settings.acknowledgement} disabled={!hydrated} />
              <span className="switch-track" aria-hidden="true" /><span className="switch-label">Send one acknowledgement with the issue identifier</span>
            </label>
          </div>
        </>}
        <div className="confirm-actions">
          <button type="submit" className="button-quiet" disabled={pending || !hydrated}>{pending ? "Saving…" : "Save email intake"}</button>
          {saved && <span className="field-hint" role="status">Email intake settings saved.</span>}
        </div>
        {error && <p className="confirm-error" role="alert">{error}</p>}
      </form>
      <Disclosure title="How this works">
        <p>Only the exact sender addresses listed are admitted; domains and wildcards are not accepted. Internal comments and status changes are never emailed.</p>
        <p>Set up Cloudflare Email Routing to send this address to this installation’s Worker. Saving these settings does not create an address or set up your mail domain.</p>
        {!data.ingressConfigured && <p>Vector cannot check your mail routing. Confirm the Cloudflare route before forwarding mail.</p>}
        <EventWebhookKey teamId={teamId} configured={data.eventWebhook.configured} url={data.eventWebhook.url} onChanged={resource.refreshAfterMutation} />
        <p>Customer domain mapping is unavailable in this installation. Requesters are recorded by their email address without a seat or sign-in.</p>
        {data.receipts.length > 0 && <>
          <p><strong>Recent inbound mail · {data.receipts.length}</strong></p>
          <ul>{data.receipts.map(receipt => <li key={receipt.id}>
            <time dateTime={receipt.createdAt}>{formatInstant(receipt.createdAt)}</time>{" · "}{receipt.status}
            {receipt.issueIdentifier && <> · <a href={`/app/issues/${encodeURIComponent(receipt.issueIdentifier)}`}>{receipt.issueIdentifier}</a></>}
            {receipt.error && <> · {receipt.error}</>}
          </li>)}</ul>
        </>}
      </Disclosure>
    </>}
  </section>;
}
