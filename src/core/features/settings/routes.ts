import { AuthError } from "../../../../vendor/base/operator-auth/index.mjs";
import { invitationDatabase } from "./invitation-database";
import { settingsActor } from "./repository";
import { baseAuth } from "../auth/base.server";
import { localMailEnabled } from "../auth/development.server";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/bindings";
import { readRequestJson } from "../../app/input";
import { clearSessionCookie } from "../auth/service";
import { timezoneSchema } from "../bootstrap/config";
import { readSettings, SettingsError, updateWorkspaceTime } from "./repository";
import { reminderTimeSchema } from "./schema";
import { removeOperator } from "./removal";
import { changeRole, guestTeams } from "./roles";
import { readPersonalTime, updatePersonalTime } from "./personal-time";
import { personalTimeInputSchema } from "./personal-time-schema";
import { readAppearance, updateAppearance } from "./appearance";
import { appearanceSchema } from "./appearance-schema";

export function addSettingsRoutes(app: Hono<AppEnvironment>) {
  app.get("/settings/appearance", async (c) => {
    try {
      return c.json(await readAppearance(c.env.DB, c.get("operatorId")));
    } catch (error) {
      if (error instanceof SettingsError)
        return c.json({ error: error.code, message: error.message }, error.status);
      throw error;
    }
  });
  app.patch("/settings/appearance", async (c) => {
    const parsed = appearanceSchema.safeParse(await readRequestJson(c.req.raw));
    if (!parsed.success)
      return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    try {
      return c.json(await updateAppearance(c.env.DB, c.get("operatorId"), parsed.data.theme));
    } catch (error) {
      if (error instanceof SettingsError)
        return c.json({ error: error.code, message: error.message }, error.status);
      throw error;
    }
  });
  app.get("/settings/personal-time", async (c) => {
    try {
      return c.json(await readPersonalTime(c.env.DB, c.get("operatorId")));
    } catch (error) {
      if (error instanceof SettingsError)
        return c.json(
          { error: error.code, message: error.message },
          error.status,
        );
      throw error;
    }
  });
  app.patch("/settings/personal-time", async (c) => {
    const parsed = personalTimeInputSchema.safeParse(
      await readRequestJson(c.req.raw),
    );
    if (!parsed.success)
      return c.json(
        { error: "invalid_request", issues: parsed.error.issues },
        400,
      );
    try {
      await updatePersonalTime(c.env.DB, c.get("operatorId"), parsed.data);
      // Every role saves its own time; the answer is that time, never the directory.
      return c.json(await readPersonalTime(c.env.DB, c.get("operatorId")));
    } catch (error) {
      if (error instanceof SettingsError)
        return c.json(
          { error: error.code, message: error.message },
          error.status,
        );
      throw error;
    }
  });
  app.post("/settings/operators/invite", async (c) => {
    const parsed = z
      .object({
        email: z.email().max(254),
        displayName: z.string().trim().min(1).max(120),
        role: z.enum(["owner", "admin", "member", "guest", "viewer"]).default("member"),
        teamIds: z.array(z.string().length(26)).max(100).optional(),
      })
      .strict()
      .safeParse(await readRequestJson(c.req.raw));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const { role, teamIds, ...invitee } = parsed.data;
    try {
      // Base issues its implementation owner link; the product role travels
      // with that link and is granted when it is accepted.
      const actor = await settingsActor(c.env.DB, c.get("operatorId"));
      if (['guest','viewer'].includes(role) && !['owner','admin'].includes(actor.role)) return c.json({error:'forbidden'},403);
      const teams = ['guest','viewer'].includes(role) ? await guestTeams(c.env.DB,actor.workspace_id,teamIds,role==='guest') : [];
      const result = await baseAuth({...c.env, DB: invitationDatabase(c.env.DB,c.get("operatorId"),invitee.email.trim().toLowerCase(),role,teams)}).invite(c.req.raw, {
        ...invitee,
        role: "owner",
        returnTo: "/app",
      });
      return c.json(
        { ...result, delivery: localMailEnabled(c.env) ? "local" : "email" },
        202,
      );
    } catch (error) {
      if (error instanceof SettingsError) return c.json({ error:error.code,message:error.message },error.status);
      if (error instanceof AuthError)
        return Response.json(
          {
            error: error.code,
            message:
              error.code === "mail_unavailable"
                ? "Email delivery failed. Request a new invitation after the mail service is available."
                : error.code === "step_up_required"
                  ? "Inviting someone gives them access to this workspace, so confirm it's you first."
                  : error.code,
          },
          { status: error.status },
        );
      throw error;
    }
  });
  // Base issues every invitation as an owner link, which needs a sign-in proof
  // from the last ten minutes. This sends a one-use link to confirm it in place.
  app.post("/settings/operators/confirm-identity", async (c) => {
    try {
      await baseAuth(c.env).requestStepUp(c.req.raw, {
        action: "owner:transfer",
        returnTo: "/app/settings/people",
      });
      return c.json({ status: "accepted", delivery: "email" }, 202);
    } catch (error) {
      if (error instanceof AuthError)
        return Response.json(
          {
            error: error.code,
            message:
              error.code === "mail_unavailable"
                ? "The confirmation email could not be sent. Try again after the mail service is available."
                : error.code === "rate_limited"
                  ? "Too many confirmation links were requested. Wait a few minutes, then try again."
                  : error.code,
          },
          { status: error.status },
        );
      throw error;
    }
  });
  app.get("/settings", async (c) => {
    try {
      return c.json({
        ...(await readSettings(c.env.DB, c.get("operatorId"))),
        invitationDelivery: localMailEnabled(c.env) ? "local" : "email",
      });
    } catch (error) {
      if (error instanceof SettingsError)
        return c.json(
          { error: error.code, message: error.message },
          error.status,
        );
      throw error;
    }
  });
  app.patch("/settings", async (c) => {
    const parsed = z
      .object({
        timezone: timezoneSchema,
        reminderTime: reminderTimeSchema.optional(),
        memberInvites: z.boolean().optional(),
      })
      .strict()
      .safeParse(await readRequestJson(c.req.raw));
    if (!parsed.success)
      return c.json(
        { error: "invalid_request", issues: parsed.error.issues },
        400,
      );
    try {
      await updateWorkspaceTime(
        c.env.DB,
        c.get("operatorId"),
        parsed.data.timezone,
        parsed.data.reminderTime,
        parsed.data.memberInvites,
      );
      return c.json({
        ...(await readSettings(c.env.DB, c.get("operatorId"))),
        invitationDelivery: localMailEnabled(c.env) ? "local" : "email",
      });
    } catch (error) {
      if (error instanceof SettingsError)
        return c.json(
          { error: error.code, message: error.message },
          error.status,
        );
      throw error;
    }
  });
  app.patch("/settings/operators/:operatorId/role", async (c) => {
    const target = c.req.param("operatorId");
    const parsed = z.object({ role: z.string(), teamIds: z.array(z.string().length(26)).max(100).optional() }).strict().safeParse(await readRequestJson(c.req.raw));
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(target) || !parsed.success)
      return c.json({ error: "invalid_request" }, 400);
    try {
      await changeRole(c.env.DB, c.get("operatorId"), target, parsed.data.role, parsed.data.teamIds);
      return c.json({
        ...(await readSettings(c.env.DB, c.get("operatorId"))),
        invitationDelivery: localMailEnabled(c.env) ? "local" : "email",
      });
    } catch (error) {
      if (error instanceof SettingsError)
        return c.json({ error: error.code, message: error.message }, error.status);
      throw error;
    }
  });
  app.delete("/settings/operators/:operatorId", async (c) => {
    const target = c.req.param("operatorId");
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(target))
      return c.json({ error: "invalid_request" }, 400);
    try {
      const result = await removeOperator(
        c.env.DB,
        c.get("operatorId"),
        target,
      );
      if (result.signedOut)
        c.header("Set-Cookie", clearSessionCookie(c.env, c.req.raw));
      return c.json(result);
    } catch (error) {
      if (error instanceof SettingsError)
        return c.json(
          { error: error.code, message: error.message },
          error.status,
        );
      throw error;
    }
  });
}
