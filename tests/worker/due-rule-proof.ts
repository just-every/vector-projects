import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { reminderFixture, tick } from "./due-reminders-fixture";
import { invite, actor, request } from "./base-auth-fixture";
import type { DueRule } from "../../src/core/features/automation-rules/schema";

let serial = 0;
export async function dueRuleFixture() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oa_limits"),
    env.DB.prepare("DELETE FROM access_rate_limits"),
    env.DB.prepare("DELETE FROM workspace_due_rule_runs"),
    env.DB.prepare("DELETE FROM workspace_due_rules"),
    env.DB.prepare(
      "UPDATE issues SET due_date=NULL WHERE title LIKE 'synthetic-vector-due-rule%'",
    ),
  ]);
  const suffix = ++serial;
  const f = await reminderFixture();
  await f.configure("America/New_York");
  const state = await f.mutate("/settings/teams", "POST", {
    name: "Due rule " + suffix,
    identifierPrefix: "DR" + String.fromCharCode(64 + suffix),
  });
  const team = state.teams.find(
    (t) => t.identifierPrefix === "DR" + String.fromCharCode(64 + suffix),
  )!;
  const save = async (enabled = true, cookie = f.cookie) => {
    const prior = await f.call("/settings/automation");
    expect(prior.status).toBe(200);
    const rule = ((await prior.json()) as { rule: DueRule | null }).rule;
    const response = await request(
      "/api/settings/automation/due-soon",
      "PUT",
      { name: "Two days ahead", enabled, expectedVersion: rule?.version ?? 0 },
      cookie,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return ((await response.json()) as { rule: DueRule }).rule;
  };
  const cycle = async (
    name = "March delivery",
    startsLocal = "2026-03-01T00:00",
    endsLocal = "2026-03-15T00:00",
  ) => {
    const state = await f.mutate("/settings/cycles", "POST", {
      teamId: team.id,
      name: name + " " + suffix,
      startsLocal,
      endsLocal,
    });
    return state.cycles.find((c) => c.name === name + " " + suffix)!;
  };
  const history = async () => {
    const r = await f.call("/settings/automation");
    expect(r.status).toBe(200);
    return (await r.json()) as {
      rule: DueRule;
      runs: {
        id: string;
        identifier: string;
        outcome: string;
        reason: string;
        notified: boolean;
        failureReason: string | null;
      }[];
    };
  };
  const detail = async (identifier: string) =>
    (await (await f.call("/issues/" + identifier)).json()) as {
      version: number;
      cycle: { id: string } | null;
    };
  return {
    ...f,
    create: (extra: Record<string, unknown> = {}) =>
      f.create({
        title: "synthetic-vector-due-rule-" + suffix,
        teamId: team.id,
        ...extra,
      }),
    save,
    cycle,
    history,
    detail,
    team,
  };
}
export async function proveDueRuleCalendar() {
  const f = await dueRuleFixture(),
    cycle = await f.cycle();
  const issue = await f.create({ dueDate: "2026-03-10" });
  await f.save(false);
  await tick("2026-03-08T07:00:00Z");
  expect((await f.detail(issue.identifier)).cycle).toBeNull();
  expect((await f.history()).runs).toEqual([]);
  const rule = await f.save();
  expect(rule.ownerId).toBe(f.owner);
  expect(rule.enabled).toBe(true);
  await tick("2026-03-08T04:59:00Z");
  expect((await f.history()).runs).toHaveLength(0);
  // Spring-forward still means two calendar days, rather than 48 elapsed hours.
  await Promise.all([
    tick("2026-03-08T07:00:00Z"),
    tick("2026-03-08T07:00:00Z"),
  ]);
  expect((await f.detail(issue.identifier)).cycle?.id).toBe(cycle.id);
  expect((await f.history()).runs).toMatchObject([
    { identifier: issue.identifier, outcome: "succeeded", notified: true },
  ]);
  expect((await f.notifications()).map((n) => n.identifier)).toEqual([
    issue.identifier,
  ]);
  const id = (await f.history()).runs[0].id;
  await tick("2026-03-08T08:00:00Z");
  expect((await f.history()).runs[0].id).toBe(id);
  let current = await f.detail(issue.identifier);
  expect(
    (
      await f.call("/issues/" + issue.identifier, "PATCH", {
        expectedVersion: current.version,
        dueDate: "2026-03-11",
      })
    ).status,
  ).toBe(200);
  await tick("2026-03-09T12:00:00Z");
  expect(await f.notifications()).toHaveLength(2);
  current = await f.detail(issue.identifier);
  expect(
    (
      await f.call("/issues/" + issue.identifier, "PATCH", {
        expectedVersion: current.version,
        dueDate: "2026-03-10",
      })
    ).status,
  ).toBe(200);
  await tick("2026-03-08T12:00:00Z");
  expect(await f.notifications()).toHaveLength(2);
  // The same scheduled export has no process-local receipt cache, including a new module instance.
  const { scheduled } = await import("../../src/core/app/scheduled");
  const { bindings } = await import("./base-auth-fixture");
  await scheduled(
    { scheduledTime: Date.parse("2026-03-08T13:00:00Z") },
    bindings,
  );
  expect(await f.notifications()).toHaveLength(2);
  await f.configure("America/New_York");
  await f.cycle("Fall delivery", "2026-10-30T00:00", "2026-11-08T00:00");
  const fall = await f.create({ dueDate: "2026-11-03" });
  await tick("2026-11-01T03:59:00Z");
  expect((await f.detail(fall.identifier)).cycle).toBeNull();
  await tick("2026-11-01T05:30:00Z");
  await tick("2026-11-01T06:30:00Z");
  expect(
    (await f.history()).runs.filter((r) => r.identifier === fall.identifier),
  ).toHaveLength(1);
  await f.configure("Pacific/Kiritimati");
  const edge = await f.create({ dueDate: "2026-11-04" });
  await tick("2026-11-01T09:59:00Z");
  expect((await f.detail(edge.identifier)).cycle).toBeNull();
  await tick("2026-11-01T10:00:00Z");
  expect((await f.detail(edge.identifier)).cycle).not.toBeNull();
  await f.save(false);
}
export function beforeDueClaim(run: () => Promise<unknown>) {
  let pending = false,
    fired = false;
  return new Proxy(env.DB, {
    get(target, key) {
      if (key === "prepare")
        return (sql: string) => {
          if (sql.startsWith("INSERT INTO workspace_due_rule_runs"))
            pending = true;
          return target.prepare(sql);
        };
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          if (pending && !fired) {
            fired = true;
            await run();
          }
          return target.batch(statements);
        };
      const v = Reflect.get(target, key, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
export async function proveDueRuleAuthority() {
  const f = await dueRuleFixture();
  await f.save();
  const issue = await f.create({ dueDate: "2026-03-10" });
  await tick("2026-03-08T07:00:00Z");
  expect((await f.history()).runs).toMatchObject([
    { outcome: "failed", reason: "No active open cycle" },
  ]);
  expect(await f.notifications()).toHaveLength(0);
  expect((await f.detail(issue.identifier)).cycle).toBeNull();
  // A planned cycle that has not started is not the team's active cycle.
  await f.cycle("April delivery", "2026-04-01T00:00", "2026-04-15T00:00");
  await tick("2026-03-08T07:30:00Z");
  expect((await f.history()).runs).toMatchObject([
    { outcome: "failed", reason: "No active open cycle" },
  ]);
  expect((await f.detail(issue.identifier)).cycle).toBeNull();
  const cycle = await f.cycle();
  await tick("2026-03-08T08:00:00Z");
  expect((await f.history()).runs).toMatchObject([
    { outcome: "succeeded", failureReason: "No active open cycle" },
  ]);
  expect((await f.detail(issue.identifier)).cycle?.id).toBe(cycle.id);
  // Public configuration refuses every weaker role and stale saves without changing configuration.
  const memberCookie = await invite(
      ["synthetic-vector-member", "vector.test"].join("@"),
      f.cookie,
    ),
    member = await actor(memberCookie);
  const input = { name: "Forbidden rule", enabled: false, expectedVersion: 1 };
  for (const role of ["member", "guest", "viewer"]) {
    await env.DB.prepare("UPDATE operators SET role=? WHERE id=?")
      .bind(role, member)
      .run();
    const before = await env.DB.prepare(
      "SELECT * FROM workspace_due_rules",
    ).all();
    expect(
      (
        await request(
          "/api/settings/automation/due-soon",
          "PUT",
          input,
          memberCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          "/api/settings/automation",
          "GET",
          undefined,
          memberCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (await env.DB.prepare("SELECT * FROM workspace_due_rules").all()).results,
    ).toEqual(before.results);
  }
  expect(
    (
      await f.call("/settings/automation/due-soon", "PUT", {
        ...input,
        expectedVersion: 0,
      })
    ).status,
  ).toBe(409);
  await env.DB.prepare("UPDATE operators SET role='admin' WHERE id=?")
    .bind(member)
    .run();
  await f.save(true, memberCookie);
  expect((await f.history()).rule.ownerId).toBe(member);
  const changes = [
    "UPDATE workspace_due_rules SET enabled=0",
    "UPDATE workspace_settings SET timezone='Pacific/Honolulu'",
    "UPDATE issues SET due_date='2026-03-11' WHERE id=?",
    "UPDATE issues SET assignee_operator_id=NULL WHERE id=?",
    "UPDATE issues SET status_id=(SELECT id FROM workflow_statuses WHERE team_id=issues.team_id AND category='completed' LIMIT 1) WHERE id=?",
    "UPDATE issues SET version=version+1 WHERE id=?",
  ];
  for (const sql of changes) {
    await f.configure("America/New_York");
    await f.save();
    const pending = await f.create({ dueDate: "2026-03-10" });
    await tick(
      "2026-03-08T07:00:00Z",
      beforeDueClaim(() => {
        const statement = env.DB.prepare(sql);
        return (
          sql.includes("?") ? statement.bind(pending.id) : statement
        ).run();
      }),
    );
    expect(
      (await f.history()).runs.filter(
        (r) => r.identifier === pending.identifier,
      ),
    ).toHaveLength(0);
    expect((await f.detail(pending.identifier)).cycle).toBeNull();
    // Keep this stale candidate out of later observations.
    await env.DB.prepare("UPDATE issues SET due_date=NULL WHERE id=?")
      .bind(pending.id)
      .run();
  }
  await f.configure("America/New_York");
  await f.save();
  await (
    await import("./due-rule-current-state")
  ).proveCurrentDueRuleState(f, member, memberCookie);
  const held = await f.create({ dueDate: "2026-03-10" });
  await env.DB.prepare(
    "INSERT INTO vector_restore_status(id,import_id,effects_held) VALUES(1,'synthetic-vector-restore',1) ON CONFLICT(id) DO UPDATE SET effects_held=1",
  ).run();
  await tick("2026-03-08T07:00:00Z");
  expect((await f.detail(held.identifier)).cycle).toBeNull();
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM workspace_due_rule_runs WHERE issue_id=?",
    )
      .bind(held.id)
      .first("n"),
  ).toBe(0);
}
