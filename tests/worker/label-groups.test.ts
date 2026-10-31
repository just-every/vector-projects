import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { roleWorkspace, snapshot, resetLimits } from "./role-fixture";
import { beforeBatch } from "./administration-fixture";
import { invite, request } from "./base-auth-fixture";
import type { Administration } from "../../src/core/features/administration/schema";
import { updateLabel } from "../../src/core/features/administration/labels";
import { renameLabelGroup, removeLabelGroup } from "../../src/core/features/administration/label-groups";

const stored = ["issues", "issue_labels", "issue_activity", "labels", "label_groups", "audit_records"];

it("[ISSUE-014] an Owner groups two workspace labels and every issue writer refuses both on one issue without a partial write", async () => {
  const w = await roleWorkspace(), owner = w.people.owner;
  const json = async (response: Response, status = 200) => { expect(response.status, await response.clone().text()).toBe(status); return response.json() as Promise<any>; };
  const label = async (name: string) => (await json(await owner.call("/settings/labels", "POST", { name, color: "#224466" }) )).labels.find((row: any) => row.name === name).id as string;
  const [area1, area2, type1, type2, plain] = [await label("Area web"), await label("Area api"), await label("Type bug"), await label("Type chore"), await label("Plain")];

  // Definition: a group has a stable id, labels join it by id, and everything survives a reload.
  const made = await json(await owner.call("/settings/label-groups", "POST", { name: "Area" })) as Administration;
  const area = made.labelGroups.find((group) => group.name === "Area")!;
  expect((await owner.call("/settings/label-groups", "POST", { name: "area" })).status, "group names are unique ignoring case").toBe(409);
  for (const id of [area1, area2]) await json(await owner.call(`/settings/labels/${id}`, "PATCH", { groupId: area.id }));
  const renamed = await json(await owner.call(`/settings/label-groups/${area.id}`, "PATCH", { name: "Component" })) as Administration;
  expect(renamed.labelGroups).toEqual([{ id: area.id, name: "Component" }]);
  expect(renamed.labels.filter((row) => row.groupId === area.id).map((row) => row.name).sort()).toEqual(["Area api", "Area web"]);
  const options = await json(await request("/api/options", "GET", undefined, owner.cookie));
  expect(options.labels.filter((row: any) => row.groupId === area.id).map((row: any) => row.groupName)).toEqual(["Component", "Component"]);
  expect(options.labels.find((row: any) => row.id === plain)).toMatchObject({ groupId: null, groupName: null });

  // Creation: one grouped label is valid; both are refused and nothing is stored.
  const team = w.team.id, create = (labelIds: string[], who = owner) => who.call("/issues", "POST", { title: "Grouped work", teamId: team, labelIds });
  const first = await json(await create([area1, plain]), 201);
  let before = await snapshot(stored);
  const refused = await create([area1, area2]);
  expect([refused.status, (await refused.json()).message]).toEqual([400, "Choose at most one label from the Component group."]);
  expect(await snapshot(stored)).toEqual(before);

  // Update (session and scoped doors) swaps within the group but never holds two.
  const patch = (call: typeof owner.call, id: string, version: number, labelIds: string[]) => call(`/issues/${id}`, "PATCH", { expectedVersion: version, labelIds });
  expect((await patch(owner.call, first.identifier, first.version, [area1, area2])).status).toBe(400);
  expect((await patch(owner.api, first.identifier, first.version, [area1, area2, plain])).status).toBe(400);
  expect(await snapshot(stored)).toEqual(before);
  const swapped = await json(await patch(owner.call, first.identifier, first.version, [area2, plain]));
  expect(swapped.labels.map((row: any) => row.id).sort()).toEqual([area2, plain].sort());

  // Bulk: one conflicting selection refuses every issue.
  const second = await json(await create([type1]), 201);
  before = await snapshot(stored);
  const bulk = (labelIds: string[]) => owner.call("/issues/bulk", "POST", { issues: [{ identifier: swapped.identifier, expectedVersion: swapped.version }, { identifier: second.identifier, expectedVersion: second.version }], changes: { labelIds } });
  expect((await bulk([area1, area2])).status).toBe(409);
  expect(await snapshot(stored)).toEqual(before);
  expect((await bulk([area1])).status).toBe(200);

  // Copy keeps a valid single-label selection.
  const current = await json(await owner.call(`/issues/${swapped.identifier}`));
  const copy = await json(await owner.call(`/issues/${swapped.identifier}/copy`, "POST", { expectedVersion: current.version }), 201);
  expect(copy.issue.labels.map((row: any) => row.id)).toEqual([area1]);

  // Definition conflicts: a second group over two labels already together is refused unchanged.
  const together = await json(await create([type1, type2]), 201);
  const type = (await json(await owner.call("/settings/label-groups", "POST", { name: "Type" })) as Administration).labelGroups.find((g) => g.name === "Type")!;
  await json(await owner.call(`/settings/labels/${type1}`, "PATCH", { groupId: type.id }));
  before = await snapshot(stored);
  expect((await owner.call(`/settings/labels/${type2}`, "PATCH", { groupId: type.id })).status).toBe(409);
  expect(await snapshot(stored)).toEqual(before);
  // A merge that would leave an issue with two labels of the destination's group is refused unchanged.
  const [one, two] = [await label("Merge one"), await label("Merge two")];
  const merge = (await json(await owner.call("/settings/label-groups", "POST", { name: "Merge" })) as Administration).labelGroups.find((g) => g.name === "Merge")!;
  for (const id of [one, two]) await json(await owner.call(`/settings/labels/${id}`, "PATCH", { groupId: merge.id }));
  const mixed = await json(await create([area1, one]), 201);
  before = await snapshot(stored);
  expect((await owner.call(`/settings/labels/${area1}/merge`, "POST", { destinationLabelId: two })).status, mixed.identifier).toBe(409);
  expect(await snapshot(stored)).toEqual(before);
  // Merging inside one group relabels every issue and keeps the single selection.
  await json(await owner.call(`/settings/labels/${area2}/merge`, "POST", { destinationLabelId: area1 }));
  expect((await env.DB.prepare("SELECT count(*) n FROM issue_labels WHERE label_id=?").bind(area2).first<{ n: number }>())!.n).toBe(0);

  // Concurrent group definition: the writer's own transaction refuses what its pre-check admitted.
  const racing = await json(await create([type1]), 201);
  const grouped = beforeBatch(async () => { await json(await owner.call(`/settings/labels/${plain}`, "PATCH", { groupId: type.id })); });
  before = await snapshot(["issues", "issue_labels", "issue_activity"]);
  const raced = await request(`/api/issues/${racing.identifier}`, "PATCH", { expectedVersion: racing.version, labelIds: [type1, plain] }, owner.cookie, { DB: grouped });
  expect(raced.status).toBe(400);
  expect(await snapshot(["issues", "issue_labels", "issue_activity"])).toEqual(before);

  // Deleting a group frees its labels and removes no issue.
  const issues = (await env.DB.prepare("SELECT count(*) n FROM issues").first<{ n: number }>())!.n;
  const freed = await json(await owner.call(`/settings/label-groups/${type.id}`, "DELETE")) as Administration;
  expect(freed.labelGroups.map((group) => group.name)).toEqual(["Component", "Merge"]);
  expect(freed.labels.filter((row) => row.groupId === type.id)).toEqual([]);
  expect((await env.DB.prepare("SELECT count(*) n FROM issues").first<{ n: number }>())!.n).toBe(issues);
  expect((await create([type1, type2])).status).toBe(201);
}, 120_000);

