import { env } from "cloudflare:workers";
import { expect, vi } from "vitest";
import { actor, invite, request, bindings, signIn } from "./base-auth-fixture";
import { setupIntegrations } from "./integration-fixture";
import { scheduled } from "../../src/core/app/scheduled";
import { snapshot, resetLimits } from "./role-fixture";
import { channelEdge } from "./channel-edge-fixture";
import {
  seedIntakeForTeam,
  inboundFixture,
  mailBindings,
} from "./email-intake-fixture";
import worker from "./entry";
import { agentResourceClient } from "./agent-resource-journey";

/** Mounted native intake, signed source intake, real Inbox and scheduled export. */
export async function triageResponsibilityJourney(
  f: Awaited<ReturnType<typeof setupIntegrations>>,
) {
  const team = f.initial.teams[0],
    path = `/settings/teams/${team.id}/triage-rotation`;
  const read = async <T = any>(
    response: Response,
    status = 200,
  ): Promise<T> => {
    expect(response.status, await response.clone().text()).toBe(status);
    return response.json() as Promise<T>;
  };
  const make = async (n: number, role?: "viewer" | "admin") => {
    await resetLimits();
    const cookie = await invite(
      ["synthetic-vector-" + n, "triage.test"].join("@"),
      f.cookie,
      role,
    );
    const id = await actor(cookie);
    if (role !== "viewer")
      await read(
        await f.call(`/settings/teams/${team.id}/members/${id}`, "PUT", {
          role: "member",
        }),
      );
    const person = {
      id,
      cookie,
      call: (p: string, m = "GET", b?: unknown): Promise<Response> =>
        request("/api" + p, m, b, person.cookie),
    };
    return person;
  };
  const first = await make(9101),
    second = await make(9102),
    viewer = await make(9103, "viewer"),
    admin = await make(9104, "admin"),
    guest = await make(9105);
  await read(
    await f.call(`/settings/operators/${guest.id}/role`, "PATCH", {
      role: "guest",
      teamIds: [team.id],
    }),
  );
  const config = {
    startsLocal: "2026-10-26T09:00",
    operatorIds: [first.id, second.id],
  };
  const stored = () =>
    snapshot([
      "team_triage_rotations",
      "team_triage_rotation_members",
      "triage_creation_receipts",
      "issues",
      "evidence_revisions",
      "issue_activity",
      "notifications",
      "notification_events",
      "audit_records",
      "administration_audit_details",
    ]);
  let before = await stored();
  for (const who of [first, viewer, guest]) {
    expect((await who.call(path, "PUT", config)).status).toBe(403);
    expect(
      (await who.call(path, "PUT", { ...config, operatorIds: [first.id] }))
        .status,
    ).toBe(403);
    expect(await stored()).toEqual(before);
  }
  await read(
    await f.call(`/settings/teams/${team.id}/permissions`, "PUT", {
      settings: "all_members",
      planning: "team_owners",
    }),
  );
  // Session admission used the real clock. Only product calendar operations now use a pinned Date.
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
    await read(
      await first.call(path, "PUT", { ...config, operatorIds: [first.id] }),
    );
    expect((await read(await f.call(path))).mode).toBe("fixed");
    await read(await first.call(path, "PUT", config));
    await read(await admin.call(path, "PUT", config));
    expect((await read(await f.call(path))).responsible.id).toBe(first.id);
    expect((await read(await f.call(path))).nextHandoverAt).toBe(
      "2026-11-02T09:00:00.000Z",
    );
    const create = async (who = f, title = "synthetic-vector-9110") =>
      read<{ identifier: string }>(
        await who.call("/intake", "POST", { teamId: team.id, title }),
        201,
      );
    const firstItem = await create();
    const notices = async (who: typeof first, identifier: string) =>
      (await read(await who.call("/notifications?limit=50"))).items.filter(
        (n: any) => n.identifier === identifier && n.causes.includes("triage"),
      );
    expect(await notices(first, firstItem.identifier)).toHaveLength(1);
    expect(await notices(second, firstItem.identifier)).toEqual([]);
    const own = await create(first, "synthetic-vector-9111");
    expect(await notices(first, own.identifier)).toEqual([]);
    const old = await read(await f.call("/triage-responsibility"));
    expect(
      old.teams
        .find((t: any) => t.teamId === team.id)
        .untouched.map((i: any) => i.identifier),
    ).toEqual(expect.arrayContaining([firstItem.identifier, own.identifier]));
    const ownView = await read(await first.call("/triage-responsibility"));
    expect(ownView.count).toBeGreaterThanOrEqual(2);
    const source = await f.source("synthetic-vector-9112"),
      input = {
        teamId: team.id,
        title: "synthetic-vector-9113",
        sourceRecordId: "synthetic-vector-9114",
        sourceRevisionId: "synthetic-vector-9115",
        observedAt: new Date().toISOString(),
      };
    const sourceItem = await read(await f.signed(source, input));
    expect(await notices(first, sourceItem.identifier)).toHaveLength(1);
    vi.setSystemTime(new Date("2026-11-02T09:00:00Z"));
    await Promise.all([
      scheduled({ scheduledTime: Date.now() }, bindings),
      scheduled({ scheduledTime: Date.now() }, bindings),
    ]);
    expect((await read(await f.call(path))).responsible.id).toBe(second.id);
    const after = await read(await second.call("/triage-responsibility"));
    expect(after.count).toBeGreaterThanOrEqual(3);
    expect(
      after.teams
        .find((t: any) => t.teamId === team.id)
        .untouched.map((i: any) => i.identifier),
    ).toContain(firstItem.identifier);
    expect(await notices(second, firstItem.identifier)).toEqual([]);
    f.restart();
    expect(await read(await f.signed(source, input))).toMatchObject({
      reused: true,
    });
    await read(
      await f.signed(source, {
        ...input,
        sourceRevisionId: "synthetic-vector-9116",
      }),
    );
    expect(await notices(first, sourceItem.identifier)).toHaveLength(1);
    expect(await notices(second, sourceItem.identifier)).toEqual([]);
    const next = await create();
    expect(await notices(second, next.identifier)).toHaveLength(1);
    expect(await notices(first, next.identifier)).toEqual([]);
    const nextSource = await read(
      await f.signed(source, {
        ...input,
        sourceRecordId: "synthetic-vector-9117",
      }),
    );
    expect(await notices(second, nextSource.identifier)).toHaveLength(1);
    const repeated = { ...input, sourceRecordId: "synthetic-vector-9140" };
    const concurrent = await Promise.all([
      f.signed(source, repeated).then((response) => read(response)),
      f.signed(source, repeated).then((response) => read(response)),
    ]);
    expect(concurrent[0].identifier).toBe(concurrent[1].identifier);
    expect(await notices(second, concurrent[0].identifier)).toHaveLength(1);
    // Receipt failure rolls the genuine item, evidence, activity and Inbox back together.
    const count = await stored();
    await env.DB.prepare(
      "CREATE TRIGGER triage_proof_failure BEFORE INSERT ON triage_creation_receipts BEGIN SELECT RAISE(ABORT,'synthetic-vector-9118'); END",
    ).run();
    try {
      expect(
        (
          await f.signed(source, {
            ...input,
            sourceRecordId: "synthetic-vector-9119",
          })
        ).status,
      ).toBe(503);
      expect(await stored()).toEqual(count);
      expect(
        (
          await f.call("/intake", "POST", {
            teamId: team.id,
            title: "synthetic-vector-9141",
          })
        ).status,
      ).toBe(503);
      expect(await stored()).toEqual(count);
    } finally {
      await env.DB.prepare("DROP TRIGGER triage_proof_failure").run();
    }
    // Mutes consume the event without creating a delayed notice when later unmuted.
    await read(
      await second.call("/settings/notifications", "PATCH", {
        mutedKinds: ["triage"],
      }),
    );
    const muted = await create();
    expect(await notices(second, muted.identifier)).toEqual([]);
    await read(
      await second.call("/settings/notifications", "PATCH", { mutedKinds: [] }),
    );
    await scheduled({ scheduledTime: Date.now() }, bindings);
    expect(await notices(second, muted.identifier)).toEqual([]);
    // Private work disappears on the very next request and cannot notify an unavailable slot.
    await read(
      await f.call(`/settings/teams/${team.id}/privacy`, "PUT", {
        isPrivate: true,
      }),
    );
    await read(
      await f.call(`/settings/teams/${team.id}/members/${second.id}`, "DELETE"),
    );
    expect(
      (await read(await second.call("/triage-responsibility"))).teams,
    ).toEqual([]);
    expect(
      (await read(await second.call("/notifications?limit=50"))).items.some(
        (n: any) => n.identifier === next.identifier,
      ),
    ).toBe(false);
    expect((await read(await f.call(path))).responsible).toBeNull();
    const unavailable = await create();
    expect(await notices(first, unavailable.identifier)).toEqual([]);
    await read(
      await f.call(`/settings/teams/${team.id}/members/${second.id}`, "PUT", {
        role: "member",
      }),
    );
    await env.DB.prepare(
      "UPDATE oa_operators SET status='inactive' WHERE id=(SELECT auth_id FROM vector_auth_operators WHERE operator_id=?)",
    )
      .bind(second.id)
      .run();
    expect((await read(await f.call(path))).responsible).toBeNull();
    const inactive = await create();
    expect(
      await env.DB.prepare(
        "SELECT count(*) n FROM notifications WHERE issue_id=(SELECT id FROM issues WHERE identifier=?)",
      )
        .bind(inactive.identifier)
        .first<number>("n"),
    ).toBe(0);
    await env.DB.prepare(
      "UPDATE oa_operators SET status='active' WHERE id=(SELECT auth_id FROM vector_auth_operators WHERE operator_id=?)",
    )
      .bind(second.id)
      .run();
    // Reactivation does not revive the session invalidated by inactivation.
    const secondEmail = await env.DB.prepare(
      "SELECT email FROM operators WHERE id=?",
    )
      .bind(second.id)
      .first<string>("email");
    second.cookie = await signIn(secondEmail!);
    // Both ROLE-009 settings choices apply on the next request; refused storage stays exact.
    await read(
      await f.call(`/settings/teams/${team.id}/permissions`, "PUT", {
        settings: "team_owners",
        planning: "team_owners",
      }),
    );
    before = await stored();
    expect((await first.call(path, "PUT", config)).status).toBe(403);
    expect(await stored()).toEqual(before);
    await read(
      await f.call(`/settings/teams/${team.id}/members/${first.id}`, "PUT", {
        role: "owner",
      }),
    );
    await read(await first.call(path, "PUT", config));
    // A fixed assignment has one stable effective boundary, with no weekly
    // handover. Every currently implemented creation door reaches its Inbox.
    const fixed = { ...config, operatorIds: [first.id] };
    await read(await first.call(path, "PUT", fixed));
    expect(await read(await f.call(path))).toMatchObject({
      mode: "fixed",
      responsible: { id: first.id },
      nextHandoverAt: null,
      periodStartsAt: "2026-10-26T09:00:00.000Z",
    });
    const edge = channelEdge();
    try {
      await read(
        await f.call("/settings/integrations/slack", "POST", {
          botToken: edge.token,
        }),
      );
      const email = await env.DB.prepare(
        "SELECT email FROM operators WHERE id=?",
      )
        .bind(first.id)
        .first<string>("email");
      edge.users(email!, "UTRIAGE", "Triage colleague");
      await read(
        await first.call("/settings/notifications/slack/lookup", "POST"),
      );
      await read(
        await first.call("/settings/notifications/slack/link", "POST", {
          slackUserId: "UTRIAGE",
        }),
      );
      await read(
        await first.call("/settings/notifications", "PATCH", {
          emailEnabled: true,
        }),
      );
      await read(
        await first.call("/settings/notifications/channels", "PUT", {
          channels: [{ kind: "triage", emailMode: "immediate", slack: true }],
        }),
      );
      const nativeFixed = await create(f, "synthetic-vector-9150");
      expect(await notices(first, nativeFixed.identifier)).toHaveLength(1);
      expect(await notices(second, nativeFixed.identifier)).toEqual([]);
      const direct = () =>
        edge.calls.filter(
          (c) =>
            c.method === "chat.postMessage" &&
            c.body.blocks.some((block: any) =>
              block.elements?.some(
                (element: any) =>
                  element.url ===
                  bindings.APP_ORIGIN + "/app/issues/" + nativeFixed.identifier,
              ),
            ),
        );
      expect(direct()).toHaveLength(1);
      expect(direct()[0].body.channel).toBe("DTRIAGE");
      expect(direct()[0].body.text).not.toContain("synthetic-vector-9150");
      expect(direct()[0].body.text).not.toContain("Owner");
      expect(
        await env.DB.prepare(
          "SELECT count(*) n FROM notification_mail_audit WHERE subject_identifier=?",
        )
          .bind(nativeFixed.identifier)
          .first<number>("n"),
      ).toBe(1);
      const selfFixed = await create(first, "synthetic-vector-9151");
      expect(await notices(first, selfFixed.identifier)).toEqual([]);
      const sourceFixed = await read(
        await f.signed(source, {
          ...input,
          sourceRecordId: "synthetic-vector-9152",
        }),
      );
      expect(await notices(first, sourceFixed.identifier)).toHaveLength(1);
      // Email's configuring manager is not its sender. Even when that manager
      // is responsible, the real email event must notify them once.
      const emailBody = "See " + nativeFixed.identifier;
      const mail = await seedIntakeForTeam(
        team.id,
        first.cookie,
        false,
        emailBody,
      );
      const emailBacklinks = async () =>
        (
          await read(await f.call("/issues/" + nativeFixed.identifier))
        ).activity.filter(
          (a: any) =>
            a.kind === "issue.mentioned" &&
            a.nextValue?.identifier === mail.identifier,
        );
      expect(await emailBacklinks()).toHaveLength(1);
      expect(await notices(first, mail.identifier)).toMatchObject([
        { actor: "Email intake" },
      ]);
      expect(await notices(second, mail.identifier)).toEqual([]);
      const replay = inboundFixture(mail.address, mail.messageId, {
        body: emailBody,
      });
      expect(await worker.email(replay.message, mailBindings)).toEqual({
        status: "duplicate",
      });
      expect(await emailBacklinks()).toHaveLength(1);
      f.restart();
      vi.setSystemTime(new Date("2026-11-02T10:00:00Z"));
      await scheduled({ scheduledTime: Date.now() }, bindings);
      await scheduled({ scheduledTime: Date.now() }, bindings);
      expect(await read(await f.call(path))).toMatchObject({
        mode: "fixed",
        responsible: { id: first.id },
        nextHandoverAt: null,
        periodStartsAt: "2026-10-26T09:00:00.000Z",
      });
      expect(await notices(first, mail.identifier)).toHaveLength(1);
      expect(direct()).toHaveLength(1);
      expect(
        await env.DB.prepare(
          "SELECT count(*) n FROM notification_mail_audit WHERE subject_identifier=?",
        )
          .bind(nativeFixed.identifier)
          .first<number>("n"),
      ).toBe(1);
      await read(
        await f.signed(source, {
          ...input,
          sourceRecordId: "synthetic-vector-9152",
        }),
      );
      expect(await notices(first, sourceFixed.identifier)).toHaveLength(1);
      // The mounted agent transport uses the same native creation door and
      // retains its once receipt across a repeated idempotency key.
      await read(
        await f.call(path, "PUT", { ...config, operatorIds: [second.id] }),
      );
      const agent = await agentResourceClient(first, f),
        intakeKey = crypto.randomUUID();
      const [uri] = await agent.write(team.id, intakeKey);
      const agentIdentifier = await env.DB.prepare(
        "SELECT identifier FROM issues WHERE id=?",
      )
        .bind(uri.split("/").at(-1))
        .first<string>("identifier");
      expect(await notices(second, agentIdentifier!)).toHaveLength(1);
      expect(await notices(first, agentIdentifier!)).toEqual([]);
      await agent.write(team.id, intakeKey);
      expect(await notices(second, agentIdentifier!)).toHaveLength(1);
      await read(await f.call(path, "PUT", fixed));
      await read(
        await first.call("/settings/personal-time", "PATCH", {
          timezone: "UTC",
          workingHoursStart: "09:00",
          workingHoursEnd: "17:00",
          workingDays: [1, 2, 3, 4, 5],
        }),
      );
      await read(
        await first.call("/settings/notifications/channels", "PUT", {
          channels: [{ kind: "triage", emailMode: "daily", slack: false }],
        }),
      );
      const digestItem = await create(f, "synthetic-vector-9156");
      const delivered = () =>
        env.DB.prepare(
          "SELECT count(*) n FROM notification_mail_audit WHERE subject_identifier=?",
        )
          .bind(digestItem.identifier)
          .first<number>("n");
      expect(await notices(first, digestItem.identifier)).toHaveLength(1);
      expect(await delivered()).toBe(0);
      vi.setSystemTime(new Date("2026-11-03T08:59:59Z"));
      await scheduled({ scheduledTime: Date.now() }, bindings);
      expect(await delivered()).toBe(0);
      vi.setSystemTime(new Date("2026-11-03T09:00:00Z"));
      await scheduled({ scheduledTime: Date.now() }, bindings);
      await scheduled({ scheduledTime: Date.now() }, bindings);
      expect(await delivered()).toBe(1);
      await read(
        await f.call(path, "PUT", {
          ...config,
          operatorIds: [first.id, viewer.id],
        }),
        409,
      );
    } finally {
      await read(await f.call("/settings/integrations/slack", "DELETE"));
      edge.restore();
    }
    // Workspace calendar weeks are 169h in fall and 167h in spring, not fixed milliseconds.
    await read(
      await f.call("/settings", "PATCH", { timezone: "America/New_York" }),
    );
    await read(
      await f.call(path, "PUT", { ...config, startsLocal: "2026-10-26T09:00" }),
    );
    vi.setSystemTime(new Date("2026-11-02T13:59:59Z"));
    expect((await read(await f.call(path))).responsible.id).toBe(first.id);
    vi.setSystemTime(new Date("2026-11-02T14:00:00Z"));
    expect((await read(await f.call(path))).responsible.id).toBe(second.id);
    await read(
      await f.call(path, "PUT", { ...config, startsLocal: "2026-03-02T09:00" }),
    );
    vi.setSystemTime(new Date("2026-03-09T12:59:59Z"));
    expect((await read(await f.call(path))).responsible.id).toBe(first.id);
    vi.setSystemTime(new Date("2026-03-09T13:00:00Z"));
    expect((await read(await f.call(path))).responsible.id).toBe(second.id);
    expect(
      (
        await f.call(path, "PUT", {
          ...config,
          startsLocal: "2026-03-08T02:30",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.call(path, "PUT", {
          ...config,
          operatorIds: [first.id, viewer.id],
        })
      ).status,
    ).toBe(409);
    const erasedIssue = await read(
      await f.call("/issues/" + concurrent[0].identifier),
    );
    await read(
      await f.call("/issues/" + erasedIssue.identifier, "DELETE", {
        expectedVersion: erasedIssue.version,
        confirmed: true,
      }),
    );
    f.restart();
    expect((await f.signed(source, repeated)).status).toBe(410);
    expect(
      await env.DB.prepare(
        "SELECT count(*) n FROM triage_creation_receipts WHERE issue_id=?",
      )
        .bind(erasedIssue.id)
        .first<number>("n"),
    ).toBe(0);
    await read(
      await f.call("/settings/integrations/sources/" + source.id, "DELETE"),
    );
    const revoked = await stored();
    expect(
      (
        await f.signed(source, {
          ...input,
          sourceRecordId: "synthetic-vector-9142",
        })
      ).status,
    ).toBe(401);
    expect(await stored()).toEqual(revoked);
    await read(
      await f.call(path, "PUT", { ...config, operatorIds: [second.id] }),
    );
    await read(await f.call("/settings/operators/" + second.id, "DELETE"));
    expect((await second.call("/triage-responsibility")).status).toBe(401);
    expect((await read(await f.call(path))).responsible).toBeNull();
    const afterRemoval = await create();
    expect(
      await env.DB.prepare(
        "SELECT count(*) n FROM notifications WHERE issue_id=(SELECT id FROM issues WHERE identifier=?)",
      )
        .bind(afterRemoval.identifier)
        .first<number>("n"),
    ).toBe(0);
    expect((await request("/api/triage-responsibility")).status).toBe(401);
    expect(
      (await env.DB.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
}
