import { createApiApp } from "../../src/core/app/api";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { setupAdministration } from "./administration-fixture";
import { actor, invite, request, signIn, bindings } from "./base-auth-fixture";
import { snapshot } from "./role-fixture";
import { provePopulatedUpgrade } from "./populated-upgrade";
import {
  favoritesSchema,
  type FavoriteWrite,
} from "../../src/core/features/favorites/schema";
import { createUlid } from "../../src/core/shared/ids";
import { httpExport } from "./http-archive-fixture";

const read = async (response: Response, status = 200): Promise<any> => {
  expect(response.status, await response.clone().text()).toBe(status);
  return response.json();
};
const email = (name: string) =>
  [name, "vector.test"].join(String.fromCharCode(64));
const tables = [
  "member_favorites",
  "saved_views",
  "issues",
  "projects",
  "issue_activity",
];

it(
  "[VIEW-010] personal native favorites preserve order and folders across sessions, fence replay and hide withdrawn or deleted subjects",
  { timeout: 120_000 },
  async () => {
    const f = await setupAdministration();
    const memberEmail = email("synthetic-vector-favorites-member");
    const cookie = await invite(memberEmail, f.cookie),
      member = await actor(cookie);
    const secondCookie = await signIn(memberEmail);
    expect(secondCookie).not.toBe(cookie);
    const other = await invite(
      email("synthetic-vector-favorites-other"),
      f.cookie,
    );
    const call = (
      path: string,
      method = "GET",
      input?: unknown,
      session = cookie,
    ) => request("/api" + path, method, input, session);
    const team = (
      await f.mutate("/settings/teams", "POST", {
        name: "synthetic-vector-favorites-private",
        identifierPrefix: "FAVPR",
        isPrivate: true,
      })
    ).teams.find((t) => t.identifierPrefix === "FAVPR")!;
    await read(
      await f.call(`/settings/teams/${team.id}/members/${member}`, "PUT", {
        role: "member",
      }),
    );
    const project = (
      await f.mutate("/settings/projects", "POST", {
        name: "synthetic-vector-hidden-project-title",
        leadOperatorId: f.owner,
      })
    ).projects.find((p) => p.name === "synthetic-vector-hidden-project-title")!;
    const issue = await f.create({
      title: "synthetic-vector-favorite-issue",
      teamId: team.id,
      projectId: project.id,
    });
    const view = await read(
      await call("/views", "POST", {
        name: "synthetic-vector-favorite-view",
        query: { team: team.id },
        isShared: false,
      }),
      201,
    );
    const definition = await snapshot(["saved_views"]);
    expect(await read(await call("/favorites"))).toEqual({
      version: 0,
      folders: [],
      entries: [],
    });
    const selection = (kind: string, key: string) =>
      "/favorites?" +
      new URLSearchParams({ currentKind: kind, currentKey: key });
    const subjects = [];
    for (const [kind, key] of [
      ["issue", issue.identifier],
      ["project", project.id],
      ["view", view.id],
    ]) {
      const subject = await read(
        await call(`/favorites/subjects/${kind}/${key}`),
      );
      subjects.push(subject);
      expect((await read(await call(selection(kind, key)))).current).toEqual(
        subject,
      );
    }
    expect(subjects.map((s) => s.subjectId)).toEqual([
      issue.id,
      project.id,
      view.id,
    ]);
    const pinned: FavoriteWrite = {
      expectedVersion: 0,
      folders: [],
      entries: subjects.map((s) => ({
        kind: s.kind,
        subjectId: s.subjectId,
        folderId: null,
      })),
    };
    expect(
      favoritesSchema
        .parse(await read(await call("/favorites", "PUT", pinned)))
        .entries.map((e) => e.title),
    ).toEqual(["synthetic-vector-favorite-issue", project.name, view.name]);
    const organized: FavoriteWrite = {
      expectedVersion: 1,
      folders: [{ id: "delivery", name: "Delivery work" }],
      entries: [
        { kind: "project", subjectId: project.id, folderId: null },
        { kind: "issue", subjectId: issue.id, folderId: null },
        { kind: "view", subjectId: view.id, folderId: "delivery" },
      ],
    };
    await read(await call("/favorites", "PUT", organized));
    const reopened = favoritesSchema.parse(
      await read(await call("/favorites", "GET", undefined, secondCookie)),
    );
    expect(reopened.version).toBe(2);
    expect(reopened.folders).toEqual(organized.folders);
    expect(
      reopened.entries.map(({ kind, subjectId, folderId }) => ({
        kind,
        subjectId,
        folderId,
      })),
    ).toEqual(organized.entries);
    expect(
      await read(await call("/favorites", "GET", undefined, other)),
    ).toEqual({ version: 0, folders: [], entries: [] });
    const before = await snapshot(tables);
    for (const stale of [pinned, organized])
      await read(await call("/favorites", "PUT", stale, secondCookie), 409);
    expect(await snapshot(tables)).toEqual(before);
    await read(
      await call("/favorites", "PUT", {
        ...organized,
        expectedVersion: 2,
        entries: [...organized.entries, organized.entries[0]],
      }),
      400,
    );
    // Concurrent independently authenticated writes admit exactly one version.
    const concurrent = await Promise.all(
      [cookie, secondCookie].map((session) =>
        call(
          "/favorites",
          "PUT",
          { ...organized, expectedVersion: 2 },
          session,
        ),
      ),
    );
    expect(concurrent.map((r) => r.status).sort()).toEqual([200, 409]);
    for (const response of concurrent) await response.text();
    expect((await read(await call("/favorites"))).version).toBe(3);
    const revoked = await signIn(memberEmail);
    expect((await request("/auth/signout", "POST", {}, revoked)).status).toBe(
      204,
    );
    const active = await snapshot(tables);
    await read(
      await call(
        "/favorites",
        "PUT",
        { ...organized, expectedVersion: 3 },
        revoked,
      ),
      401,
    );
    expect(await snapshot(tables)).toEqual(active);
    // Foreign workspace identities cannot be pinned, and moving the active actor
    // cannot expose the collection retained under their previous workspace.
    const foreignWorkspace = createUlid(new Date());
    await env.DB.prepare(
      "INSERT INTO workspace_settings(id,name,timezone,created_at,updated_at) VALUES(?,?,?,?,?)",
    )
      .bind(
        foreignWorkspace,
        "synthetic-vector-other-workspace",
        "UTC",
        "now",
        "now",
      )
      .run();
    const workspaceCall = (method = "GET", input?: unknown) =>
      createApiApp().request(
        bindings.APP_ORIGIN + "/favorites",
        {
          method,
          headers: {
            host: new URL(bindings.APP_ORIGIN).host,
            origin: bindings.APP_ORIGIN,
            cookie,
            "content-type": "application/json",
          },
          body: input === undefined ? undefined : JSON.stringify(input),
        },
        bindings,
      );
    const workspace = await env.DB.prepare(
      "SELECT workspace_id FROM operators WHERE id=?",
    )
      .bind(member)
      .first<string>("workspace_id");
    await env.DB.prepare("UPDATE operators SET workspace_id=? WHERE id=?")
      .bind(foreignWorkspace, member)
      .run();
    expect(await read(await workspaceCall())).toEqual({
      version: 0,
      folders: [],
      entries: [],
    });
    await read(
      await workspaceCall("PUT", { ...pinned, expectedVersion: 0 }),
      404,
    );
    await env.DB.prepare("UPDATE operators SET workspace_id=? WHERE id=?")
      .bind(workspace, member)
      .run();
    await env.DB.prepare("DELETE FROM workspace_settings WHERE id=?")
      .bind(foreignWorkspace)
      .run();
    // Current membership is evaluated before any subject title is selected.
    await read(
      await f.call(`/settings/teams/${team.id}/members/${member}`, "DELETE"),
    );
    const withdrawn = await read(await call("/favorites"));
    expect(withdrawn.entries).toEqual([]);
    const responseText = JSON.stringify(withdrawn);
    for (const title of [
      "synthetic-vector-favorite-issue",
      project.name,
      view.name,
    ])
      expect(responseText).not.toContain(title);
    for (const [kind, key] of [
      ["issue", issue.identifier],
      ["project", project.id],
      ["view", view.id],
    ]) {
      await read(await call(`/favorites/subjects/${kind}/${key}`), 404);
      const navigation = await read(await call(selection(kind, key)));
      expect(navigation.current).toBeNull();
      expect(navigation.entries).toEqual([]);
      for (const title of [issue.title, project.name, view.name])
        expect(JSON.stringify(navigation)).not.toContain(title);
    }
    const missing = await read(
      await call(selection("issue", createUlid(new Date()))),
    );
    expect(missing.current).toBeNull();
    await read(await call("/favorites?currentKind=issue"), 400);
    await read(await call(selection("team", team.id)), 400);
    const withdrawnSnapshot = await snapshot(tables);
    await read(
      await call("/favorites", "PUT", { ...organized, expectedVersion: 3 }),
      404,
    );
    expect(await snapshot(tables)).toEqual(withdrawnSnapshot);
    await read(
      await f.call(`/settings/teams/${team.id}/members/${member}`, "PUT", {
        role: "member",
      }),
    );
    expect((await read(await call("/favorites"))).entries).toHaveLength(3);
    // Use a shared view to retain the definition while its author unpins it.
    await read(await call("/views/" + view.id, "PATCH", { isShared: true }));
    const currentDefinition = await snapshot(["saved_views"]);
    const unpinned = await read(
      await call("/favorites", "PUT", {
        expectedVersion: 3,
        folders: organized.folders,
        entries: organized.entries.filter((e) => e.kind !== "view"),
      }),
    );
    expect(unpinned.entries).toHaveLength(2);
    expect(await snapshot(["saved_views"])).toEqual(currentDefinition);
    // Re-pin then delete through the real view door; no cached name is returned.
    await read(
      await call("/favorites", "PUT", { ...organized, expectedVersion: 4 }),
    );
    await read(await call("/views/" + view.id, "DELETE"));
    expect(JSON.stringify(await read(await call("/favorites")))).not.toContain(
      view.name,
    );
    const latest = await read(await f.call("/issues/" + issue.identifier));
    await read(
      await f.call("/issues/" + issue.identifier, "DELETE", {
        expectedVersion: latest.version,
        confirmed: true,
      }),
    );
    expect(
      (await read(await call("/favorites"))).entries.map((e: any) => e.kind),
    ).not.toContain("issue");
    expect(await snapshot(["saved_views"])).not.toEqual(definition);
    // Personal state is erased with the existing member-removal semantics. A
    // delayed request from either old session cannot recreate it.
    await read(await f.call("/settings/operators/" + member, "DELETE"));
    expect(
      await env.DB.prepare("SELECT * FROM member_favorites WHERE operator_id=?")
        .bind(member)
        .first(),
    ).toBeNull();
    await read(
      await call(
        "/favorites",
        "PUT",
        { expectedVersion: 0, folders: [], entries: [] },
        secondCookie,
      ),
      401,
    );
    expect(
      await env.DB.prepare("SELECT * FROM member_favorites WHERE operator_id=?")
        .bind(member)
        .first(),
    ).toBeNull();
  },
);
