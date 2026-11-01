import assert from "node:assert/strict";
import { navigate } from "./collaboration-navigation.mjs";

/** People: Invite opens in place; fill it, ask once, and resolve to the invitation's response. */
export async function invitePerson(page, { name, email, role }) {
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const form = page.getByRole("form", { name: "Invite someone", exact: true });
  await form.getByLabel("Name", { exact: true }).fill(name);
  await form.getByLabel("Email", { exact: true }).fill(email);
  if (role) await form.getByLabel("Role", { exact: true }).selectOption(role);
  await form.getByRole("button", { name: "Send invitation", exact: true }).click();
  const invited = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/settings/operators/invite");
  await page.getByRole("button", { name: "Confirm and send", exact: true }).click();
  return invited;
}

/** A person's record, in the pane under "People › name". */
export async function openPerson(page, base, id) {
  await navigate(page, `${base}/app/settings/people/${id}`);
  await page.getByLabel("Role", { exact: true }).or(page.getByText("Role", { exact: true })).first().waitFor();
}

/** A team's record on one tab (Details when none is named). */
export async function openTeam(page, base, team, tab = "details") {
  await navigate(page, `${base}/app/settings/teams/${team.id}/${tab}`);
  await page.getByRole("navigation", { name: "Team sections", exact: true }).waitFor();
}

/** Types into a text field and leaves it; resolves to the response of the save. */
export async function storeText(page, field, value, path, method = "PATCH") {
  const done = page.waitForResponse((r) => new URL(r.url()).pathname === path && r.request().method() === method);
  await field.fill(value);
  await field.blur();
  return done;
}

/** The whole labelled row of a switch is its target. */
export const switchRow = (scope, text) => scope.locator("label.switch-row").filter({ hasText: text });

/** The list of teams on the Teams page, named for assistive technology. */
export const teamList = (page) => page.getByRole("list", { name: "Teams", exact: true });

export async function assertNoSaveButton(scope) {
  assert.equal(await scope.getByRole("button", { name: /^(Save(?!d)|Change role)/ }).count(), 0);
}
