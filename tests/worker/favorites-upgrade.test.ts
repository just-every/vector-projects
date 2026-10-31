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
  "[VIEW-010 DATA-011] the additive favorites upgrade preserves populated work and native archives retain personal identities and order",
  { timeout: 120_000 },
  async () => {
    await provePopulatedUpgrade(
      "0121_member_favorites.sql",
      {
        added: ["table member_favorites", "trigger member_favorites_removed"],
        removed: [],
      },
      ["issues", "projects", "operators"],
    );
    const cookie = await signIn(
      "sarah" + String.fromCharCode(64) + "vector.test",
    );
    const call = (path: string, method = "GET", input?: unknown) =>
      request("/api" + path, method, input, cookie, {
        FIRST_OWNER_EMAIL: "sarah" + String.fromCharCode(64) + "vector.test",
      });
    const owner = await actor(cookie);
    const issue = (await env.DB.prepare("SELECT id FROM issues LIMIT 1").first<{
      id: string;
    }>())!;
    const project = (await env.DB.prepare(
      "SELECT id FROM projects LIMIT 1",
    ).first<{ id: string }>())!;
    const view = await read(
      await call("/views", "POST", {
        name: "synthetic-vector-upgraded-view",
        query: {},
      }),
      201,
    );
    const input: FavoriteWrite = {
      expectedVersion: 0,
      folders: [{ id: "upgrade", name: "Upgrade folder" }],
      entries: [
        { kind: "view", subjectId: view.id, folderId: "upgrade" },
        { kind: "issue", subjectId: issue.id, folderId: null },
        { kind: "project", subjectId: project.id, folderId: null },
      ],
    };
    await read(await call("/favorites", "PUT", input));
    const records = await httpExport(call);
    const rows = records
      .flatMap((record) => (record.kind === "part" ? record.items : []))
      .flatMap((item) =>
        item.kind === "row" && item.table === "member_favorites"
          ? [item.row]
          : [],
      );
    expect(rows).toContainEqual(
      expect.objectContaining({
        operator_id: owner,
        version: 1,
        folders_json: JSON.stringify(input.folders),
        entries_json: JSON.stringify(input.entries),
      }),
    );
    expect(
      (await read(await call("/favorites"))).entries.map(
        (e: any) => e.subjectId,
      ),
    ).toEqual(input.entries.map((e) => e.subjectId));
  },
);
