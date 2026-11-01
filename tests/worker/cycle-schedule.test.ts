import { pausedCycleSchedule, proveTeamCyclesUpgrade } from "./team-cycles-journey";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { contractWith } from "../contract-tags";
import { setupAdministration } from "./administration-fixture";
import { bindings } from "./base-auth-fixture";
import { scheduled } from "../../src/core/app/scheduled";
const tick = (at: string) =>
  scheduled({ scheduledTime: Date.parse(at) }, bindings);
contractWith(
  it,
  "TEAM-005 CYCLE-007 CYCLE-004 CYCLE-006",
  "cadence creates three future cycles once, records automation, and supplies rollover before closure",
  async () => {
    const f = await setupAdministration(),
      team = f.initial.teams[0];
    await f.mutate("/settings", "PATCH", { timezone: "UTC" });
    const path = `/settings/teams/${team.id}/cycle-schedule`;
    const input = {
      weeks: 2,
      startWeekday: 1,
      cooldownWeeks: 1,
      upcomingCount: 3,
    };
    const state = await f.mutate(path, "PUT", input);
    const cycles = state.cycles.filter((c) => c.teamId === team.id);
    expect(cycles).toHaveLength(3);
    for (const c of cycles) {
      expect(new Date(c.startsAt).getUTCDay()).toBe(1);
      expect(Date.parse(c.endsAt) - Date.parse(c.startsAt)).toBe(14 * 86400000);
    }
    expect(Date.parse(cycles[1].startsAt) - Date.parse(cycles[0].endsAt)).toBe(
      7 * 86400000,
    );
    await tick(new Date().toISOString());
    await tick(new Date().toISOString());
    expect(
      (await f.state()).cycles.filter((c) => c.teamId === team.id),
    ).toEqual(cycles);
    const automation = await env.DB.prepare(
      "SELECT count(*) n FROM audit_records WHERE action='cycle.created.automation' AND actor_operator_id IS NULL",
    ).first<number>("n");
    expect(automation).toBe(3);
    const issue = await f.create({
      teamId: team.id,
      cycleId: cycles[0].id,
      statusId: team.statuses.find((s) => s.category === "started")!.id,
    });
    const at = new Date(Date.parse(cycles[0].endsAt) + 60000).toISOString();
    await tick(at);
    await tick(at);
    const current = await f.state();
    expect(
      current.cycles.filter((c) => c.teamId === team.id && c.startsAt > at),
    ).toHaveLength(3);
    expect(
      current.cycles.find((c) => c.id === cycles[0].id)!.closedAt,
    ).not.toBeNull();
    expect(
      await env.DB.prepare("SELECT cycle_id FROM issues WHERE id=?")
        .bind(issue.id)
        .first("cycle_id"),
    ).toBe(cycles[1].id);
    expect(
      await env.DB.prepare(
        "SELECT count(*) n FROM cycle_closure_failures WHERE cycle_id=?",
      )
        .bind(cycles[0].id)
        .first("n"),
    ).toBe(0);
    await pausedCycleSchedule(f,team.id,issue.id,cycles[0].id,new Date(Date.parse(cycles[1].endsAt)+60000).toISOString());
  },
);
contractWith(
  it,
  "TEAM-005 CYCLE-007",
  "cadence edits preserve started cycles and future identities, validate ranges and keep teams independent",
  async () => {
    await proveTeamCyclesUpgrade();
    const f = await setupAdministration();
    const team = (
      await f.mutate("/settings/teams", "POST", {
        name: "Cadence editing",
        identifierPrefix: "CAD",
      })
    ).teams.find((t) => t.identifierPrefix === "CAD")!;
    await f.mutate("/settings", "PATCH", { timezone: "UTC" });
    const now = Date.now();
    await f.mutate("/settings/cycles", "POST", {
      teamId: team.id,
      name: "Current delivery",
      startsLocal: new Date(now - 86400000).toISOString().slice(0, 16),
      endsLocal: new Date(now + 6 * 86400000).toISOString().slice(0, 16),
    });
    const path = `/settings/teams/${team.id}/cycle-schedule`,
      input = { weeks: 2, startWeekday: 1, cooldownWeeks: 1, upcomingCount: 3 };
    const before = await f.mutate(path, "PUT", input);
    const active = before.cycles.find((c) => c.name === "Current delivery")!;
    const future = before.cycles.filter(
      (c) => c.teamId === team.id && c.id !== active.id,
    );
    const after = await f.mutate(path, "PUT", {
      ...input,
      weeks: 8,
      startWeekday: new Date(active.endsAt).getUTCDay(),
      cooldownWeeks: 0,
    });
    expect(after.cycles.find((c) => c.id === active.id)).toEqual(active);
    expect(
      after.cycles
        .filter((c) => c.teamId === team.id && c.id !== active.id)
        .map((c) => c.id)
        .sort(),
    ).toEqual(future.map((c) => c.id).sort());
    for (const c of after.cycles.filter(
      (c) => c.teamId === team.id && c.id !== active.id,
    )) {
      expect(new Date(c.startsAt).getUTCDay()).toBe(
        new Date(active.endsAt).getUTCDay(),
      );
      expect(c.startsAt >= active.endsAt).toBe(true);
      expect(Date.parse(c.endsAt) - Date.parse(c.startsAt)).toBe(56 * 86400000);
    }
    for (const weeks of [0, 9])
      expect((await f.call(path, "PUT", { ...input, weeks })).status).toBe(400);
    const other = (
      await f.mutate("/settings/teams", "POST", {
        name: "Research",
        identifierPrefix: "RSCH",
      })
    ).teams.find((t) => t.identifierPrefix === "RSCH")!;
    await f.mutate(`/settings/teams/${other.id}/cycle-schedule`, "PUT", {
      ...input,
      weeks: 1,
      upcomingCount: 1,
    });
    const final = await f.state();
    expect(final.cycles.filter((c) => c.teamId === other.id)).toHaveLength(1);
    expect(final.cycles.filter((c) => c.teamId === team.id)).toEqual(
      after.cycles.filter((c) => c.teamId === team.id),
    );
  },
);
