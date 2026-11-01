import { navigate } from "./collaboration-navigation.mjs";
import assert from "node:assert/strict";
import { poll } from "./admin-runtime-support.mjs";
import { receipt } from "./collaboration-support.mjs";
export async function paginationAndRemoval({
  page,
  peer,
  runtime,
  operator,
  comment,
  peerCapture,
  capture,
  clause,
  fixtures,
}) {
  await clause(
    "NOTIFY-003",
    "native Inbox pagination ordering and cached rows clear after actual operator removal",
    async () => {
      for (let index = 1; index <= 31; index++)
        await comment(`Real pagination comment ${index}.`);
      const expected = runtime.sql(
        `SELECT id,created_at FROM notifications WHERE recipient_id='${operator.id}' ORDER BY created_at DESC,id DESC`,
      );
      assert.ok(
        expected.length > 30,
        "real source events exceed one Inbox page",
      );
      const own = await (
        await peer.request.get(runtime.base + "/api/notifications")
      ).json();
      assert.deepEqual(
        own.items.map((item) => item.id),
        expected.slice(0, 30).map((row) => row.id),
        "native first page matches D1 stable order",
      );
      await navigate(peer, runtime.base + "/app/inbox");
      const more = peer.getByRole("button", {
        name: "Load more notifications",
        exact: true,
      });
      await more.waitFor();
      await peerCapture("inbox-pagination-first-page");
      const response = peer.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === "/api/notifications" &&
          new URL(r.url()).searchParams.has("cursor"),
      );
      await more.click();
      const next = await (await response).json();
      assert.deepEqual(
        next.items.map((item) => item.id),
        expected.slice(30).map((row) => row.id),
        "native cursor returns complete older order",
      );
      await poll(
        () => peer.locator(".inbox-row").count(),
        (count) => count === expected.length,
        "both Inbox pages rendered",
      );
      await peerCapture("inbox-pagination-loaded-older-page");
      fixtures.push({
        width: page.viewportSize().width,
        source:
          "31 actual native UI comments; no synthetic Inbox response or row fixture",
        paginationRows: expected.length,
      });
      await navigate(page, runtime.base + "/app/settings/people/" + operator.id);
      await page
        .getByRole("button", { name: "Remove " + operator.name, exact: true })
        .click();
      await capture("operator-removal-confirmation");
      await receipt(
        page,
        "/api/settings/operators/" + operator.id,
        "DELETE",
        () =>
          page
            .getByRole("button", { name: "Confirm removal", exact: true })
            .click(),
      );
      await poll(
        () => peer.locator(".inbox-row").count(),
        (count) => count === 0,
        "authorization loss clears every first and cached older row",
      );
      await peer.getByRole("alert").waitFor();
      assert.equal(
        await peer
          .getByRole("button", { name: "Load more notifications", exact: true })
          .count(),
        0,
        "revocation removes pagination control",
      );
      assert.equal(
        await peer.locator(".inbox-count").count(),
        0,
        "revocation clears old shell unread count",
      );
      assert.equal(
        await peer
          .locator(".inbox-page header")
          .evaluate((header) => /\d+ unread/.test(header.textContent)),
        false,
        "revocation clears old Inbox unread count",
      );
      await peerCapture("inbox-revoked-session-clears-all-pages");
      for (const table of ["notifications", "notification_deliveries"])
        assert.equal(
          runtime.sql(
            `SELECT count(*) n FROM ${table} WHERE recipient_id='${operator.id}'`,
          )[0].n,
          0,
          table + " addressed state erased",
        );
      for (const table of [
        "issue_followers",
        "issue_notification_mutes",
        "notification_type_mutes",
        "notification_preferences",
      ])
        assert.equal(
          runtime.sql(
            `SELECT count(*) n FROM ${table} WHERE operator_id='${operator.id}'`,
          )[0].n,
          0,
          table + " personal state erased",
        );
      assert.equal(
        (await page.request.get(runtime.base + "/api/session")).status(),
        200,
        "separate owner session remains admitted",
      );
      assert.equal(
        (await peer.request.get(runtime.base + "/api/session")).status(),
        401,
        "recipient native session revoked",
      );
    },
  );
}
