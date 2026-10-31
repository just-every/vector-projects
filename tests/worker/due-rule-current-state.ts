import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { type dueRuleFixture, beforeDueClaim } from "./due-rule-proof";
import { tick } from "./due-reminders-fixture";
import { request } from "./base-auth-fixture";
type Fixture = Awaited<ReturnType<typeof dueRuleFixture>>;
export async function proveCurrentDueRuleState(
  f: Fixture,
  member: string,
  memberCookie: string,
) {
  await env.DB.prepare("UPDATE operators SET role='member' WHERE id=?")
    .bind(member)
    .run();
  const at = "2026-03-08T07:00:00Z";
  const runCount = (id: string) =>
    env.DB.prepare(
      "SELECT count(*) n FROM workspace_due_rule_runs WHERE issue_id=?",
    )
      .bind(id)
      .first("n");
  const issue = await f.create({ dueDate: "2026-03-10" });
  await tick(
    at,
    beforeDueClaim(() =>
      env.DB.prepare("UPDATE issues SET assignee_operator_id=? WHERE id=?")
        .bind(member, issue.id)
        .run(),
    ),
  );
  expect(await runCount(issue.id)).toBe(0);
  await tick(at);
  expect(
    await env.DB.prepare(
      "SELECT recipient_id FROM workspace_due_rule_runs WHERE issue_id=?",
    )
      .bind(issue.id)
      .first("recipient_id"),
  ).toBe(member);
  const inbox = await request(
    "/api/notifications",
    "GET",
    undefined,
    memberCookie,
  );
  expect(inbox.status).toBe(200);
  expect(
    ((await inbox.json()) as { items: { identifier: string }[] }).items.some(
      (n) => n.identifier === issue.identifier,
    ),
  ).toBe(true);
  // Current privacy is authoritative even when discovery already saw the assignee.
  const hidden = await f.create({
    dueDate: "2026-03-10",
    assigneeOperatorId: member,
  });
  await tick(
    at,
    beforeDueClaim(() =>
      env.DB.prepare("UPDATE teams SET is_private=1 WHERE id=?")
        .bind(f.team.id)
        .run(),
    ),
  );
  expect(await runCount(hidden.id)).toBe(0);
  expect((await f.detail(hidden.identifier)).cycle).toBeNull();
  expect(
    (
      await request(
        "/api/issues/" + hidden.identifier,
        "GET",
        undefined,
        memberCookie,
      )
    ).status,
  ).toBe(404);
  expect(
    JSON.stringify(
      await (
        await request("/api/notifications", "GET", undefined, memberCookie)
      ).json(),
    ),
  ).not.toContain(hidden.identifier);
  await env.DB.prepare("UPDATE teams SET is_private=0 WHERE id=?")
    .bind(f.team.id)
    .run();
  await tick(at);
  expect(await runCount(hidden.id)).toBe(1);
  // A revoked rule owner cannot continue using the authority stored at rule creation.
  await env.DB.prepare("UPDATE operators SET role='admin' WHERE id=?")
    .bind(member)
    .run();
  await f.save(true, memberCookie);
  const paused = await f.create({ dueDate: "2026-03-10" });
  await tick(
    at,
    beforeDueClaim(() =>
      env.DB.prepare("UPDATE operators SET role='member' WHERE id=?")
        .bind(member)
        .run(),
    ),
  );
  expect(await runCount(paused.id)).toBe(0);
  expect((await f.detail(paused.identifier)).cycle).toBeNull();
  // Settings shows the stored enabled rule as paused until an Owner or Admin takes it over.
  expect((await f.history()).rule).toMatchObject({
    enabled: true,
    ownerId: member,
    ownerActive: false,
  });
  await f.save();
  expect((await f.history()).rule.ownerActive).toBe(true);
  // A failure midway through both effects rolls them all back, then leaves a visible failure.
  const atomic = await f.create({ dueDate: "2026-03-10" });
  await env.DB.prepare(
    `CREATE TRIGGER synthetic_due_failure BEFORE INSERT ON audit_records WHEN NEW.action='automation.due_soon'
    BEGIN SELECT RAISE(ABORT,'synthetic-vector-due-failure'); END`,
  ).run();
  await tick(at);
  expect((await f.detail(atomic.identifier)).cycle).toBeNull();
  expect(
    (await f.notifications()).some((n) => n.identifier === atomic.identifier),
  ).toBe(false);
  expect(
    (await f.history()).runs.find((r) => r.identifier === atomic.identifier),
  ).toMatchObject({ outcome: "failed", reason: "Run failed; retry pending" });
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM issue_activity WHERE issue_id=? AND kind='issue.cycle_automatically_added'",
    )
      .bind(atomic.id)
      .first("n"),
  ).toBe(0);
  await env.DB.prepare("DROP TRIGGER synthetic_due_failure").run();
  await tick(at);
  expect(
    (await f.history()).runs.find((r) => r.identifier === atomic.identifier),
  ).toMatchObject({
    outcome: "succeeded",
    failureReason: "Run failed; retry pending",
  });
  // The fixed reminder mute is honored without deferring the cycle action or allowing later backfill.
  const muted = await f.create({ dueDate: "2026-03-10" });
  expect(
    (
      await f.call("/issues/" + muted.identifier + "/subscription", "PATCH", {
        muted: true,
      })
    ).status,
  ).toBe(200);
  await tick(at);
  expect(
    (await f.history()).runs.find((r) => r.identifier === muted.identifier),
  ).toMatchObject({ outcome: "succeeded", notified: false });
  expect((await f.detail(muted.identifier)).cycle).not.toBeNull();
  await f.call("/issues/" + muted.identifier + "/subscription", "PATCH", {
    muted: false,
  });
  await tick(at);
  expect(
    (await f.notifications()).some((n) => n.identifier === muted.identifier),
  ).toBe(false);
  // A competing scheduler commits between this tick's discovery and claim. Work
  // already in the active cycle keeps that claim's fence current, so only the
  // durable receipt prevents a second notice.
  const raced = await f.create({
    dueDate: "2026-03-10",
    cycleId: (await f.detail(muted.identifier)).cycle!.id,
  });
  await tick(at, beforeDueClaim(() => tick(at)));
  expect(await runCount(raced.id)).toBe(1);
  expect(
    (await f.notifications()).filter((n) => n.identifier === raced.identifier),
  ).toHaveLength(1);
  // Closing or expiring the selected cycle before the atomic action leaves both actions pending.
  const closed = await f.create({ dueDate: "2026-03-10" });
  await tick(
    at,
    beforeDueClaim(() =>
      env.DB.prepare(
        "UPDATE cycles SET closed_at=? WHERE team_id=? AND closed_at IS NULL",
      )
        .bind(at, f.team.id)
        .run(),
    ),
  );
  expect((await f.detail(closed.identifier)).cycle).toBeNull();
  expect(
    (await f.history()).runs.find((r) => r.identifier === closed.identifier),
  ).toMatchObject({ outcome: "failed", reason: "No active open cycle" });
  // Native removal revokes the assignee and clears current assignments. No later tick can resurrect a delivery.
  const removed = await f.create({
    dueDate: "2026-03-10",
    assigneeOperatorId: member,
  });
  expect((await f.call("/settings/operators/" + member, "DELETE")).status).toBe(
    200,
  );
  const auditHistory = await f.call(
    "/settings/audit?action=automation.due_rule_saved",
  );
  expect(auditHistory.status).toBe(200);
  const auditIds = new Set(
    ((await auditHistory.json()) as { entries: { id: string }[] }).entries.map(
      (row) => row.id,
    ),
  );
  const archive = await (
    await import("./http-archive-fixture")
  ).httpExport(f.call);
  const details = archive
    .flatMap((record) => (record.kind === "part" ? record.items : []))
    .filter(
      (item) =>
        item.kind === "row" &&
        item.table === "administration_audit_details" &&
        auditIds.has(String(item.row.audit_id)),
    );
  expect(details.length).toBeGreaterThan(0);
  expect(JSON.stringify(details)).not.toContain("synthetic-vector-member");
  await tick(at);
  expect(await runCount(removed.id)).toBe(0);
  expect(
    (await request("/api/notifications", "GET", undefined, memberCookie))
      .status,
  ).toBe(401);
}
