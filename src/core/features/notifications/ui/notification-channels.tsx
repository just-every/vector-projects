import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { fetchJson, useApiResource } from "../../../app/api-client";
import type { ChannelChoice } from "../channel-schema";
import type { NotificationKind, NotificationSettings } from "../schema";
import { channelDefaultsSchema, channelPreferencesSchema } from "./channel-data";
import { ChannelMatrix } from "./channel-matrix";
import "./notification-channels.css";

export function NotificationChannels({ settings }: { settings: NotificationSettings }) {
  const resource = useApiResource("/api/settings/notifications/channels", channelPreferencesSchema);
  const [pending, setPending] = useState(false);
  const [editingDefaults, setEditingDefaults] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const slackReason = !settings.slack.available
    ? `Slack is unavailable. ${settings.slack.reason ?? ""}`
    : !settings.slack.link ? "Link your Slack account below to enable Slack notifications." : undefined;

  async function save(choice: ChannelChoice | { kind: NotificationKind; inherit: true }, defaults = false) {
    if (pending) return;
    setPending(true); setMessage(""); setError("");
    try {
      if (defaults) {
        const result = await fetchJson("/api/settings/notifications/channel-defaults", channelDefaultsSchema, {
          method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ channels: [choice] }),
        });
        resource.publishReceipt(current => {
          if (!current) throw new Error("Notification preferences are no longer available.");
          return { ...current, defaults: result.channels, channels: current.channels.map(row => {
            const updated = result.channels.find(value => value.kind === row.kind);
            return row.inherited && updated ? { ...updated, inherited: true } : row;
          }) };
        });
      } else {
        const result = await fetchJson("/api/settings/notifications/channels", channelPreferencesSchema, {
          method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ channels: [choice] }),
        });
        resource.publishReceipt(() => result);
      }
      setMessage(defaults ? "Workspace defaults saved. Members using defaults will follow this change." : "Notification channels saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save notification channels.");
    } finally { setPending(false); }
  }

  const data = resource.data;
  return <div className="notification-channels" aria-labelledby="notification-channels-heading">
    <h3 id="notification-channels-heading">Channels by event</h3>
    <p>Choose how each event reaches you. Inbox is always retained unless muted below. Custom choices stay yours when workspace defaults change.</p>
    {resource.loading && <p role="status">Loading notification channels…</p>}
    {resource.error && <p role="alert">{resource.error.message}{" "}
      <button type="button" onClick={resource.reload}>Retry notification channels</button>
    </p>}
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{pending ? "Saving notification channels…" : message}</p>
    {data && <>
      {!settings.emailAvailable ? <p>Email delivery is unavailable for this installation. Your channel choices are saved for when email is available.</p>
        : !settings.emailEnabled && <p>Email delivery is paused. Turn on “Allow email notifications” below to receive your chosen email notifications.</p>}
      <p>Hourly and daily digests use <Link to="/app/settings/profile">your time and working hours</Link>.</p>
      {slackReason && <p id="notification-slack-channel-reason">{slackReason}</p>}
      <ChannelMatrix rows={data.channels} disabled={pending || Boolean(resource.error)} slackReason={slackReason}
        onChange={choice => void save(choice)} onReset={kind => void save({ kind, inherit: true })} />
      {data.canManageDefaults && <div className="notification-channel-defaults">
        <button type="button" aria-expanded={editingDefaults} aria-controls="notification-channel-default-editor"
          onClick={() => setEditingDefaults(value => !value)}>
          {editingDefaults ? "Hide workspace defaults" : "Manage workspace defaults"}
        </button>
        {editingDefaults && <div id="notification-channel-default-editor">
          <h4>Workspace defaults</h4>
          <p>Owner and Admin can set defaults for members who have not made a custom choice. Slack delivery still requires each member to link their own account.</p>
          <ChannelMatrix rows={data.defaults} defaults disabled={pending || Boolean(resource.error)} onChange={choice => void save(choice, true)} />
        </div>}
      </div>}
      <h3>Digest delivery updates</h3>
      {data.digestDeliveries.length === 0 ? <p>No failed or uncertain digest deliveries.</p> : <ul>
        {data.digestDeliveries.map(delivery => <li key={delivery.id}><div>
          <strong>{delivery.status === "uncertain" ? "Digest delivery uncertain" : "Digest delivery failed"}</strong>
          <span>{delivery.reason}</span>
          {delivery.status === "uncertain" && <span>It will not be sent again automatically.</span>}
          <span>{delivery.attempts} {delivery.attempts === 1 ? "attempt" : "attempts"} · <time dateTime={delivery.updatedAt}>{delivery.updatedAt}</time></span>
        </div></li>)}
      </ul>}
    </>}
  </div>;
}
