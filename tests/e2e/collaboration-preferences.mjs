import { navigate } from "./collaboration-navigation.mjs";
import assert from "node:assert/strict";
import { poll } from "./admin-runtime-support.mjs";
import { counts, ownSubscription, receipt } from "./collaboration-support.mjs";
import { checkNotificationMail } from "./collaboration-mail-checks.mjs";
export async function collaborationPreferences({
  page,
  peer,
  runtime,
  issue,
  operator,
  capture,
  peerCapture,
  clause,
  comment,
  owner,
}) {
  await clause(
    "ISSUE-006",
    "own unfollow and follow preserve issue version",
    async () => {
      await navigate(peer, runtime.base + "/app/issues/" + issue.identifier);
      await ownSubscription(peer, runtime, issue.identifier, "Unfollow");
      await ownSubscription(peer, runtime, issue.identifier, "Follow");
      await peerCapture("issue-follow-restored");
    },
  );
  await clause(
    "NOTIFY-004",
    "issue and event mutes suppress future inbox and actual mail; unmute never backfills",
    async () => {
      await ownSubscription(peer, runtime, issue.identifier, "Mute");
      const before = counts(runtime, issue, operator);
      await peerCapture("issue-muted");
      await comment("Muted private comment ", true);
      await peer.waitForTimeout(2300);
      assert.deepEqual(counts(runtime, issue, operator), before);
      assert.equal(
        runtime.sql("SELECT count(*) n FROM notification_deliveries")[0].n,
        4,
        "muted action creates no mail intent",
      );
      await navigate(peer, runtime.base + "/app/settings/notifications");
      await peer
        .getByRole("region", { name: "Notifications", exact: true })
        .getByRole("button", {
          name: "Unmute " + issue.identifier,
          exact: true,
        })
        .click();
      await poll(
        () =>
          runtime.sql(
            `SELECT count(*) n FROM issue_notification_mutes WHERE operator_id='${operator.id}'`,
          ),
        (r) => r[0].n === 0,
        "unmute",
      );
      assert.deepEqual(counts(runtime, issue, operator), before);
      await peerCapture("settings-unmuted-no-backfill");
      const preferences = peer.getByRole("region", {
        name: "Notifications",
        exact: true,
      });
      for (const label of ["Mentions", "Followed comments"])
        await receipt(peer, "/api/settings/notifications", "PATCH", () =>
          preferences.getByLabel(label, { exact: true }).click(),
        );
      for (const label of ["Mentions", "Followed comments"])
        await poll(
          () => preferences.getByLabel(label, { exact: true }).isChecked(),
          (checked) => checked,
          "event mute control checked",
        );
      await peerCapture("settings-event-mutes");
      await comment("Event muted private comment ", true);
      await peer.waitForTimeout(2300);
      assert.deepEqual(counts(runtime, issue, operator), before);
      assert.equal(
        runtime.sql("SELECT count(*) n FROM notification_deliveries")[0].n,
        4,
        "muted action creates no mail intent",
      );
      for (const label of ["Mentions", "Followed comments"])
        await receipt(peer, "/api/settings/notifications", "PATCH", () =>
          preferences.getByLabel(label, { exact: true }).click(),
        );
      for (const label of ["Mentions", "Followed comments"])
        await poll(
          () => preferences.getByLabel(label, { exact: true }).isChecked(),
          (checked) => !checked,
          "event mute control unchecked",
        );
      assert.deepEqual(counts(runtime, issue, operator), before);
      await peerCapture("settings-event-unmuted-no-backfill");
    },
  );
  await clause(
    "NOTIFY-006",
    "email optout retains inbox and Base development captures contain only disclosed fields",
    async () => {
      const preferences = peer.getByRole("region", {
        name: "Notifications",
        exact: true,
      });
      assert.equal(
        await preferences
          .getByLabel("Allow email notifications", { exact: true })
          .isEnabled(),
        true,
        "configured email preference remains enabled",
      );
      assert.equal(
        await preferences
          .getByText(/Email notifications are off for this installation/)
          .count(),
        0,
        "configured email does not show unavailable guidance",
      );
      await receipt(peer, "/api/settings/notifications", "PATCH", () =>
        preferences
          .getByLabel("Allow email notifications", { exact: true })
          .click(),
      );
      await poll(
        () =>
          preferences
            .getByLabel("Allow email notifications", { exact: true })
            .isChecked(),
        (checked) => !checked,
        "email optout control unchecked",
      );
      await peerCapture("settings-email-optout");
      const before = counts(runtime, issue, operator);
      await comment("Email opted out private comment ", true);
      await poll(
        () => counts(runtime, issue, operator),
        (r) => r.inbox === before.inbox + 1,
        "optout inbox",
      );
      assert.equal(counts(runtime, issue, operator).mail, before.mail);
      assert.equal(
        runtime.sql("SELECT count(*) n FROM notification_deliveries")[0].n,
        4,
        "optout creates no mail intent",
      );
      const captures = runtime.sql(
        "SELECT outbox.message, delivery.id AS delivery_id, notification.causes_json FROM rer_mail_development_outbox outbox JOIN notification_deliveries delivery ON delivery.id=json_extract(outbox.message,'$.deliveryId') JOIN notifications notification ON notification.id=delivery.notification_id",
      );
      assert.equal(captures.length, 4);
      const current = runtime.sql(`SELECT description,expected_outcome,customer_impact FROM issues WHERE id='${issue.id}'`)[0];
      const privateValues = [
        ...Object.values(current),
        ...runtime.sql(`SELECT body FROM issue_comments WHERE issue_id='${issue.id}'`).map(comment => comment.body),
      ];
      const reasons = new Set();
      for (const mail of captures) {
        for (const reason of checkNotificationMail(mail, { issue, operator, owner, base: runtime.base, privateValues }))
          reasons.add(reason);
      }
      assert.ok(reasons.has("assignment") && reasons.has("mention"), "both assignment and mention emails explain their distinct causes");
      await navigate(peer, runtime.base + "/app/inbox");
      await peerCapture("inbox-email-optout-retained");
    },
  );
}
