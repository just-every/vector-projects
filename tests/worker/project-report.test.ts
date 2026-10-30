import {documentJourney,documentRoles} from './documents-scenario';
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { scheduled } from "../../src/core/app/scheduled";
import { bindings } from "./base-auth-fixture";
import { setupAdministration } from "./administration-fixture";
import { projectDetailSchema } from "../../src/core/features/projects/ui/data";

afterEach(() => vi.useRealTimers());

it("[REPORT-002] a project's scope and completion by day follow adds, moves, deletions and reopenings and project a completion date by the stated rule", async () => {
  const f = await setupAdministration();
  vi.useFakeTimers({ toFake: ["Date"] });
  const at = (date: string) => vi.setSystemTime(new Date(date));
  at("2026-08-01T12:00:00Z");
  const advance = async (date: string) => {
    at(date);
    await scheduled({scheduledTime:Date.now()},bindings);
  };
  await f.mutate("/settings", "PATCH", { timezone: "Australia/Brisbane" });
  const team = f.initial.teams[0];
  const status = (category: string) => team.statuses.find(s => s.category === category)!.id;
  const project = (await f.mutate("/settings/projects", "POST", { name: "Settlement reliability", leadOperatorId: f.owner })).projects.find(p => p.name === "Settlement reliability")!;
  const destination = (await f.mutate("/settings/projects", "POST", { name: "Settlement follow-through", leadOperatorId: f.owner })).projects.find(p => p.name === "Settlement follow-through")!;
  const detail = async () => {
    const response = await f.call("/projects/" + project.id);
    expect(response.status).toBe(200);
    return projectDetailSchema.parse(await response.json()).report;
  };
  const patch = async (identifier: string, changes: Record<string, unknown>) => {
    const current = await (await f.call("/issues/" + identifier)).json() as { version: number };
    const response = await f.call("/issues/" + identifier, "PATCH", { expectedVersion: current.version, ...changes });
    expect(response.status, await response.clone().text()).toBe(200);
  };
  const create = (title: string, category = "started") => f.create({ title, projectId: project.id, statusId: status(category) });
  await create("Completed outside the rate window", "completed");
  await advance("2026-09-01T00:00:00Z");
  const first = await create("Reconcile receipt totals"), moved = await create("Investigate provider latency"), erased = await create("Remove obsolete reconciliation work");
  const canceled = await create("Canceled experiment", "canceled");
  await advance("2026-09-01T14:30:00Z"); // September 2 in the workspace, still September 1 in UTC.
  await patch(first.identifier, { statusId: status("completed") });
  const added = await create("Repair interrupted callbacks");
  await advance("2026-09-03T00:00:00Z");
  await patch(moved.identifier, { projectId: destination.id });
  await patch(first.identifier, { statusId: status("started") });
  await advance("2026-09-04T00:00:00Z");
  await patch(first.identifier, { statusId: status("completed") });
  await advance("2026-09-05T00:00:00Z");
  await patch(added.identifier, { statusId: status("completed") });
  const insufficient = await detail();
  expect(insufficient.days.filter(d => d.date >= "2026-09-01").map(d => [d.date, d.scope, d.completed])).toEqual([
    ["2026-09-01", 4, 1], ["2026-09-02", 5, 2], ["2026-09-03", 4, 1], ["2026-09-04", 4, 2], ["2026-09-05", 4, 3],
  ]);
  expect(insufficient.days.find(d => d.date === "2026-09-03")?.removed).toEqual([moved.identifier]);
  expect(insufficient.projection).toMatchObject({ status: "not-enough-history", date: null, completions: 2 });
  await advance("2026-09-06T00:00:00Z");
  await create("Already completed reconciliation", "completed");
  const remaining = await create("Confirm settlement audit");
  const projected = await detail();
  expect(projected.projection).toMatchObject({ status: "projected", completions: 3, remaining: 2, date: "2026-09-25", windowStart: "2026-08-09", windowEnd: "2026-09-05" });
  at("2026-09-06T14:01:00Z"); // Before the first scheduled tick after the workspace midnight.
  const current = await (await f.call("/issues/" + erased.identifier)).json() as { version: number };
  expect((await f.call("/issues/" + erased.identifier, "DELETE", { expectedVersion: current.version, confirmed: true })).status).toBe(200);
  const afterDelete = await detail();
  expect(afterDelete.days.find(d => d.date === "2026-09-06")).toMatchObject({ scope: 6, completed: 4 });
  expect(afterDelete.days.at(-1)).toMatchObject({ date: "2026-09-07", scope: 5, completed: 4, removed: [erased.identifier] });
  expect(afterDelete.limitations.length).toBeGreaterThan(0);
  expect(afterDelete.projection).toMatchObject({ completions: 4, remaining: 1, date: "2026-09-14" });
  const captured = (await env.DB.prepare("SELECT day,scope,completed,completions FROM project_report_days WHERE project_id=? ORDER BY day").bind(project.id).all()).results;
  expect(captured.find(row=>row.day==="2026-09-06")).toMatchObject({scope:6,completed:4,completions:1});
  await scheduled({scheduledTime:Date.now()},bindings);
  expect((await env.DB.prepare("SELECT day,scope,completed,completions FROM project_report_days WHERE project_id=? ORDER BY day").bind(project.id).all()).results).toEqual(captured);
  expect(afterDelete.days.find(day=>day.date==="2026-08-01")).toMatchObject({scope:null,completed:null});
  const destinationResponse = await f.call("/projects/" + destination.id);
  expect(projectDetailSchema.parse(await destinationResponse.json()).report.days.at(-1)).toMatchObject({ scope: 1, completed: 0 });
  expect((await env.DB.prepare("SELECT count(*) AS n FROM issue_activity WHERE issue_id=?").bind(erased.id).first())?.n).toBe(0);
  await advance("2026-09-08T00:00:00Z");
  await patch(remaining.identifier, { statusId: status("completed") });
  expect((await detail()).projection).toMatchObject({ status: "nothing-remaining", date: null, remaining: 0 });
  for (const final of [{ lifecycle: "completed" }, { lifecycle: "canceled" }, { archived: true }]) {
    const closingDay = (await detail()).days.at(-1)!;
    at(new Date(Date.now() + 86400000).toISOString());
    await f.mutate("/settings/projects/" + project.id, "PATCH", final);
    const frozen = await detail();
    expect(frozen.source).toBe("snapshot");
    expect(frozen.days.find(day => day.date === closingDay.date)).toMatchObject({ scope: closingDay.scope, completed: closingDay.completed });
    const aggregateFinal = await env.DB.prepare("SELECT scope,completed FROM project_report_snapshots WHERE project_id=?").bind(project.id).first();
    expect(aggregateFinal).toEqual({scope:frozen.days.at(-1)?.scope,completed:frozen.days.at(-1)?.completed});
    expect(frozen.finalState).toBe("archived" in final ? "archived" : final.lifecycle);
    expect(frozen.projection).toMatchObject({ status: "final", date: null });
    at(new Date(Date.now() + 86400000).toISOString());
    await patch(first.identifier, { statusId: status("started") });
    await patch(canceled.identifier, { statusId: status("started") });
    expect(await detail()).toEqual(frozen);
    await f.mutate("/settings/projects/" + project.id, "PATCH", { lifecycle: "active", archived: false });
    expect((await detail()).source).toBe("live");
    await patch(first.identifier, { statusId: status("completed") });
    await patch(canceled.identifier, { statusId: status("canceled") });
  }
});

it('[PROJ-013 OPS-001 ROLE-002] documents retain project specs, ordered edits, initiative and team lists, search visibility and native parent archives',async()=>{await documentJourney();},180000);
it('[PROJ-013 ROLE-001 ROLE-013] document creation, edits, comments and specification writes follow each current role and invited parent',async()=>{await documentRoles();});
