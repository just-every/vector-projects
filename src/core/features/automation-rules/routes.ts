import type { Hono } from "hono";
import type { AppEnvironment } from "../../app/bindings";
import { readRequestJson } from "../../app/input";
import {
  administrationContext,
  commit,
  guard,
  audit,
  SettingsError,
} from "../administration/transaction";
import { settingsActor } from "../settings/repository";
import { activeRecipient } from "../notifications/events";
import { createUlid } from "../../shared/ids";
import { dueRuleInput, type DueRule } from "./schema";

async function read(db: D1Database, actor: string) {
  const access = await settingsActor(db, actor);
  if (!["owner", "admin"].includes(access.role))
    throw new SettingsError(
      "forbidden",
      "Only Owners and Admins manage workspace rules.",
      403,
    );
  const row = await db
    .prepare(
      `SELECT r.id,r.name,r.owner_operator_id AS ownerId,o.name AS ownerName,r.enabled,r.version,
      (o.id IS NOT NULL AND o.role IN ('owner','admin') AND ${activeRecipient}) AS ownerActive
    FROM workspace_due_rules r LEFT JOIN operators o ON o.id=r.owner_operator_id AND o.removed_at IS NULL WHERE r.workspace_id=?`,
    )
    .bind(access.workspace_id)
    .first<
      Omit<DueRule, "enabled" | "ownerActive"> & {
        enabled: number;
        ownerActive: number;
      }
    >();
  // The scoped issues and cycles projections apply current private-team visibility.
  const runs = (
    await db
      .prepare(
        `SELECT x.id,i.identifier,x.due_date AS dueDate,x.outcome,x.reason,x.last_failure AS failureReason,x.failed_at AS failedAt,c.name AS cycleName,
    x.notified,x.updated_at AS at FROM workspace_due_rule_runs x JOIN workspace_due_rules r ON r.id=x.rule_id
    JOIN issues i ON i.id=x.issue_id LEFT JOIN cycles c ON c.id=x.cycle_id
    WHERE r.workspace_id=? ORDER BY x.updated_at DESC,x.id DESC LIMIT 100`,
      )
      .bind(access.workspace_id)
      .all<{ notified: number }>()
  ).results;
  return {
    rule: row
      ? { ...row, enabled: row.enabled === 1, ownerActive: row.ownerActive === 1 }
      : null,
    runs: runs.map((x) => ({ ...x, notified: x.notified === 1 })),
  };
}
export function addDueRuleRoutes(app: Hono<AppEnvironment>) {
  app.get("/settings/automation", async (c) => {
    try {
      return c.json(await read(c.env.DB, c.get("operatorId")));
    } catch (e) {
      if (e instanceof SettingsError)
        return c.json({ error: e.code, message: e.message }, e.status);
      throw e;
    }
  });
  app.put("/settings/automation/due-soon", async (c) => {
    const parsed = dueRuleInput.safeParse(await readRequestJson(c.req.raw));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    try {
      const ctx = await administrationContext(c.env.DB, c.get("operatorId"));
      const prior = await read(ctx.db, ctx.actor),
        input = parsed.data;
      const id = prior.rule?.id ?? createUlid(new Date(ctx.at));
      await commit(ctx, [
        guard(
          ctx.db,
          `EXISTS(SELECT 1 FROM operators WHERE id=? AND role IN ('owner','admin') AND removed_at IS NULL)
          AND COALESCE((SELECT version FROM workspace_due_rules WHERE workspace_id=?),0)=?`,
          ctx.actor,
          ctx.workspace,
          input.expectedVersion,
        ),
        ctx.db
          .prepare(
            `INSERT INTO workspace_due_rules(id,workspace_id,name,owner_operator_id,enabled,version,created_at,updated_at)
          VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(workspace_id) DO UPDATE SET name=excluded.name,owner_operator_id=excluded.owner_operator_id,
          enabled=excluded.enabled,version=workspace_due_rules.version+1,updated_at=excluded.updated_at`,
          )
          .bind(
            id,
            ctx.workspace,
            input.name,
            ctx.actor,
            Number(input.enabled),
            ctx.at,
            ctx.at,
          ),
        ...audit(
          ctx,
          "automation.due_rule_saved",
          id,
          input.name,
          prior.rule && {
            id: prior.rule.id,
            name: prior.rule.name,
            ownerId: prior.rule.ownerId,
            enabled: prior.rule.enabled,
            version: prior.rule.version,
          },
          input,
        ),
      ]);
      return c.json(await read(ctx.db, ctx.actor));
    } catch (e) {
      if (e instanceof SettingsError)
        return c.json({ error: e.code, message: e.message }, e.status);
      throw e;
    }
  });
}
