import { navigate } from "./collaboration-navigation.mjs";
import assert from "node:assert/strict";
import { bootstrapOwner } from "./admin-runtime-support.mjs";
import { inviteRecipient, receipt } from "./collaboration-support.mjs";
export async function disabledEmailJourney({
  page,
  browser,
  runtime,
  capture,
  captureFor,
  clause,
  installations,
}) {
  await bootstrapOwner(page, runtime);
  await navigate(page, runtime.base + "/app/settings/notifications");
  await clause(
    "NOTIFY-006",
    "installation email disabled retains native authentication and Inbox with no delivery intent",
    async () => {
      const section = page.getByRole("region", {
        name: "Notifications",
        exact: true,
      });
      const checkbox = section.getByLabel("Allow email notifications", {
        exact: true,
      });
      await checkbox.waitFor();
      assert.equal(await checkbox.isDisabled(), true);
      assert.equal(await checkbox.isChecked(), false);
      await section
        .getByText(
          "Email notifications are off for this installation. Notification mail needs a configured provider and must be enabled.",
          { exact: true },
        )
        .waitFor();
      await capture("settings-email-unavailable-disabled-installation");
      const recipient = await inviteRecipient({ page, browser, runtime });
      try {
        await navigate(page, runtime.base + "/app/new-issue");
        await page
          .getByLabel(/^Title/)
          .fill("Email disabled still reaches Inbox");
        await page
          .getByLabel(/^Team/)
          .selectOption(
            runtime.sql(
              "SELECT id FROM teams WHERE identifier_prefix='BOOT'",
            )[0].id,
          );
        await page.locator("details.new-issue-context summary").click();
        await page.getByLabel(/^Assignee/).selectOption(recipient.operator.id);
        await receipt(page, "/api/issues", "POST", () =>
          page
            .getByRole("button", { name: "Create issue", exact: true })
            .click(),
        );
        await navigate(recipient.peer, runtime.base + "/app/inbox");
        await recipient.peer.getByText("1 unread", { exact: true }).waitFor();
        assert.equal(
          runtime.sql("SELECT count(*) n FROM notification_deliveries")[0].n,
          0,
          "disabled path creates no queue",
        );
        assert.equal(
          runtime.sql("SELECT count(*) n FROM (SELECT json_extract(message,'$.deliveryId') AS delivery_id,json_extract(message,'$.to[0]') AS recipient,json_extract(message,'$.subject') AS subject,json_extract(message,'$.text') AS text,created_at FROM rer_mail_development_outbox WHERE json_extract(message,'$.text') LIKE '%'||char(10)||'Sign in to view this issue.')")[0]
            .n,
          0,
          "disabled path calls no Base development outbox",
        );
        assert.ok(
          runtime.sql("SELECT count(*) n FROM rer_mail_development_outbox")[0].n >= 2,
          "first-owner and invitation authentication mail remains valid",
        );
        installations.push({
          width: page.viewportSize().width,
          productEmailEnabled: false,
          nativeAuthenticationPassed: true,
          inboxRows: 1,
          deliveryIntents: 0,
          developmentCaptures: 0,
        });
        await captureFor(recipient.peer)(
          "inbox-assignment-email-disabled-installation",
        );
      } finally {
        await recipient.context.close();
      }
    },
  );
}