it("[ISSUE-014] label groups are Owner and Admin management; a Guest applies one label, a Viewer none, and another workspace's groups stay out of reach", async () => {
  const w = await roleWorkspace(), owner = w.people.owner;
  const groupId = async () => ((await (await owner.call("/settings/label-groups", "POST", { name: "Area" })).json()) as Administration).labelGroups.find((group) => group.name === "Area")!.id;
  const labelIds = [] as string[];
  for (const name of ["Guest one", "Guest two"]) {
    const state = (await (await owner.call("/settings/labels", "POST", { name, color: "#224466" })).json()) as Administration;
    labelIds.push(state.labels.find((row) => row.name === name)!.id);
  }
  const area = await groupId();
  for (const id of labelIds) expect((await w.people.admin.call(`/settings/labels/${id}`, "PATCH", { groupId: area })).status, "an Admin manages groups").toBe(200);

  // Members and Guests cannot define, rename, delete or place labels; the refusal changes nothing.
  const before = await snapshot(stored);
  for (const who of [w.people.member, w.people.lead, w.people.guest]) {
    for (const [path, method, body] of [["/settings/label-groups", "POST", { name: "Mine" }], [`/settings/label-groups/${area}`, "PATCH", { name: "Mine" }], [`/settings/label-groups/${area}`, "DELETE", undefined], [`/settings/labels/${labelIds[0]}`, "PATCH", { groupId: null }]] as const)
      expect((await who.call(path, method, body)).status, `${method} ${path}`).toBe(403);
    expect((await who.api("/labels", "POST", { name: "Sneaky", color: "#224466", groupId: area })).status, "scoped creation into a group").toBe(403);
  }
  expect(await snapshot(stored)).toEqual(before);

  // A Guest in the invited team applies one grouped label and is refused both; a Viewer is refused outright.
  const issue = await (await owner.call("/issues", "POST", { title: "Guest work", teamId: w.team.id })).json() as any;
  const guest = (labelIds_: string[], version: number) => w.people.guest.call(`/issues/${issue.identifier}`, "PATCH", { expectedVersion: version, labelIds: labelIds_ });
  expect((await guest(labelIds, issue.version)).status).toBe(400);
  expect((await guest([labelIds[0]], issue.version)).status).toBe(200);
  await resetLimits();
  const viewerName = "viewer-labels";
  const viewer = await invite(`${viewerName}@roles.test`, owner.cookie, "viewer");
  const stable = await snapshot(stored);
  expect((await request(`/api/issues/${issue.identifier}`, "PATCH", { expectedVersion: issue.version + 1, labelIds: [labelIds[1]] }, viewer)).status).toBe(403);
  expect(await snapshot(stored)).toEqual(stable);

  // Another workspace's group can be neither placed on nor managed from this workspace.
  await env.DB.batch([
    env.DB.prepare("INSERT INTO workspace_settings(id,name,timezone,created_at,updated_at) VALUES('synthetic-vector-foreign','Foreign','UTC','now','now')"),
    env.DB.prepare("INSERT INTO label_groups(id,workspace_id,name,created_at,updated_at) VALUES('synthetic-vector-foreign-group','synthetic-vector-foreign','Area','now','now')"),
  ]);
  const foreignBefore = await snapshot(["labels", "label_groups"]);
  const settings = { status: 409 };
  await expect(updateLabel(env.DB, owner.id, labelIds[0], { groupId: "synthetic-vector-foreign-group" })).rejects.toMatchObject(settings);
  await expect(renameLabelGroup(env.DB, owner.id, "synthetic-vector-foreign-group", { name: "Taken" })).rejects.toMatchObject({ status: 404 });
  await expect(removeLabelGroup(env.DB, owner.id, "synthetic-vector-foreign-group")).rejects.toMatchObject({ status: 404 });
  expect(await snapshot(["labels", "label_groups"])).toEqual(foreignBefore);
}, 120_000);
