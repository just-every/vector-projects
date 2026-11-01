import { navigate } from "./collaboration-navigation.mjs";
import assert from "node:assert/strict";
import { poll } from "./admin-runtime-support.mjs";
import { receipt } from "./collaboration-support.mjs";
import { insertDeliveryPresentationFixture } from "./collaboration-delivery-fixture.mjs";
export async function deliveryPresentation({
  page,
  peer,
  runtime,
  issue,
  operator,
  comment,
  peerCapture,
  clause,
  fixtures,
}) {
  await clause(
    "NOTIFY-006",
    "native failed and uncertain delivery surfaces with explicitly labelled fresh D1 presentation fixtures",
    async () => {
      const pending = [];
      for (const status of ["failed", "uncertain"]) {
        const before = runtime
          .sql(
            `SELECT id FROM notifications WHERE recipient_id='${operator.id}'`,
          )
          .map((row) => row.id);
        await comment(
          `Fresh ${status} presentation fixture source notification `,
          true,
        );
        const rows = runtime
          .sql(
            `SELECT id FROM notifications WHERE recipient_id='${operator.id}'`,
          )
          .filter((row) => !before.includes(row.id));
        assert.equal(rows.length, 1, "one fresh UI notification");
        pending.push({ notificationId: rows[0].id, status });
      }
      // Stop real application pollers through ordinary navigation before the
      // test-only native SQLite writes. No request/response or application mock.
      await Promise.all(
        [page, peer].map(async (current) => {
          await current.waitForLoadState("networkidle");
          await navigate(current, runtime.base + "/");
          await current.waitForLoadState("networkidle");
        }),
      );
      for (const fixture of pending)
        fixtures.push({
          width: peer.viewportSize().width,
          ...await insertDeliveryPresentationFixture(
            runtime,
            fixture.notificationId,
            fixture.status,
          ),
        });
      await navigate(page, runtime.base + "/app/issues/" + issue.identifier);
      await navigate(peer, runtime.base + "/app/settings/notifications");
      const section = peer.getByRole("region", {
        name: "Notifications",
        exact: true,
      });
      await section
        .getByText("Email delivery failed.", { exact: true })
        .waitFor();
      await section
        .getByText(
          "Delivery uncertain. It will not be sent again automatically.",
          { exact: true },
        )
        .waitFor();
      assert.equal(
        await section.getByRole("button", { name: /resend/i }).count(),
        0,
        "no unsafe resend control",
      );
      await peerCapture("settings-failed-uncertain-fixtures");
    },
  );
  await clause(
    "NOTIFY-006",
    "operator re-enables email through native Settings and next real mention is captured once",
    async () => {
      const section = peer.getByRole("region", {
        name: "Notifications",
        exact: true,
      });
      await receipt(peer, "/api/settings/notifications", "PATCH", () =>
        section
          .getByLabel("Allow email notifications", { exact: true })
          .click(),
      );
      await poll(
        () =>
          section
            .getByLabel("Allow email notifications", { exact: true })
            .isChecked(),
        (checked) => checked,
        "email reenabled checked",
      );
      await peerCapture("settings-email-reenabled");
      const before = runtime.sql(
        "SELECT count(*) n FROM (SELECT json_extract(message,'$.deliveryId') AS delivery_id,json_extract(message,'$.to[0]') AS recipient,json_extract(message,'$.subject') AS subject,json_extract(message,'$.text') AS text,created_at FROM rer_mail_development_outbox WHERE json_extract(message,'$.text') LIKE '%'||char(10)||'Sign in to view this issue.')",
      )[0].n;
      await comment("A real mention after restoring email ", true);
      await poll(
        () =>
          runtime.sql("SELECT count(*) n FROM (SELECT json_extract(message,'$.deliveryId') AS delivery_id,json_extract(message,'$.to[0]') AS recipient,json_extract(message,'$.subject') AS subject,json_extract(message,'$.text') AS text,created_at FROM rer_mail_development_outbox WHERE json_extract(message,'$.text') LIKE '%'||char(10)||'Sign in to view this issue.')")[0]
            .n,
        (count) => count === before + 1,
        "reenabled Base capture",
      );
      assert.equal(
        runtime.sql(
          `SELECT count(*) n FROM notification_deliveries WHERE status='uncertain'`,
        )[0].n,
        1,
        "uncertain fixture remains terminal",
      );
      assert.equal(
        runtime.sql(
          `SELECT count(*) n FROM notification_deliveries WHERE status='failed'`,
        )[0].n,
        1,
        "failed fixture remains terminal",
      );
      await navigate(peer, runtime.base + "/app/inbox");
      await peerCapture("inbox-email-reenabled");
    },
  );
}
