import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { createServerApp } from "../../src/core/app/server";
import { setupAdministration } from "./administration-fixture";
import { actor, bindings, invite, request } from "./base-auth-fixture";
import { tokenScopes } from "../../src/core/features/integrations/scopes";

export type Kind = "owner" | "admin" | "lead" | "member" | "guest";
type Call = (path: string, method?: string, body?: unknown) => Promise<Response>;
export type Person = { id: string; cookie: string; token: string; call: Call; api: Call };
const app = createServerApp();
/** A personal API token, minted before any Guest conversion: it then acts with
 * whatever role its member holds on each request. */
async function person(cookie: string): Promise<Person> {
  const call: Call = (path, method = "GET", body) => request("/api" + path, method, body, cookie);
  const minted = await call("/settings/integrations/tokens", "POST", { name: "Role journey", scopes: [...tokenScopes,'issue-templates:read','issue-templates:write','initiatives:read','initiatives:write','releases:read','releases:write'] });
  expect(minted.status).toBe(201);
  const token = ((await minted.json()) as { token: string }).token;
  const api: Call = (path, method = "GET", body) => app.request(bindings.APP_ORIGIN + "/api/v1" + path, {
    method, headers: { Authorization: "Bearer " + token, "content-type": "application/json", host: new URL(bindings.APP_ORIGIN).host },
    body: body === undefined ? undefined : JSON.stringify(body) }, bindings);
  return { id: await actor(cookie), cookie, token, call, api };
}

let workspaces = 0, people = 0;
/** The people of the role-matrix journey (ROLE-001): an Owner, an Admin, a
 * Member who owns the team, a Member who does not and a Guest in that team.
 * Guest conversion goes through the real role door after minting a Member
 * token, proving retained tokens follow current role and membership. Cases in one file share a database, so each gets
 * its own team and people. */
export async function roleWorkspace() {
  const f = await setupAdministration();
  const run = String.fromCharCode(65 + workspaces++);
  const team = (await f.mutate("/settings/teams", "POST", { name: `Roles ${run}`, identifierPrefix: `ROLE${run}` })).teams.find((t) => t.name === `Roles ${run}`)!;
  /** Another person of the given kind, in the team unless they are its outsider. */
  const fresh = async (kind: Kind, inTeam = true) => {
    await resetLimits();
    const cookie = await invite(`${kind}-${run.toLowerCase()}${people++}@roles.test`, f.cookie, kind === "owner" || kind === "admin" ? kind : undefined);
    const made = await person(cookie);
    if (inTeam && kind !== "owner" && kind !== "admin")
      expect((await f.call(`/settings/teams/${team.id}/members/${made.id}`, "PUT", { role: kind === "lead" ? "owner" : "member" })).status).toBe(200);
    if (kind === "guest") {
      const assigned = await f.call(`/settings/operators/${made.id}/role`, "PATCH", { role:"guest",teamIds:[team.id] });
      expect(assigned.status,await assigned.clone().text()).toBe(200);
    }
    return made;
  };
  const owner = await person(f.cookie);
  const admin = await fresh("admin"), lead = await fresh("lead"), member = await fresh("member"), guest = await fresh("guest");
  const as = (who: { cookie: string }) => (path: string, method = "GET", body?: unknown) =>
    request("/api" + path, method, body, who.cookie);
  return { ...f, team, people: { owner, admin, lead, member, guest } as Record<Kind, Person>, admin, lead, member, guest, as, fresh };
}

/** The journey sends hundreds of requests from one loopback client within a
 * minute; it clears the rate-limit counters so they measure nothing here. */
export const resetLimits = () => env.DB.batch([env.DB.prepare("DELETE FROM oa_limits"), env.DB.prepare("DELETE FROM access_rate_limits")]);

/** Every row a refused request could have touched, to prove it changed nothing. */
export async function snapshot(tables: string[]) {
  return Object.fromEntries(await Promise.all(tables.map(async (name) =>
    [name, (await env.DB.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()).results] as const)));
}
