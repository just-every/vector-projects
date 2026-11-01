import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, inject } from "vitest";
import { insertHistoricalSample } from "./historical-sample-fixture";
/**
 * Columns a later migration adds to a table that already held rows, with the value an
 * untouched pre-existing row takes: 0124 gives every existing team cycles_enabled=1.
 */
const addedAfterBoundary: Record<string, Record<string, unknown>> = {
  teams: { cycles_enabled: 1 },
};
/** A populated prior head retains every value, including queued candidates and mutes. */
export async function triageUpgrade() {
  const db = env.ARCHIVE_TARGET_DB,
    migrations = inject("migrations"),
    boundary = migrations.findIndex(
      (m) => m.name === "0121_triage_responsibility.sql",
    );
  await applyD1Migrations(db, migrations.slice(0, boundary));
  await insertHistoricalSample(db, new Date("2026-10-01T00:00:00Z"));
  const issue = (await db
    .prepare("SELECT id FROM issues LIMIT 1")
    .first<{ id: string }>())!.id;
  const person = (await db
    .prepare("SELECT id FROM operators LIMIT 1")
    .first<{ id: string }>())!.id;
  await db.batch([
    db
      .prepare(
        "INSERT INTO notification_type_mutes(operator_id,kind) VALUES(?,'comment')",
      )
      .bind(person),
    db
      .prepare(
        "INSERT INTO notification_candidates(event_id,issue_id,recipient_id,kind,created_at) VALUES('synthetic-vector-9130',?,?,'comment','2026-10-01')",
      )
      .bind(issue, person),
  ]);
  await db.batch([
    db
      .prepare(
        "INSERT INTO notification_channel_defaults(workspace_id,kind,email_mode,slack_enabled) SELECT workspace_id,'comment','daily',0 FROM operators WHERE id=?",
      )
      .bind(person),
    db
      .prepare(
        "INSERT INTO notification_channel_overrides(operator_id,kind,email_mode,slack_enabled) VALUES(?,'mention','off',0)",
      )
      .bind(person),
  ]);
  const tables = (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY name",
      )
      .all<{ name: string }>()
  ).results;
  const before = await Promise.all(
    tables.map(async ({ name }) => {
      const order = (
        await db
          .prepare('PRAGMA table_info("' + name + '")')
          .all<{ name: string }>()
      ).results
        .map((c) => '"' + c.name + '"')
        .join(",");
      return {
        name,
        order,
        rows: (
          await db
            .prepare('SELECT * FROM "' + name + '" ORDER BY ' + order)
            .all()
        ).results,
      };
    }),
  );
  await applyD1Migrations(db, migrations.slice(boundary));
  for (const table of before)
    expect(
      (
        await db
          .prepare('SELECT * FROM "' + table.name + '" ORDER BY ' + table.order)
          .all()
      ).results,
      table.name,
    ).toEqual(
      table.rows.map((row) => ({
        ...row,
        ...addedAfterBoundary[table.name],
      })),
    );
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual(
    [],
  );
}
