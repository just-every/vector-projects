import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { collaborationFixture } from "./collaboration-fixture";
import { confirm, invite, mailToken, request } from "./base-auth-fixture";
import { issueListSchema, type IssueListData } from "../../src/core/features/issues/list-schema";
import { savedViewSchema } from "../../src/core/features/views/schema";

type Issue = { id: string; identifier: string; version: number };
export async function issueGroupingJourney() {
  const f = await collaborationFixture();
  const marker = "synthetic-vector-7001";
  const team = f.initial.teams[0];
  const other = (await f.mutate("/settings/teams", "POST", {
    name: "synthetic-vector-7002", identifierPrefix: "GROUP", isPrivate: true,
  })).teams.find(t => t.identifierPrefix === "GROUP")!;
  const json = async (response: Response, status = 200): Promise<any> => {
    expect(response.status, await response.clone().text()).toBe(status);
    return response.json();
  };
  const parents: Issue[] = [];
  for (const teamId of [team.id, team.id, other.id]) parents.push(await json(await f.call("/issues", "POST", {
    teamId, title: teamId === other.id ? "synthetic-vector-private-parent" : "synthetic-vector-parent", priority: "low",
  }), 201));
  const milestones: { id: string; projectId: string }[] = [];
  const project = (await f.mutate("/settings/projects", "POST", {
    name: "synthetic-vector-7003", leadOperatorId: f.owner,
  })).projects.find(p => p.name === "synthetic-vector-7003")!;
  for (let n = 0; n < 2; n++) {
    const detail = await json(await f.call(`/settings/projects/${project.id}/milestones`, "POST", { name: "Same milestone" }));
    milestones.push(detail.milestones.at(-1));
  }
  const issues: Issue[] = [];
  for (let n = 0; n < 55; n++) {
    const issue = await json(await f.call("/issues", "POST", {
      teamId: n === 53 ? other.id : team.id, title: `${marker} ${n}`, priority: "high",
      projectId: project.id, milestoneId: n < 51 ? milestones[0].id : n === 51 ? milestones[1].id : null,
    }), 201);
    if (n < 52 || n === 53) await json(await f.call(`/issues/${issue.identifier}/parent`, "PATCH", {
      expectedVersion: issue.version, parentIdentifier: parents[n < 51 ? 0 : n === 51 ? 1 : 2].identifier,
    }));
    issues.push(issue);
  }
  await json(await f.call("/issues", "POST", { teamId: team.id, title: marker + " excluded", priority: "low" }), 201);
  // A visible child retains its private parent edge in storage, never its reader projection.
  await json(await f.call(`/issues/${issues[52].identifier}/parent`, "PATCH", {
    expectedVersion: issues[52].version, parentIdentifier: parents[2].identifier,
  }));
  const list = async (cookie: string, grouping: string, extra: Record<string, string> = {}) => {
    const response = await f.any(cookie, "/issues?" + new URLSearchParams({ q: marker, priority: "high", sort: "oldest", grouping, ...extra }));
    return issueListSchema.parse(await json(response));
  };
  const counts = (data: IssueListData) => Object.fromEntries(data.allGroups!.map(g => [g.key, g.count]));
  const expectedKeys = { milestone: [milestones[0].id, milestones[1].id], parent: [parents[0].id, parents[1].id] };
  const views: Record<string, any> = {};
  for (const grouping of ["milestone", "parent"] as const) {
    const first = await list(f.bobCookie, grouping);
    expect(first.total).toBe(54);
    expect(first.issues).toHaveLength(50);
    expect(counts(first)).toEqual({ [expectedKeys[grouping][0]]: 51, [expectedKeys[grouping][1]]: 1, none: 2 });
    expect(first.allGroups!.reduce((n, g) => n + g.count, 0)).toBe(first.total);
    if (grouping === "milestone") expect(first.allGroups!.filter(g => g.name === "Same milestone")).toHaveLength(2);
    else for (const parent of parents.slice(0, 2)) expect(first.allGroups!.find(g => g.key === parent.id)?.name).toBe(parent.identifier + ": synthetic-vector-parent");
    const second = await list(f.bobCookie, grouping, { offset: "50", revision: first.revision });
    expect(second.allGroups).toEqual(first.allGroups);
    const rows = [...first.issues, ...second.issues];
    expect(rows.map(i => i.identifier).sort()).toEqual(issues.filter((_, n) => n !== 53).map(i => i.identifier).sort());
    expect(new Set(rows.map(i => i.id)).size).toBe(54);
    for (const group of first.allGroups!) expect(rows.filter(i => i.groupKey === group.key)).toHaveLength(group.count);
    const hidden = JSON.stringify([first, second]);
    for (const value of [parents[2].id, parents[2].identifier, "synthetic-vector-private-parent", issues[53].identifier]) expect(hidden).not.toContain(value);
    expect(rows.find(i => i.id === issues[52].id)?.parent).toBeNull();
    expect((await f.any(f.bobCookie, "/issues?" + new URLSearchParams({ q: marker, priority: "high", sort: "oldest", grouping: grouping === "parent" ? "milestone" : "parent", offset: "50", revision: first.revision }))).status).toBe(409);
    const view = savedViewSchema.parse(await json(await f.any(f.bobCookie, "/views", "POST", {
      name: marker + " " + grouping, isShared: true, query: { q: marker, priority: "high", sort: "oldest", grouping },
    }), 201));
    views[grouping] = view;
    expect(savedViewSchema.parse(await f.data(f.caraCookie, "/views/" + view.id))).toEqual(view);
    expect((await list(f.caraCookie, view.query.grouping)).allGroups).toEqual(first.allGroups);
    expect((await f.any(f.bobCookie, "/preferences/issues", "PUT", { filters: { q: marker }, sort: "oldest", grouping })).status).toBe(200);
    expect(await f.data(f.bobCookie, "/preferences/issues")).toMatchObject({ grouping, sort: "oldest", filters: { q: marker } });
  }
  const beforeRename = await list(f.bobCookie, "milestone");
  await json(await f.call(`/settings/projects/${project.id}/milestones/${milestones[0].id}`, "PATCH", { name: "Renamed milestone" }));
  expect((await f.any(f.bobCookie, "/issues?" + new URLSearchParams({ q: marker, priority: "high", sort: "oldest", grouping: "milestone", offset: "50", revision: beforeRename.revision }))).status).toBe(409);
  const renamed = await list(f.bobCookie, "milestone");
  expect(renamed.allGroups!.find(g => g.key === milestones[0].id)).toEqual({ key: milestones[0].id, name: "Renamed milestone", count: 51 });
  await json(await f.call(`/settings/projects/${project.id}/milestones/${milestones[0].id}`, "PATCH", { name: "Same milestone" }));
  await f.mutate(`/settings/teams/${other.id}/members/${f.bob}`, "PUT", { role: "member" });
  const admitted = await list(f.bobCookie, "parent");
  expect(counts(admitted)).toEqual({ [parents[0].id]: 51, [parents[1].id]: 1, [parents[2].id]: 2, none: 1 });
  await f.mutate(`/settings/teams/${other.id}/members/${f.bob}`, "DELETE");
  expect((await f.any(f.bobCookie, "/issues?" + new URLSearchParams({ q: marker, priority: "high", sort: "oldest", grouping: "parent", offset: "50", revision: admitted.revision }))).status).toBe(409);
  expect(counts(await list(f.bobCookie, "parent"))).toEqual({ [parents[0].id]: 51, [parents[1].id]: 1, none: 2 });
  expect(await f.data(f.bobCookie, "/views/" + views.parent.id)).toEqual(views.parent);
  const guestEmail = ["synthetic-vector-7004", "vector.test"].join(String.fromCharCode(64));
  expect((await f.call("/settings/operators/invite", "POST", { email: guestEmail, displayName: "Guest grouping", role: "guest", teamIds: [team.id] })).status).toBe(202);
  const guestCookie = await confirm(await mailToken(guestEmail));
  const viewerEmail = ["synthetic-vector-7005", "vector.test"].join(String.fromCharCode(64));
  const viewerCookie = await invite(viewerEmail, f.cookie, "viewer");
  for (const cookie of [guestCookie, viewerCookie]) for (const grouping of ["parent", "milestone"]) {
    const data = await list(cookie, grouping);
    expect(data.total).toBe(54);
    expect(counts(data)).toEqual({ [expectedKeys[grouping as keyof typeof expectedKeys][0]]: 51, [expectedKeys[grouping as keyof typeof expectedKeys][1]]: 1, none: 2 });
    expect(JSON.stringify(data)).not.toContain(parents[2].identifier);
  }
  const stored = (await env.DB.prepare("SELECT * FROM saved_views ORDER BY id").all()).results;
  for (const grouping of ["parent", "milestone"]) {
    const view = views[grouping];
    expect(savedViewSchema.parse(await f.data(viewerCookie, "/views/" + view.id))).toEqual(view);
    for (const [path, method, body] of [
      ["/views", "POST", { name: "Refused", query: view.query }],
      ["/views/" + view.id, "PATCH", { query: { ...view.query, grouping: "none" } }],
      ["/views/" + view.id, "DELETE", undefined],
    ] as const) expect((await f.any(viewerCookie, path, method, body)).status).toBe(403);
  }
  expect((await env.DB.prepare("SELECT * FROM saved_views ORDER BY id").all()).results).toEqual(stored);
  expect((await request("/auth/signout", "POST", {}, guestCookie)).status).toBe(204);
  expect((await f.any(guestCookie, "/issues?grouping=parent")).status).toBe(401);
}
