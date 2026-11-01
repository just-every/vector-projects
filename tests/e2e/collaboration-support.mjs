import { freePort } from '@runeditrun/rer/adapter-settings';
import { lifecycleOperation } from "./collaboration-lifecycle.mjs";
import { navigate } from "./collaboration-navigation.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAdminRuntime, poll } from "./admin-runtime-support.mjs";
import { openDisclosures } from "./ui-controls-checks.mjs";

export async function collaborationRuntime(width, sourceFiles = []) {
  const runtime = createAdminRuntime(width, sourceFiles, {port: await freePort(), inspectorPort: 0});
  Object.assign(runtime.config, {
    WORKSPACE_NAME: "Collaboration runtime",
    FIRST_OWNER_NAME: "Collaboration owner",
    NOTIFICATION_EMAIL_ENABLED: "true",
  });
  return runtime;
}
export async function inviteRecipient({ page, browser, runtime }) {
  await navigate(page, runtime.base + "/app/settings/people");
  await openDisclosures(page);
  const operators = page.getByRole("region", {
    name: "Members",
    exact: true,
  });
  await operators
    .getByLabel("Name", { exact: true })
    .fill("Collaboration recipient");
  await operators
    .getByLabel("Email", { exact: true })
    .fill("recipient@collaboration.test");
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/settings/operators/invite",
  );
  await operators
    .getByRole("button", { name: "Send invitation", exact: true })
    .click();
  assert.equal((await response).status(), 202);
  const link = runtime.sql(
    "SELECT json_extract(message,'$.text') AS sign_in_url FROM rer_mail_development_outbox WHERE json_extract(message,'$.to[0]')='recipient@collaboration.test' ORDER BY created_at DESC,sequence DESC LIMIT 1",
  )[0].sign_in_url.match(/https?:\/\/[^\s]+/)[0];
  const context = await browser.newContext({ viewport: page.viewportSize() });
  const peer = await context.newPage();
  await navigate(peer, link);
  await peer.getByRole("button", { name: "Confirm", exact: true }).click();
  await peer.waitForURL(runtime.base + "/app");
  const operator = runtime.sql(
    "SELECT * FROM operators WHERE email='recipient@collaboration.test'",
  )[0];
  assert.ok(operator && !operator.removed_at);
  return { context, peer, operator };
}
export async function selectMention(editor, page, name, capture) {
  await editor.press("End");
  await editor.pressSequentially(" @recipient");
  const option = page
    .getByRole("listbox", { name: "Mention an operator", exact: true })
    .getByRole("option", { name: new RegExp(name) });
  await option.waitFor();
  if (capture) await capture();
  await editor.press("Enter");
  assert.match(
    await editor.getAttribute("data-canonical-body"),
    /@\{[A-Z0-9]{26}\|/,
    "keyboard selection carries stable operator ID",
  );
}
export async function receipt(page, path, method, action) {
  return lifecycleOperation(`${method} ${path}`, async () => {
    const pending = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === path && r.request().method() === method,
    );
    await action();
    const response = await pending;
    assert.ok(response.ok(), `${method} ${path}: ${response.status()}`);
    return response.json();
  }, page);
}
export async function ownSubscription(page, runtime, identifier, button) {
  const before = runtime.sql(
    `SELECT version FROM issues WHERE identifier='${identifier}'`,
  )[0].version;
  const activityBefore = runtime.sql(
    `SELECT * FROM issue_activity WHERE issue_id=(SELECT id FROM issues WHERE identifier='${identifier}') ORDER BY id`,
  );
  await receipt(page, `/api/issues/${identifier}/subscription`, "PATCH", () =>
    page.getByRole("button", { name: button, exact: true }).click(),
  );
  assert.equal(
    runtime.sql(
      `SELECT version FROM issues WHERE identifier='${identifier}'`,
    )[0].version,
    before,
    "subscription leaves issue version unchanged",
  );
  assert.deepEqual(
    runtime.sql(
      `SELECT * FROM issue_activity WHERE issue_id=(SELECT id FROM issues WHERE identifier='${identifier}') ORDER BY id`,
    ),
    activityBefore,
    "own collaboration state leaves activity immutable",
  );
}
export function counts(runtime, issue, operator) {
  return {
    inbox: runtime.sql(
      `SELECT count(*) n FROM notifications WHERE issue_id='${issue.id}' AND recipient_id='${operator.id}'`,
    )[0].n,
    mail: runtime.sql(
      `SELECT count(*) n FROM (SELECT json_extract(message,'$.deliveryId') AS delivery_id,json_extract(message,'$.to[0]') AS recipient,json_extract(message,'$.subject') AS subject,json_extract(message,'$.text') AS text,created_at FROM rer_mail_development_outbox WHERE json_extract(message,'$.text') LIKE '%'||char(10)||'Sign in to view this issue.') m JOIN notification_deliveries d ON d.id=m.delivery_id WHERE d.recipient_id='${operator.id}'`,
    )[0].n,
  };
}
// Receipts retain complete-row fingerprints, never private mail or session bytes.
export const rowCustody = (rows) => ({
  count: rows.length,
  sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
});
export async function exportCollaboration(runtime, evidence, width) {
  const tables = runtime
    .sql(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
    )
    .map((r) => r.name);
  const data = Object.fromEntries(
    tables.map((table) => [table, rowCustody(runtime.sql(`SELECT * FROM "${table}"`))]),
  );
  const bytes = JSON.stringify({ width, data }, null, 2) + "\n";
  const file = `database-${width}.json`;
  await writeFile(resolve(evidence, file), bytes);
  return { file, sha256: createHash("sha256").update(bytes).digest("hex") };
}
export async function settledMail(runtime, expected) {
  await poll(
    () => runtime.sql("SELECT * FROM notification_deliveries"),
    (rows) =>
      rows.length === expected && rows.every((r) => r.status === "development"),
    "Base development mail settled",
  );
}
