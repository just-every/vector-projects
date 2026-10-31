import type { Hono, Context } from "hono";
import type { AppEnvironment } from "../../app/bindings";
import { readRequestJson } from "../../app/input";
import { SettingsError } from "../settings/repository";
import { rotationInput } from "./schema";
import {
  saveRotation,
  rotationProjection,
  triageProjection,
} from "./repository";
export function addTriageResponsibilityRoutes(app: Hono<AppEnvironment>) {
  const door =
    (run: (c: Context<AppEnvironment>) => Promise<Response>) =>
    async (c: Context<AppEnvironment>) => {
      try {
        return await run(c);
      } catch (error) {
        if (error instanceof SettingsError)
          return c.json(
            { error: error.code, message: error.message },
            error.status,
          );
        throw error;
      }
    };
  app.get(
    "/triage-responsibility",
    door(async (c) =>
      c.json(await triageProjection(c.env.DB, c.get("operatorId"))),
    ),
  );
  app.get(
    "/settings/teams/:id/triage-rotation",
    door(async (c) =>
      c.json(
        await rotationProjection(
          c.env.DB,
          c.get("operatorId"),
          c.req.param("id")!,
        ),
      ),
    ),
  );
  app.put(
    "/settings/teams/:id/triage-rotation",
    door(async (c) => {
      const parsed = rotationInput.safeParse(await readRequestJson(c.req.raw));
      if (!parsed.success)
        return c.json(
          {
            error: "invalid_rotation",
            message:
              "Choose a fixed member or an ordered rotation of distinct active team members and a valid local start.",
          },
          400,
        );
      await saveRotation(
        c.env.DB,
        c.get("operatorId"),
        c.req.param("id")!,
        parsed.data,
      );
      return c.json(
        await rotationProjection(
          c.env.DB,
          c.get("operatorId"),
          c.req.param("id")!,
        ),
      );
    }),
  );
}
