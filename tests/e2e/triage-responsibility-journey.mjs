import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { navigate } from "./collaboration-navigation.mjs";
import { writeRuntimeD1 } from "./runtime-d1.mjs";
import { roleScreens } from "./role-ui-support.mjs";
import { createWebhookProtocol } from "../../vendor/base/integrations/core/webhook.ts";

/** Uses the existing administration installation and two independently admitted people. */
export async function triageResponsibilityJourney({
  page,
  browser,
  runtime,
  evidence,
  clause,
}) {
  const { base, sql } = runtime;
  const priorViewport = page.viewportSize();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const send = async (client, path, method = "GET", data, status = 200) => {
    const response = await client.request.fetch(base + "/api" + path, {
      method,
      headers: { Origin: base },
      ...(data === undefined ? {} : { data }),
    });
    assert.equal(response.status(), status, await response.text());
    return response.json();
  };
  const state = await send(page, "/settings/administration"),
    team = state.teams.find((t) => t.name === runtime.config.DEFAULT_TEAM_NAME),
    owner = { ...state.viewer, name: runtime.config.FIRST_OWNER_NAME };
  const email = ["synthetic-vector-9120", `triage-${Date.now()}.test`].join(
    "@",
  );
  await send(
    page,
    "/settings/operators/invite",
    "POST",
    { email, displayName: "Rotation colleague" },
    202,
  );
  const link = sql(
    `SELECT json_extract(message,'$.text') text FROM rer_mail_development_outbox WHERE json_extract(message,'$.to[0]')='${email}' ORDER BY created_at DESC,sequence DESC LIMIT 1`,
  )[0].text.match(/https?:\/\/[^\s]+/)[0];
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    peer = await context.newPage();
  try {
    await peer.goto(link);
    await peer.getByRole("button", { name: "Confirm", exact: true }).click();
    await peer.waitForURL(base + "/app");
    const colleague = (await send(peer, "/session")).operatorId;
    await send(page, `/settings/teams/${team.id}/members/${colleague}`, "PUT", {
      role: "member",
    });
    // The public form establishes an ordered weekly rotation in the workspace zone.
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: state.workspace.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .formatToParts(new Date())
        .map((p) => [p.type, p.value]),
    );
    const day = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - 1);
    const startsLocal = day.toISOString().slice(0, 10) + "T09:00",
      path = `/settings/teams/${team.id}/triage-rotation`;
    await clause(
      "TRIAGE-001",
      "weekly rotation, native and signed intake, handover and once-only Inbox through mounted doors",
      async () => {
        // The rotation is part of the team's People tab.
        await navigate(page, base + `/app/settings/teams/${team.id}/people`);
        const form = page.getByRole("form", {
          name: `Weekly triage rotation for ${team.name}`,
          exact: true,
        });
        await form
          .getByLabel(`First handover in ${state.workspace.timezone}`, {
            exact: true,
          })
          .fill(startsLocal);
        // The order is the selects themselves: each position holds exactly the member chosen for it.
        await form
          .getByLabel("Rotation member 1", { exact: true })
          .selectOption(owner.id);
        await form
          .getByLabel("Rotation member 2", { exact: true })
          .selectOption(colleague);
        await expect(
          form.getByLabel("Rotation member 1", { exact: true }),
        ).toHaveValue(owner.id);
        await form
          .getByLabel("Rotation member 1", { exact: true })
          .selectOption(colleague);
        await form
          .getByLabel("Rotation member 2", { exact: true })
          .selectOption(owner.id);
        const saved = page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/api" + path &&
            r.request().method() === "PUT",
        );
        await form
          .getByRole("button", { name: "Save triage rotation", exact: true })
          .click();
        assert.equal((await saved).status(), 200);
        await expect(
          page
            .getByRole("status")
            .filter({ hasText: "Triage rotation saved." }),
        ).toBeVisible();
        await page.reload();
        await expect(
          form.getByLabel("Rotation member 1", { exact: true }),
        ).toHaveValue(colleague);
        await expect(
          form.getByLabel("Rotation member 2", { exact: true }),
        ).toHaveValue(owner.id);
        const first = await send(
          page,
          "/intake",
          "POST",
          { teamId: team.id, title: "synthetic-vector-9121" },
          201,
        );
        const own = await send(
          peer,
          "/intake",
          "POST",
          { teamId: team.id, title: "synthetic-vector-9122" },
          201,
        );
        const notices = async (client, identifier) =>
          (await send(client, "/notifications?limit=50")).items.filter(
            (n) => n.identifier === identifier && n.causes.includes("triage"),
          );
        assert.equal((await notices(peer, first.identifier)).length, 1);
        assert.equal((await notices(peer, own.identifier)).length, 0);
        await navigate(peer, base + "/app/inbox");
        await expect(
          peer
            .getByRole("button", { name: new RegExp(first.identifier) })
            .first(),
        ).toBeVisible();
        const capture = roleScreens(evidence);
        const inspect = async (client, region, name) => {
          await capture(client, region, name);
          await client.setViewportSize({ width: 1440, height: 1000 });
        };
        await inspect(page, form, "triage-rotation");
        await inspect(peer, peer.locator("main"), "triage-inbox-first");
        await peer
          .locator(".inbox-row")
          .filter({ hasText: first.identifier })
          .click();
        await peer.waitForURL(base + "/app/issues/" + first.identifier);
        await navigate(peer, base + "/app/triage");
        const handover = peer.getByRole("region", {
          name: `${team.name} triage`,
          exact: true,
        });
        await expect(
          handover.getByText("Responsible: Rotation colleague", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          handover.getByRole("link", { name: new RegExp(first.identifier) }),
        ).toBeVisible();
        await expect(
          peer
            .locator(".app-nav-link.is-active:visible")
            .getByLabel("2 untouched triage items"),
        ).toBeVisible();
        // Move the persisted clock fixture across one workspace calendar week. The
        // Worker journey separately advances Date across actual DST boundaries.
        day.setUTCDate(day.getUTCDate() - 7);
        await writeRuntimeD1(
          base,
          "UPDATE team_triage_rotations SET starts_local=? WHERE team_id=?",
          [day.toISOString().slice(0, 10) + "T09:00", team.id],
        );
        await peer.reload();
        await expect(
          handover.getByText(`Responsible: ${owner.name}`, { exact: true }),
        ).toBeVisible();
        await expect(
          handover.getByRole("link", { name: new RegExp(first.identifier) }),
        ).toBeVisible();
        const second = await send(
          peer,
          "/intake",
          "POST",
          { teamId: team.id, title: "synthetic-vector-9123" },
          201,
        );
        assert.equal((await notices(page, second.identifier)).length, 1);
        assert.equal((await notices(peer, second.identifier)).length, 0);
        const source = await send(
          page,
          "/settings/integrations/sources",
          "POST",
          {
            name: "synthetic-vector-9124",
            sourceId: "synthetic-vector-9125",
            teamId: team.id,
          },
          201,
        );
        const input = {
          teamId: team.id,
          title: "synthetic-vector-9126",
          sourceRecordId: "synthetic-vector-9127",
          sourceRevisionId: "synthetic-vector-9128",
          observedAt: new Date().toISOString(),
        };
        const protocol = createWebhookProtocol({
          resolveDestination: async () => source.receiver,
          signingKey: async () =>
            new Uint8Array(Buffer.from(source.secret, "hex")),
        });
        const signed = async (body) => {
          const wire = await protocol.prepare(
            {
              id: crypto.randomUUID(),
              tenant: source.workspaceId,
              destinationId: source.sourceId,
              event: "signal.revision",
              protocol: "webhook",
              body: JSON.stringify(body),
            },
            Date.now(),
          );
          const response = await fetch(wire.url, {
            method: "POST",
            headers: wire.headers,
            body: wire.body,
          });
          assert.equal(response.status, 200, await response.clone().text());
          return response.json();
        };
        const signal = await signed(input);
        assert.equal((await notices(page, signal.identifier)).length, 1);
        await signed(input);
        await signed({ ...input, sourceRevisionId: "synthetic-vector-9129" });
        assert.equal((await notices(page, signal.identifier)).length, 1);
        await navigate(page, base + "/app/triage");
        const current = page.getByRole("region", {
          name: `${team.name} triage`,
          exact: true,
        });
        await expect(
          current.getByText(`Responsible: ${owner.name}`, { exact: true }),
        ).toBeVisible();
        await expect(
          current.getByRole("link", { name: new RegExp(second.identifier) }),
        ).toBeVisible();
        await expect(
          current.getByRole("heading", {
            name: "4 untouched items",
            exact: true,
          }),
        ).toBeVisible();
        await inspect(page, current, "triage-handover");
        await navigate(page, base + "/app/inbox");
        await expect(
          page
            .getByRole("button", { name: new RegExp(signal.identifier) })
            .first(),
        ).toBeVisible();
        await inspect(page, page.locator("main"), "triage-inbox-handover");
      },
    );
  } finally {
    await context.close();
    if (priorViewport) await page.setViewportSize(priorViewport);
  }
}
